// RUNNER earning rules — pure functions shared by the app (live display) and the
// rewards server (api/rewards.js), which re-scores every uploaded run with this
// exact code before paying real RUNNER. Keep this file free of browser APIs.
//
//   Class    — sets the pace zone you earn in.
//   Energy   — 1 energy = 30 minutes of earning. Max energy grows with the number
//              of sneakers you own (1 sneaker: 1 energy) and refills fully every 24 h.
//   Earning  — RUNNER/minute = 112.5 × Efficiency × emission factor, only while
//              your GPS pace is inside the sneaker's zone. +10% with a live
//              Bluetooth HR sensor.
//   Emission — mirrors RunnerToken: launch schedule 10M RUNNER/day, halving every
//              30 days, never below 100k/day (the dev wallet can change it on-chain).
//              The emission factor (today's emission ÷ 10M) scales every earn rate.
//   Boosts   — holding NFTs from boost collections (admin settings) multiplies earnings.
//   Durability drops per energy spent (less with high Resilience); below 50 it
//              cuts Efficiency. Repair it with RUNNER. Repair and level-up costs
//              follow the emission factor, so they halve together with earnings.
//   Levels   — 0–30. Level-ups cost base × (next level)^exp RUNNER × emission factor
//              (defaults 1,100 and 1.5: about a month to level 30 for a Common) and grant
//              attribute points (Common 1, Uncommon 1, Rare 2, Epic 2) that the player
//              assigns to Efficiency or Resilience. Base and exponent are admin settings.

import { traitsFor } from './collection.js';
import { haversine } from './stats.js';

export const COIN = 'RUNNER';
export const MINUTES_PER_ENERGY = 30;
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

export const round2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- rules
export function maxEnergy(sneakerCount) {
  if (sneakerCount >= 30) return 10;  // 5 h
  if (sneakerCount >= 15) return 6;   // 3 h
  if (sneakerCount >= 9) return 4;    // 2 h
  if (sneakerCount >= 3) return 2;    // 1 h
  return 1;                           // 30 min
}

export const ATTRS = ['efficiency', 'resilience'];
export const POINTS_PER_LEVEL = { common: 1, uncommon: 1, rare: 2, epic: 2 };

/** Effective attributes: base + allocated level-up points (+ optional staged points). */
export function attrs(s, staged = null) {
  const wear = s.durability >= 50 ? 1 : Math.max(0.2, s.durability / 50);
  const v = (k) => s.base[k] + (s.points?.[k] || 0) + (staged?.[k] || 0);
  return { efficiency: v('efficiency') * wear, resilience: v('resilience') };
}

// ---------------------------------------------------------------- emission (halving)
// Mirrors RunnerToken.emissionOn. A schedule is
//   { startDay, current: { dailyStart, floor, halvingDays, fromDay }, next: {...} | null }
// in whole RUNNER and UTC day numbers; the server reads it from the token contract.
export const LAUNCH_SCHEDULE = { dailyStart: 10_000_000, floor: 100_000, halvingDays: 30 };
/** Earn-rate factor 1 = 10M RUNNER/day of emission. */
export const REFERENCE_EMISSION = 10_000_000;
/** Earn-rate scale: ~330 daily runners (30 min each) use a 10M-RUNNER day. */
export const EARN_SCALE = 750;

/** The launch schedule started on `startDay` (what startEmission() sets up). */
export const launchSchedule = (startDay) => (startDay ? { startDay, current: { ...LAUNCH_SCHEDULE, fromDay: startDay }, next: null } : null);
const activeSchedule = (day, sch) => (sch.next?.fromDay && day >= sch.next.fromDay ? sch.next : sch.current);

