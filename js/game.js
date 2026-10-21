// RUNNER move-to-earn engine (STEPN-inspired).
//
//   Sneaker  — type sets the speed zone you earn in; rarity sets base attributes.
//   Energy   — every 5 minutes of earning costs 1 energy. Max energy grows with
//              the number of sneakers you own and refills fully every 24 h.
//   Earning  — coins/minute = 0.15 × efficiency, only while your GPS speed is
//              inside the sneaker's zone. +10% with a live Bluetooth HR sensor.
//   Durability drops per energy spent (less with high resilience); below 50 it
//              cuts efficiency. Repair it with coins.
//   Luck     — chance of a mystery box per energy spent.
//   Levels   — each level-up grants attribute points (4/6/8/10 by rarity) that
//              the player assigns to Efficiency, Luck or Resilience.
//   Minting  — two Lv 5+ sneakers (max 7 mints each) breed a new one; the
//              child's rarity is rolled from the parents' rarities.
//
// All state is local (IndexedDB). Real-value rewards would need these rules
// enforced on a server, which is where `settle()` would move.

import { db } from './db.js';

export const COIN = 'EARN';
export const MINUTES_PER_ENERGY = 5;
export const VEHICLE_KMH = 25;   // faster than this = probably in a vehicle
export const HR_BONUS = 1.1;
export const MAX_LEVEL = 30;

export const SNEAKER_TYPES = {
  // Keys stay stable for saved data; labels are what players see.
  walker:  { label: 'Recovery Runner', short: 'Recovery', min: 1, max: 6,  mult: 1 },
  jogger:  { label: 'Daily Runner',    short: 'Daily',    min: 4, max: 10, mult: 1 },
  runner:  { label: 'Tempo Runner',    short: 'Tempo',    min: 8, max: 20, mult: 1 },
  trainer: { label: 'Hybrid Runner',   short: 'Hybrid',   min: 1, max: 20, mult: 0.85 }, // any pace, earns a bit less
};

