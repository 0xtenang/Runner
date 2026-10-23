// Track "trust score" for the rewards server: how much an uploaded run looks like a
// real phone moving outdoors. Real GPS is messy — fixes arrive at slightly irregular
// times, speed wobbles, the route bends, reported accuracy changes. Generated or
// spoofed tracks tend to be too clean. A low score never removes earnings by itself:
// the run is held for a person to review (see api/rewards.js).
//
// From the phone app the run also carries the phone's step counter (CMPedometer /
// Android step sensor) and how many fake-GPS fixes the recorder threw away. Running
// is about 140–190 steps a minute; on a bike, scooter or in a car the counter barely
// moves, so steps that don't match the GPS pace lower the score.
import { haversine } from '../../js/stats.js';
import { keccak, toHex } from './eth.js';

export const TRUST_REVIEW_BELOW = 70;

const bearing = (a, b) => {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return Math.atan2(y, x);
};

/**
 * { score 0–100, reasons[], cadence } for a cleaned track ({t, lat, lon, acc?, ele?, b?} points).
 * extra: { steps (see cleanSteps), mockFixes, fromApp (the upload came from the phone app) }.
 */
export function trustScore(pts, { steps = null, mockFixes = 0, fromApp = false } = {}) {
  const reasons = [];
  let score = 100;
  const dts = [], speeds = [], dists = [], angles = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].b) continue;
    const dt = pts[i].t - pts[i - 1].t;
    const d = haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    dts.push(dt);
    total += d;
    if (dt > 0 && d / (dt / 1000) > 1) { speeds.push(d / (dt / 1000)); dists.push(Math.round(d * 10)); }
    if (d > 3) angles.push(bearing(pts[i - 1], pts[i]));
  }
  // 1. Fixes at exactly the same interval every time (a script, not a GPS chip).
  if (dts.length >= 30) {
    const counts = new Map();
    for (const dt of dts) counts.set(dt, (counts.get(dt) || 0) + 1);
    const top = Math.max(...counts.values());
    if (top / dts.length > 0.9) { score -= 35; reasons.push('GPS fixes arrive at perfectly regular times'); }
  }
  // 2. Speed that never wobbles.
  if (speeds.length >= 30) {
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length);
    if (sd / mean < 0.04) { score -= 30; reasons.push('Speed is unnaturally constant'); }
  }
  // 3. Every segment the same length.
  if (dists.length >= 30) {
    const counts = new Map();
    for (const d of dists) counts.set(d, (counts.get(d) || 0) + 1);
    if (Math.max(...counts.values()) / dists.length > 0.8) { score -= 25; reasons.push('Every segment of the track is the same length'); }
  }
  // 4. A perfectly straight line over a long distance.
  if (angles.length >= 30 && total > 500) {
    const sx = angles.reduce((a, t) => a + Math.cos(t), 0), sy = angles.reduce((a, t) => a + Math.sin(t), 0);
    if (Math.hypot(sx, sy) / angles.length > 0.995) { score -= 20; reasons.push('Route is a perfectly straight line'); }
  }
  // 5. Reported accuracy that never changes (only when the app recorded it).
  const accs = pts.map((p) => p.acc).filter((a) => a != null);
  if (accs.length >= 30 && accs.length >= pts.length / 2 && new Set(accs).size === 1) { score -= 15; reasons.push('GPS accuracy never changes'); }
  // 6. A fake-GPS (mock location) app fed the phone positions during the run.
  if (mockFixes > 0) { score -= 50; reasons.push('A fake-GPS (mock location) app was running'); }
  // 7. Step cadence vs pace.
  let cadence = null;
  if (steps?.samples) {
    const c = cadenceCheck(pts, steps.samples);
    cadence = c.spm;
    if (c.minutes >= 3 && c.mismatch / c.minutes >= 0.5) { score -= 45; reasons.push(`Steps don't match the pace (${c.spm ?? 0} steps/min while moving) — looks like a bike, scooter or car`); }
    else if (c.minutes >= 3 && c.mismatch / c.minutes >= 0.25) { score -= 20; reasons.push("Steps don't match the pace for part of the run"); }
  } else if (fromApp) {
    if (steps?.unavailable) { score -= 10; reasons.push('This phone has no step counter'); }
    else if (steps?.denied) { score -= 15; reasons.push('Step counter (motion & fitness) permission is off'); }
    else { score -= 15; reasons.push('No step-counter data from the phone'); }
  }
  return { score: Math.max(0, score), reasons, cadence };
}