/** RUNNER the pool may pay out on UTC day `day` (0 before emission starts). */
export function emissionOn(day, sch) {
  if (!sch?.startDay || day < sch.startDay) return 0;
  const s = activeSchedule(day, sch);
  if (day < s.fromDay) return 0;
  const halvings = Math.floor((day - s.fromDay) / s.halvingDays);
  return Math.max(s.dailyStart / 2 ** halvings, s.floor);
}
/** Earn-rate multiplier for `day`: today's emission ÷ 10M (1 when there's no schedule yet). */
export const emissionFactor = (day, sch) => (sch?.startDay ? emissionOn(Math.max(day, sch.startDay), sch) / REFERENCE_EMISSION : 1);
export const utcDay = (t = Date.now()) => Math.floor(t / 864e5);
/** Next halving date (ms) under the active schedule, or null at the floor. */
export function nextHalving(day, sch) {
  if (!sch?.startDay) return null;
  const s = activeSchedule(day, sch);
  if (emissionOn(day, sch) <= s.floor) return null;
  const n = Math.floor((day - s.fromDay) / s.halvingDays) + 1;
  return (s.fromDay + n * s.halvingDays) * 864e5;
}

// ---------------------------------------------------------------- game settings
// Tunable by the dev wallet from /admin.html (stored by the rewards server). The app
// shows whatever the server reports; these defaults apply in local mode.
export const DEFAULT_SETTINGS = {
  levelCostBase: 1100,      // level-up cost = base × (next level)^exp × emission factor
  levelCostExp: 1.5,        // ≈ a month for a Common to reach level 30
  perRunnerDailyMax: 0,     // most RUNNER one runner can earn per day at a 10M day (0 = no limit)
  boosts: [],               // [{ contract, label, boostBps }] — holding any NFT from `contract` adds boostBps to earnings
  requireAttestation: false, // only runs from the genuine phone app on an unmodified phone earn (Play Integrity / App Attest)
  fairPlay: {               // automatic decisions — no human review
    fullPayTrust: 70,       // trust ≥ this: paid in full
    voidBelowTrust: 40,     // trust < this (or a hard signal): not paid + 1 strike
    partialPayPct: 50,      // in between: this % is paid, no strike
    strikeLimit: 3,         // strikes within strikeWindowDays → automatic suspension
    strikeWindowDays: 30,
    suspensionDays: [7, 30], // 1st, 2nd suspension; the next one is permanent
  },
};

/**
 * Automatic fair-play decision for a run: { outcome: 'paid' | 'partial' | 'voided', payPct }.
 * `hard` = a signal that is cheating on its own (fake-GPS app, copied route).
 */
export function fairPlayDecision(trust, hard, fp = DEFAULT_SETTINGS.fairPlay) {
  if (hard || trust < fp.voidBelowTrust) return { outcome: 'voided', payPct: 0 };
  if (trust < fp.fullPayTrust) return { outcome: 'partial', payPct: fp.partialPayPct };
  return { outcome: 'paid', payPct: 100 };
}

/**
 * The part of an uploaded run that the phone app's device proof signs (Play Integrity
 * nonce / App Attest client data). The app and the server must build it the same way.
 */
export const runPayload = (run) => JSON.stringify({ tokenId: run.tokenId, points: run.points, steps: run.steps ?? null, mockFixes: run.mockFixes ?? 0 });
export const MAX_TOTAL_BOOST_BPS = 10_000; // boosts add up to +100% at most

/** Earnings multiplier from NFT boosts the wallet holds (contracts it holds ⊆ settings.boosts). */
export function boostMultiplier(heldContracts, settings = DEFAULT_SETTINGS) {
  const held = new Set((heldContracts || []).map((a) => a.toLowerCase()));
  const bps = (settings.boosts || []).filter((b) => held.has(b.contract.toLowerCase())).reduce((t, b) => t + b.boostBps, 0);
  return 1 + Math.min(bps, MAX_TOTAL_BOOST_BPS) / 10_000;
}