export const RARITIES = {
  common:   { label: 'Common',   range: [4, 8],   price: 120 },
  uncommon: { label: 'Uncommon', range: [8, 14],  price: 400 },
  rare:     { label: 'Rare',     range: [15, 25], price: 1200 },
  epic:     { label: 'Epic',     range: [28, 42], price: 3500 },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round2 = (x) => Math.round(x * 100) / 100;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

// ---------------------------------------------------------------- rules
export function maxEnergy(sneakerCount) {
  if (sneakerCount >= 30) return 20;
  if (sneakerCount >= 15) return 12;
  if (sneakerCount >= 9) return 9;
  if (sneakerCount >= 3) return 4;
  return 2;
}

export const ATTRS = ['efficiency', 'luck', 'resilience'];
export const POINTS_PER_LEVEL = { common: 4, uncommon: 6, rare: 8, epic: 10 };
export const MINT_LEVEL = 5;
export const MAX_MINTS = 7;
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic'];

/** Effective attributes: rolled base + allocated level-up points (+ optional staged points). */
export function attrs(s, staged = null) {
  const wear = s.durability >= 50 ? 1 : Math.max(0.2, s.durability / 50);
  const v = (k) => s.base[k] + (s.points?.[k] || 0) + (staged?.[k] || 0);
  return { efficiency: v('efficiency') * wear, luck: v('luck'), resilience: v('resilience') };
}

export const earnPerMinute = (s) => 0.15 * attrs(s).efficiency * SNEAKER_TYPES[s.type].mult;
export const earnPerEnergy = (s) => earnPerMinute(s) * MINUTES_PER_ENERGY;
export const levelUpCost = (s) => 10 * (s.level + 1);
export const repairCost = (s) => Math.ceil((100 - s.durability) * 0.1 * (1 + s.level * 0.1));
export const durabilityLossPerEnergy = (s) => Math.max(0.5, 3 - attrs(s).resilience * 0.05);
export const boxChancePerEnergy = (s) => Math.min(0.5, 0.03 + attrs(s).luck * 0.006);

/** Fields every owned sneaker carries besides its look and base stats. */
const ownedFields = () => ({
  id: uid(), level: 0, durability: 100,
  points: { efficiency: 0, luck: 0, resilience: 0 }, unspent: 0, mints: 0, parents: null,
  createdAt: Date.now(),
});

export function newSneaker(rarity = 'common', type = pick(Object.keys(SNEAKER_TYPES)), extra = {}) {
  const [lo, hi] = RARITIES[rarity].range;
  return {
    ...ownedFields(),
    serial: String(Math.floor(rand(1000, 99999))),
    type, rarity,
    base: { efficiency: round2(rand(lo, hi)), luck: round2(rand(lo, hi)), resilience: round2(rand(lo, hi)) },
    hue: Math.floor(rand(0, 360)),
    ...extra,
  };
}

// ---------------------------------------------------------------- minting
export const canMint = (s) => s.level >= MINT_LEVEL && (s.mints || 0) < MAX_MINTS && s.durability >= 50;
/** Coins to mint — grows with how often each parent has already minted. */
export const mintCost = (a, b) => 100 + 60 * ((a.mints || 0) + (b.mints || 0));

/** Probabilities for the child's rarity, e.g. { common: .65, uncommon: .30, rare: .05 }. */
export function mintOdds(a, b) {
  const ra = RARITY_ORDER.indexOf(a.rarity), rb = RARITY_ORDER.indexOf(b.rarity);
  const lo = Math.min(ra, rb), hi = Math.max(ra, rb), up = Math.min(hi + 1, RARITY_ORDER.length - 1);
  const odds = {};
  const add = (i, p) => { odds[RARITY_ORDER[i]] = round2((odds[RARITY_ORDER[i]] || 0) + p); };
  add(lo, lo === hi ? 0.9 : 0.6);
  if (lo !== hi) add(hi, 0.3);
  add(up, 0.1);
  return odds;
}

function rollMint(a, b) {
  let r = Math.random(), rarity = 'common';
  for (const [k, p] of Object.entries(mintOdds(a, b))) { if ((r -= p) < 0) { rarity = k; break; } rarity = k; }
  const t = Math.random();
  const type = t < 0.45 ? a.type : t < 0.9 ? b.type : pick(Object.keys(SNEAKER_TYPES));
  // Blend the parents' colours along the shorter way round the hue wheel, with a little drift.
  const d = ((b.hue - a.hue + 540) % 360) - 180;
  const hue = Math.round((a.hue + d / 2 + rand(-25, 25) + 360) % 360);
  return newSneaker(rarity, type, { hue, parents: [a.serial, b.serial] });
}

/** Four marketplace listings that rotate daily (same for the whole day). */
export function dailyListings(day = new Date().toISOString().slice(0, 10)) {
  let seed = [...day].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const types = Object.keys(SNEAKER_TYPES);
  return ['common', 'common', 'uncommon', 'rare'].map((rarity, i) => {
    const [lo, hi] = RARITIES[rarity].range;
    const r = () => round2(lo + rnd() * (hi - lo));
    return {
      id: `${day}-${i}`, rarity, type: types[Math.floor(rnd() * types.length)],
      base: { efficiency: r(), luck: r(), resilience: r() },
      hue: Math.floor(rnd() * 360), serial: String(10000 + Math.floor(rnd() * 89999)),
      price: RARITIES[rarity].price,
    };
  });
}

// ---------------------------------------------------------------- live session
/** Tracks earning during one recording, second by second. */
export class EarnSession {
  constructor(sneaker, energyAvailable, { simulated = false } = {}) {
    this.sneaker = sneaker ? structuredClone(sneaker) : null;
    this.energyStart = energyAvailable;
    this.simulated = simulated;
    this.used = 0;
    this.coins = 0;
    this.zoneSec = 0;
    this.offSec = 0;
    this.vehicleSec = 0;
    this.hrSec = 0;
    this.status = sneaker ? 'waiting' : 'nosneaker';
  }

  get energyLeft() { return Math.max(0, this.energyStart - this.used); }

  /** Called once per second while recording. speed in m/s (null = no fix yet). */
  tick(speed, hasHr, dt = 1) {
    const s = this.sneaker;
    if (!s) return (this.status = 'nosneaker');
    if (speed == null) return (this.status = 'waiting');
    const kmh = speed * 3.6;
    if (kmh > VEHICLE_KMH) { this.vehicleSec += dt; return (this.status = 'vehicle'); }
    if (this.energyLeft <= 0) return (this.status = 'noenergy');
    const t = SNEAKER_TYPES[s.type];
    if (kmh < t.min) { this.offSec += dt; return (this.status = 'slow'); }
    if (kmh > t.max) { this.offSec += dt; return (this.status = 'fast'); }
    const e = Math.min(this.energyLeft, dt / (MINUTES_PER_ENERGY * 60));
    const frac = e / (dt / (MINUTES_PER_ENERGY * 60));
    this.used += e;
    this.coins += (earnPerMinute(s) * dt * frac / 60) * (hasHr ? HR_BONUS : 1);
    this.zoneSec += dt * frac;
    if (hasHr) this.hrSec += dt * frac;
    return (this.status = 'earning');
  }

  toJSON() {
    const { sneaker, energyStart, simulated, used, coins, zoneSec, offSec, vehicleSec, hrSec } = this;
    return { sneakerId: sneaker?.id, energyStart, simulated, used, coins, zoneSec, offSec, vehicleSec, hrSec };
  }
}

// ---------------------------------------------------------------- persistent state
function freshState() {
  return {
    onboarded: false, // the starter sneaker is picked during onboarding
    profile: { name: 'Runner' },
    wallet: null, // { address, privyId, method, email, linkedAt } once signed in
    coins: 0,
    energy: maxEnergy(1),
    energyAt: Date.now(),
    sneakers: [],
    activeId: null,
    boxes: [],
    bought: [],   // marketplace listing ids already purchased
    ledger: [],
  };
}

/** Upgrades state saved by older versions of the app. */
function migrate(st) {
  st.onboarded ??= st.sneakers.length > 0;
  st.profile ??= { name: 'Runner' };
  st.wallet ??= null;
  for (const s of st.sneakers) {
    s.points ??= { efficiency: 0, luck: 0, resilience: 0 };
    s.mints ??= 0;
    s.parents ??= null;
    s.unspent ??= s.level * POINTS_PER_LEVEL[s.rarity];
  }
  return st;
}

class Game extends EventTarget {
  async load() {
    const saved = await db.kvGet('game');
    this.state = saved ? migrate(saved) : freshState();
    this._regen();
    await this.save();
  }

  /** Finishes onboarding with the player's chosen free sneaker. */
  async claimStarter(type, hue) {
    if (this.state.onboarded) return this.active;
    const s = newSneaker('common', type, hue != null ? { hue } : {});
    this.state.sneakers.push(s);
    this.state.activeId = s.id;
    this.state.energy = this.maxEnergy;
    this.state.onboarded = true;
    this._log(0, 'welcome', `Welcome! Free ${SNEAKER_TYPES[type].label} sneaker #${s.serial}`);
    await this.save();
    return s;
  }

  async save() {
    await db.kvSet('game', this.state);
    this.dispatchEvent(new Event('change'));
  }

  _regen() {
    const st = this.state, now = Date.now();
    const max = this.maxEnergy;
    const hours = (now - st.energyAt) / 3.6e6;
    if (st.energy < max) st.energy = Math.min(max, st.energy + (hours * max) / 24);
    st.energyAt = now;
  }

  get maxEnergy() { return maxEnergy(this.state.sneakers.length); }
  get energy() { this._regen(); return this.state.energy; }
  get coins() { return this.state.coins; }
  get active() { return this.state.sneakers.find((s) => s.id === this.state.activeId) || this.state.sneakers[0] || null; }
  sneaker(id) { return this.state.sneakers.find((s) => s.id === id); }

  /** Minutes until energy is full again. */
  minutesToFull() {
    const missing = this.maxEnergy - this.energy;
    return missing <= 0 ? 0 : Math.ceil((missing / this.maxEnergy) * 24 * 60);
  }

  _spend(amount, kind, note) {
    if (this.state.coins + 1e-9 < amount) throw new Error(`Not enough ${COIN} — you need ${amount}`);
    this.state.coins = round2(this.state.coins - amount);
    this._log(-amount, kind, note);
  }

  _log(amount, kind, note, extra = {}) {
    this.state.ledger.unshift({ t: Date.now(), amount: round2(amount), kind, note, ...extra });
    this.state.ledger = this.state.ledger.slice(0, 200);
  }

  /** Ties this device's progress to a signed-in account and its embedded wallet. */
  async linkWallet({ address, privyId, method, email }) {
    const first = !this.state.wallet;
    this.state.wallet = { address, privyId, method, email, linkedAt: this.state.wallet?.linkedAt || Date.now() };
    if (first) this._log(0, 'wallet', `Wallet created on Robinhood Chain · ${address.slice(0, 6)}…${address.slice(-4)}`);
    await this.save();
  }

  async setName(name) {
    this.state.profile.name = String(name).trim().slice(0, 40) || 'Runner';
    await this.save();
  }

  async select(id) { this.state.activeId = id; await this.save(); }

  async levelUp(id) {
    const s = this.sneaker(id);
    if (s.level >= MAX_LEVEL) throw new Error('Already max level');
    this._spend(levelUpCost(s), 'levelup', `Level up #${s.serial} → Lv ${s.level + 1}`);
    s.level++;
    s.unspent += POINTS_PER_LEVEL[s.rarity];
    await this.save();
  }

  /** Permanently assigns unspent level-up points, e.g. { efficiency: 3, luck: 1 }. */
  async allocate(id, add) {
    const s = this.sneaker(id);
    const vals = ATTRS.map((k) => add[k] || 0);
    if (vals.some((v) => v < 0 || !Number.isInteger(v))) throw new Error('Invalid points');
    const total = vals.reduce((a, b) => a + b, 0);
    if (!total) return;
    if (total > s.unspent) throw new Error('Not enough points');
    ATTRS.forEach((k, i) => { s.points[k] += vals[i]; });
    s.unspent -= total;
    await this.save();
  }

  async mint(aId, bId) {
    const a = this.sneaker(aId), b = this.sneaker(bId);
    if (!a || !b || a === b) throw new Error('Pick two different sneakers');
    if (!canMint(a) || !canMint(b)) throw new Error(`Both sneakers need Lv ${MINT_LEVEL}+, under ${MAX_MINTS} mints and 50+ durability`);
    this._spend(mintCost(a, b), 'mint', `Minted from #${a.serial} + #${b.serial}`);
    this._regen(); // bank energy at the old max before the new sneaker raises it
    const child = rollMint(a, b);
    a.mints++; b.mints++;
    this.state.sneakers.push(child);
    this.state.ledger[0].note += ` → ${RARITIES[child.rarity].label} ${SNEAKER_TYPES[child.type].label} #${child.serial}`;
    await this.save();
    return child;
  }

  async repair(id) {
    const s = this.sneaker(id);
    const cost = repairCost(s);
    if (!cost) return;
    this._spend(cost, 'repair', `Repaired #${s.serial}`);
    s.durability = 100;
    await this.save();
  }

  async buy(listing) {
    if (this.state.bought.includes(listing.id)) throw new Error('Already sold');
    this._spend(listing.price, 'buy', `Bought ${RARITIES[listing.rarity].label} ${SNEAKER_TYPES[listing.type].label} #${listing.serial}`);
    this._regen();
    const { price, id, ...rest } = listing;
    const s = { ...rest, ...ownedFields() };
    this.state.sneakers.push(s);
    this.state.bought = [...this.state.bought.filter((b) => b.startsWith(new Date().toISOString().slice(0, 10))), listing.id];
    await this.save();
    return s;
  }

  async openBox(boxId) {
    const box = this.state.boxes.find((b) => b.id === boxId);
    if (!box) throw new Error('Box not found');
    this.state.boxes = this.state.boxes.filter((b) => b.id !== boxId);
    const coins = round2(box.quality * rand(3, 10));
    this.state.coins = round2(this.state.coins + coins);
    let sneaker = null;
    if (Math.random() < box.quality * 0.03) {
      this._regen();
      sneaker = newSneaker(box.quality >= 4 ? 'uncommon' : 'common');
      this.state.sneakers.push(sneaker);
    }
    this._log(coins, 'box', `Opened Lv ${box.quality} mystery box${sneaker ? ` + ${SNEAKER_TYPES[sneaker.type].label} #${sneaker.serial}` : ''}`);
    await this.save();
    return { coins, sneaker };
  }

  /** Applies a finished EarnSession: pays coins, spends energy, wears the sneaker, rolls boxes. */
  async settle(session, activityId) {
    const s = this.sneaker(session.sneakerId);
    const result = { coins: 0, energy: 0, boxes: [], voided: false, sneakerId: session.sneakerId,
      sneakerLabel: s ? `${SNEAKER_TYPES[s.type].label} #${s.serial}` : null, zoneSec: Math.round(session.zoneSec),
      hrVerified: session.hrSec > session.zoneSec * 0.8 && session.zoneSec > 0, simulated: !!session.simulated };
    if (!s || session.used <= 0) return result;

    // Anti-cheat: mostly vehicle speeds → no reward.
    const total = session.zoneSec + session.offSec + session.vehicleSec;
    if (session.vehicleSec > total * 0.5) {
      result.voided = true;
      return result;
    }

    this._regen();
    const used = Math.min(session.used, this.state.energy);
    const coins = round2(session.coins * (used / session.used));
    this.state.energy = Math.max(0, this.state.energy - used);
    this.state.coins = round2(this.state.coins + coins);
    s.durability = Math.max(0, round2(s.durability - used * durabilityLossPerEnergy(s)));

    // One roll per energy (partial energy rolls with reduced odds).
    let left = used;
    while (left > 0.05) {
      const w = Math.min(1, left);
      if (Math.random() < boxChancePerEnergy(s) * w) {
        const l = attrs(s).luck;
        const quality = Math.min(5, Math.max(1, Math.round(1 + Math.random() * (l / 12))));
        const box = { id: uid(), quality, at: Date.now() };
        this.state.boxes.push(box);
        result.boxes.push(box);
      }
      left -= w;
    }
    Object.assign(result, { coins, energy: round2(used) });
    this._log(coins, 'run', `${result.simulated ? 'Simulated run' : 'Run'} with ${result.sneakerLabel}`, { activityId });
    await this.save();
    return result;
  }

  async reset() { this.state = freshState(); await this.save(); }
}

export const game = new Game();
