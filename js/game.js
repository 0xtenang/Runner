// RUNNER run-to-earn engine.
//
//   Sneakers — RUNNER Genesis NFTs on Robinhood Chain. You need at least one
//              to earn; owning is read from the chain (see nft.js). A token's
//              number fixes its class, rarity, starting stats and look.
//   Class    — sets the pace zone you earn in.
//   Energy   — every 5 minutes of earning costs 1 energy. Max energy grows with
//              the number of sneakers you own and refills fully every 24 h.
//   Earning  — RUNNER/minute = 0.15 × Efficiency, only while your GPS pace is
//              inside the sneaker's zone. +10% with a live Bluetooth HR sensor.
//   Durability drops per energy spent (less with high Resilience); below 50 it
//              cuts Efficiency. Repair it with RUNNER.
//   Levels   — level-ups cost RUNNER and grant attribute points (4/6/8/10 by
//              rarity) that the player assigns to Efficiency or Resilience.
//
// Progress (levels, points, durability, balance) is local (IndexedDB) for now.
// Real-value rewards would need settle() enforced on a server.

import { db } from './db.js';
import { traitsFor } from './collection.js';

export const COIN = 'RUNNER';
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
  common: { label: 'Common' },
  uncommon: { label: 'Uncommon' },
  rare: { label: 'Rare' },
  epic: { label: 'Epic' },
};

const round2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- rules
export function maxEnergy(sneakerCount) {
  if (sneakerCount >= 30) return 20;
  if (sneakerCount >= 15) return 12;
  if (sneakerCount >= 9) return 9;
  if (sneakerCount >= 3) return 4;
  return 2;
}

export const ATTRS = ['efficiency', 'resilience'];
export const POINTS_PER_LEVEL = { common: 4, uncommon: 6, rare: 8, epic: 10 };

/** Effective attributes: base + allocated level-up points (+ optional staged points). */
export function attrs(s, staged = null) {
  const wear = s.durability >= 50 ? 1 : Math.max(0.2, s.durability / 50);
  const v = (k) => s.base[k] + (s.points?.[k] || 0) + (staged?.[k] || 0);
  return { efficiency: v('efficiency') * wear, resilience: v('resilience') };
}

export const earnPerMinute = (s) => 0.15 * attrs(s).efficiency * SNEAKER_TYPES[s.type].mult;
export const earnPerEnergy = (s) => earnPerMinute(s) * MINUTES_PER_ENERGY;
export const levelUpCost = (s) => 10 * (s.level + 1);
export const repairCost = (s) => Math.ceil((100 - s.durability) * 0.1 * (1 + s.level * 0.1));
export const durabilityLossPerEnergy = (s) => Math.max(0.5, 3 - attrs(s).resilience * 0.05);

