// Track "trust score" for the rewards server: how much an uploaded run looks like a
// real phone moving outdoors. Real GPS is messy — fixes arrive at slightly irregular
// times, speed wobbles, the route bends, reported accuracy changes. Generated or
// spoofed tracks tend to be too clean. A low score never removes earnings by itself:
// the run is held for a person to review (see api/rewards.js).
import { haversine } from '../../js/stats.js';
import { keccak, toHex } from './eth.js';

export const TRUST_REVIEW_BELOW = 70;

const bearing = (a, b) => {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return Math.atan2(y, x);
};

/** { score 0–100, reasons[] } for a cleaned track ({t, lat, lon, acc?, ele?, b?} points). */
export function trustScore(pts) {
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
  return { score: Math.max(0, score), reasons };
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