const MAX_STEP_SAMPLES = 20000;
/**
 * Validates the step data an upload carries: { samples: [[t, steps since start], …] }
 * (time-ordered, never decreasing), or { denied | unavailable | lost: true }. Returns null if absent.
 */
export function cleanSteps(raw, start, end) {
  if (raw == null) return null;
  if (raw.denied) return { denied: true };
  if (raw.unavailable) return { unavailable: true };
  if (!Array.isArray(raw.samples)) return { lost: true };
  if (raw.samples.length > MAX_STEP_SAMPLES) return null;
  const samples = [];
  let lastT = -Infinity, lastN = 0;
  for (const s of raw.samples) {
    const t = Number(s?.[0]), n = Number(s?.[1]);
    if (!Number.isFinite(t) || !Number.isFinite(n) || t < lastT || n < lastN || n > 1e6) return { lost: true };
    if (t < start - 10 * 60e3 || t > end + 10 * 60e3) continue;
    samples.push([t, n]);
    lastT = t; lastN = n;
  }
  return samples.length >= 2 ? { samples } : { lost: true };
}

/** Steps since start at time t (linear between samples, flat outside them). */
function stepsAt(samples, t) {
  if (t <= samples[0][0]) return samples[0][1];
  for (let i = 1; i < samples.length; i++) {
    const [t1, n1] = samples[i];
    if (t <= t1) { const [t0, n0] = samples[i - 1]; return t1 === t0 ? n1 : n0 + ((n1 - n0) * (t - t0)) / (t1 - t0); }
  }
  return samples[samples.length - 1][1];
}

const MOVING_MS = 1.4;        // ≈5 km/h: slower minutes aren't checked
const RUNNING_MS = 2.5;       // ≈9 km/h: clearly running, needs a running cadence
/**
 * Compares the step counter with GPS speed minute by minute. A moving minute
 * "mismatches" with almost no steps (<50/min), a walking cadence at running pace
 * (<120/min at ≥9 km/h) or strides longer than 2.6 m.
 * Returns { minutes (moving), mismatch, spm (average while moving) }.
 */
export function cadenceCheck(pts, samples) {
  const buckets = new Map();
  const t0 = pts[0].t;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].b) continue;
    const a = pts[i - 1], b = pts[i];
    const k = Math.floor((a.t - t0) / 60e3);
    const x = buckets.get(k) || { d: 0, dt: 0, from: a.t, to: a.t };
    x.d += haversine(a.lat, a.lon, b.lat, b.lon);
    x.dt += b.t - a.t;
    x.to = b.t;
    buckets.set(k, x);
  }
  let minutes = 0, mismatch = 0, steps = 0, ms = 0;
  for (const x of buckets.values()) {
    if (x.dt < 40e3 || x.to - x.from > 2 * x.dt) continue; // too little data, or a pause inside
    const speed = x.d / (x.dt / 1000);
    if (speed < MOVING_MS) continue;
    const n = stepsAt(samples, x.to) - stepsAt(samples, x.from);
    const spm = n / (x.dt / 60e3);
    minutes++; steps += n; ms += x.dt;
    if (spm < 50 || (speed >= RUNNING_MS && spm < 120) || (speed * 60) / spm > 2.6) mismatch++;
  }
  return { minutes, mismatch, spm: ms ? Math.round(steps / (ms / 60e3)) : null };
}

/** Fingerprint of a route's shape (relative to its start, ~11 m grid) to spot copied tracks. */
export function trackFingerprint(pts) {
  if (pts.length < 20) return null;
  const step = Math.max(1, Math.floor(pts.length / 40));
  const o = pts[0];
  const shape = [];
  for (let i = 0; i < pts.length; i += step) shape.push(`${(pts[i].lat - o.lat).toFixed(4)},${(pts[i].lon - o.lon).toFixed(4)}`);
  return toHex(keccak(`${o.lat.toFixed(4)},${o.lon.toFixed(4)}|${shape.join(';')}`)).slice(0, 32);
}