/** A playable sneaker for Genesis token `tokenId` (fresh progress). */
export function sneakerFromToken(tokenId) {
  const t = traitsFor(tokenId);
  return {
    id: `nft-${tokenId}`, tokenId, serial: String(tokenId),
    model: t.model, hue: t.hue, accent: t.accent, midTone: t.midTone, pattern: t.pattern, laces: t.laces, edition: t.edition,
    type: t.type, rarity: t.rarity, base: t.base,
    level: 0, durability: 100, points: { efficiency: 0, resilience: 0 }, unspent: 0,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------- live session
/** Tracks earning during one recording, second by second. */
export class EarnSession {
  constructor(sneaker, energyAvailable) {
    this.sneaker = sneaker ? structuredClone(sneaker) : null;
    this.energyStart = energyAvailable;
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
    const { sneaker, energyStart, used, coins, zoneSec, offSec, vehicleSec, hrSec } = this;
    return { sneakerId: sneaker?.id, energyStart, used, coins, zoneSec, offSec, vehicleSec, hrSec };
  }
}

// ---------------------------------------------------------------- persistent state
function freshState() {
  return {
    onboarded: false,
    profile: { name: 'Runner' },
    wallet: null,   // { address, privyId, method, email, linkedAt } once signed in
    coins: 0,       // RUNNER token balance (in-app for now)
    energy: maxEnergy(0),
    energyAt: Date.now(),
    sneakers: [],   // sneakers the linked wallet owns on-chain
    vault: {},      // progress of tokens no longer owned, by token id (restored if re-acquired)
    legacy: [],     // pre-NFT free sneakers from older versions (can't earn)
    activeId: null,
    ledger: [],
  };
}

/** Upgrades state saved by older versions of the app. */
function migrate(st) {
  st.onboarded ??= st.sneakers.length > 0;
  st.profile ??= { name: 'Runner' };
  st.wallet ??= null;
  st.vault ??= {};
  st.legacy ??= [];
  // Earlier versions handed out free sneakers. Earning now requires an owned
  // NFT, so those move to `legacy` and sync from the chain takes over.
  const nfts = st.sneakers.filter((s) => s.nft);
  const old = st.sneakers.filter((s) => !s.nft);
  if (old.length) { st.legacy.push(...old); st.sneakers = nfts; }
  for (const s of st.sneakers) {
    if (s.points) delete s.points.luck;
    if (s.base) delete s.base.luck;
  }
  delete st.boxes;
  delete st.bought;
  if (!st.sneakers.some((s) => s.id === st.activeId)) st.activeId = st.sneakers[0]?.id || null;
  return st;
}

class Game extends EventTarget {
  async load() {
    const saved = await db.kvGet('game');
    this.state = saved ? migrate(saved) : freshState();
    this._regen();
    await this.save();
  }

  async save() {
    await db.kvSet('game', this.state);
    this.dispatchEvent(new Event('change'));
  }

  async finishOnboarding() {
    this.state.onboarded = true;
    await this.save();
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
  get ownedTokenIds() { return this.state.sneakers.map((s) => s.tokenId); }
  sneaker(id) { return this.state.sneakers.find((s) => s.id === id); }

  /** Minutes until energy is full again. */
  minutesToFull() {
    const missing = this.maxEnergy - this.energy;
    return missing <= 0 ? 0 : Math.ceil((missing / this.maxEnergy) * 24 * 60);
  }

  /**
   * Makes the sneaker list match the token ids the wallet owns on-chain.
   * New tokens get fresh sneakers (or their saved progress back); tokens no
   * longer owned are moved to the vault. Returns the newly added sneakers.
   */
  async syncOwned(tokenIds) {
    const st = this.state;
    this._regen(); // bank energy at the old max before it changes
    const want = new Set(tokenIds.map(Number));
    const keep = st.sneakers.filter((s) => want.has(s.tokenId));
    for (const s of st.sneakers) if (!want.has(s.tokenId)) st.vault[s.tokenId] = s;
    const have = new Set(keep.map((s) => s.tokenId));
    const added = [];
    for (const id of want) {
      if (have.has(id)) continue;
      const s = st.vault[id] || { ...sneakerFromToken(id), nft: true };
      delete st.vault[id];
      keep.push(s);
      added.push(s);
    }
    keep.sort((a, b) => a.tokenId - b.tokenId);
    const changed = added.length || keep.length !== st.sneakers.length;
    st.sneakers = keep;
    if (!keep.some((s) => s.id === st.activeId)) st.activeId = keep[0]?.id || null;
    for (const s of added) this._log(0, 'nft', `Genesis #${s.tokenId} added — ${RARITIES[s.rarity].label} ${SNEAKER_TYPES[s.type].label}`);
    if (changed) await this.save();
    return added;
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
    if (first) this._log(0, 'wallet', `Wallet connected on Robinhood Chain · ${address.slice(0, 6)}…${address.slice(-4)}`);
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

  /** Permanently assigns unspent level-up points, e.g. { efficiency: 3, resilience: 1 }. */
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

  async repair(id) {
    const s = this.sneaker(id);
    const cost = repairCost(s);
    if (!cost) return;
    this._spend(cost, 'repair', `Repaired #${s.serial}`);
    s.durability = 100;
    await this.save();
  }

  /** Applies a finished EarnSession: pays RUNNER, spends energy, wears the sneaker. */
  async settle(session, activityId) {
    const s = this.sneaker(session.sneakerId);
    const result = { coins: 0, energy: 0, voided: false, sneakerId: session.sneakerId,
      sneakerLabel: s ? `${SNEAKER_TYPES[s.type].label} #${s.serial}` : null, zoneSec: Math.round(session.zoneSec),
      hrVerified: session.hrSec > session.zoneSec * 0.8 && session.zoneSec > 0 };
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
    Object.assign(result, { coins, energy: round2(used) });
    this._log(coins, 'run', `Run with ${result.sneakerLabel}`, { activityId });
    await this.save();
    return result;
  }

  async reset() { this.state = freshState(); await this.save(); }
}

export const game = new Game();