export const earnPerMinute = (s, factor = 1) => 0.15 * EARN_SCALE * factor * attrs(s).efficiency * SNEAKER_TYPES[s.type].mult;
export const earnPerEnergy = (s, factor = 1) => earnPerMinute(s, factor) * MINUTES_PER_ENERGY;
// Costs scale with the emission factor (whole RUNNER, never below 1) so they stay in
// proportion to what a sneaker earns after each halving.
export const levelUpCost = (s, factor = 1, settings = DEFAULT_SETTINGS) => Math.max(1, Math.round(settings.levelCostBase * (s.level + 1) ** settings.levelCostExp * factor));
export const repairCost = (s, factor = 1) => (s.durability >= 100 ? 0 : Math.max(1, Math.ceil((100 - s.durability) * 0.1 * EARN_SCALE * factor * (1 + s.level * 0.1))));
// ~5.4 per energy for a typical Common: 100 → 50 in about 9 days of one energy a day.
export const durabilityLossPerEnergy = (s) => Math.max(1, 6 - attrs(s).resilience * 0.1);

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
  constructor(sneaker, energyAvailable, factor = 1) {
    this.sneaker = sneaker ? structuredClone(sneaker) : null;
    this.factor = factor;
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
    this.coins += (earnPerMinute(s, this.factor) * dt * frac / 60) * (hasHr ? HR_BONUS : 1);
    this.zoneSec += dt * frac;
    if (hasHr) this.hrSec += dt * frac;
    return (this.status = 'earning');
  }

  toJSON() {
    const { sneaker, energyStart, used, coins, zoneSec, offSec, vehicleSec, hrSec, factor } = this;
    return { sneakerId: sneaker?.id, energyStart, used, coins, zoneSec, offSec, vehicleSec, hrSec, factor };
  }
}

// ---------------------------------------------------------------- energy + track scoring
/** Energy after refilling from `energyAt` to `now` (full refill takes 24 h). */
export function regenEnergy(energy, energyAt, max, now = Date.now()) {
  const hours = Math.max(0, now - energyAt) / 3.6e6;
  return Math.min(max, energy + (hours * max) / 24); // also trims energy saved under an older, higher max
}

const TRAIL_MS = 20000;      // same window as Recorder.currentSpeed
const GAP_MAX_S = 120;       // longer gaps between fixes don't earn
const TELEPORT_MS = 15;      // a single jump faster than this (54 km/h) is a vehicle/teleport

/**
 * Replays a recorded GPS track ({t, lat, lon, hr?, b?} points, b = resumed after
 * pause) through EarnSession, the same way the app does live. The server uses
 * this to decide what a run really earned.
 */
export function scoreTrack(points, sneaker, energyAvailable, factor = 1) {
  const session = new EarnSession(sneaker, energyAvailable, factor);
  for (let i = 1; i < points.length; i++) {
    const p = points[i], prev = points[i - 1];
    if (p.b) continue;                                   // pause: no time counted
    const dt = (p.t - prev.t) / 1000;
    if (!(dt > 0)) continue;
    const seg = haversine(prev.lat, prev.lon, p.lat, p.lon) / dt;
    if (dt > GAP_MAX_S) { session.tick(0, false, dt); continue; }
    let d = 0, j = i;
    while (j > 0 && !points[j].b && p.t - points[j - 1].t <= TRAIL_MS) {
      d += haversine(points[j - 1].lat, points[j - 1].lon, points[j].lat, points[j].lon);
      j--;
    }
    const span = (p.t - points[j].t) / 1000;
    let speed = span > 0 && j < i ? d / span : seg;
    if (seg > TELEPORT_MS) speed = Math.max(speed, seg);
    session.tick(speed, !!p.hr, dt);
  }
  return session;
}

/** Mostly vehicle speeds → the run earns nothing (same rule as the app). */
export const isVoided = (session) => {
  const total = session.zoneSec + session.offSec + session.vehicleSec;
  return session.vehicleSec > total * 0.5;
};
