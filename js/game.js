// RUNNER run-to-earn state: sneakers owned on-chain, energy, progress and the
// RUNNER balance. Earning rules live in rules.js (shared with the server).
//
// Without the rewards server (local mode) everything is kept on this device in
// IndexedDB. With it (rewards.js), the server is the source of truth: runs are
// re-scored there and balance, energy and sneaker progress come back from it.

import { db } from './db.js';
import {
  COIN, SNEAKER_TYPES, RARITIES, maxEnergy, ATTRS, POINTS_PER_LEVEL, MAX_LEVEL,
  levelUpCost, repairCost, durabilityLossPerEnergy, sneakerFromToken, round2, isVoided, DEFAULT_SETTINGS,
} from './rules.js';

export * from './rules.js';

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
  /** Current halving factor from the rewards server (1 in local mode). */
  get emissionFactor() { return this.state.server?.factor ?? 1; }
  /** NFT boost multiplier from the rewards server (1 = none). */
  get boost() { return this.state.server?.boost ?? 1; }
  /** What earn rates are multiplied by: halving factor × NFT boost. */
  get earnFactor() { return this.emissionFactor * this.boost; }
  /** Game settings (level prices…) from the rewards server, defaults in local mode. */
  get settings() { return this.state.server?.settings || DEFAULT_SETTINGS; }
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
    this._spend(levelUpCost(s, this.emissionFactor, this.settings), 'levelup', `Level up #${s.serial} → Lv ${s.level + 1}`);
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
    const cost = repairCost(s, this.emissionFactor);
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
    if (isVoided(session)) {
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

  // ---------------------------------------------------------------- rewards server
  /** Takes balance, energy and sneaker progress from the rewards server's view. */
  async applyServer(view) {
    if (!view) return;
    const st = this.state;
    st.coins = view.balance;
    st.energy = view.energy;
    st.energyAt = Date.now();
    st.server = { earned: view.earned, spent: view.spent, withdrawn: view.withdrawn, factor: view.emission?.factor ?? 1, emission: view.emission || null, settings: view.settings || null, boost: view.boost ?? 1, at: Date.now() };
    for (const s of st.sneakers) {
      const p = view.sneakers?.[s.tokenId];
      if (p) Object.assign(s, { level: p.level, durability: p.durability, points: { ...p.points }, unspent: p.unspent });
    }
    await this.save();
  }

  /** Runs that couldn't be uploaded yet (offline); retried by rewards.syncRewards. */
  async queuePending(run) {
    (this.state.pendingRuns ??= []).push(run);
    await this.save();
  }

  async dropPending(run) {
    this.state.pendingRuns = (this.state.pendingRuns || []).filter((r) => r !== run && r.points?.[0]?.t !== run.points?.[0]?.t);
    await this.save();
  }

  logServerRun(run, activityId) {
    if (!run) return;
    const s = this.state.sneakers.find((x) => x.tokenId === run.tokenId);
    this._log(run.coins, 'run', run.voided ? 'Run not counted — vehicle speeds' : `Verified run with ${s ? `${SNEAKER_TYPES[s.type].label} #${s.serial}` : `#${run.tokenId}`}`, activityId ? { activityId } : {});
    this.save();
  }

  async reset() { this.state = freshState(); await this.save(); }
}

export const game = new Game();
