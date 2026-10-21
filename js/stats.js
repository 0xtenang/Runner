// Distance, pace, splits and formatting helpers shared by every view.

const EARTH_R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

const hasPos = (p) => p.lat != null && p.lon != null;

/**
 * Annotates each point with cumulative distance (cd, metres) and cumulative
 * moving time (mt, seconds), and returns the activity totals.
 * Points with `b` start a new segment (resume after pause), so no distance or
 * time is counted across the gap.
 */
export function annotate(points) {
  let dist = 0, moving = 0, gain = 0, hrSum = 0, hrN = 0, maxHr = 0;
  let refEle = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0 && !p.b) {
      const q = points[i - 1];
      const dt = (p.t - q.t) / 1000;
      let dd = 0;
      if (p.d != null && q.d != null) dd = Math.max(0, p.d - q.d); // device-measured (footpod/treadmill)
      else if (hasPos(p) && hasPos(q)) dd = haversine(q.lat, q.lon, p.lat, p.lon);
      dist += dd;
      // Count as moving if faster than a slow shuffle and not a long gap (auto-pause on device).
      if (dt > 0 && dt <= 30 && dd / dt > 0.4) moving += dt;
    }
    p.cd = dist;
    p.mt = moving;
    if (p.ele != null) {
      // 3 m hysteresis filters out GPS/barometer noise.
      if (refEle == null) refEle = p.ele;
      else if (Math.abs(p.ele - refEle) >= 3) {
        if (p.ele > refEle) gain += p.ele - refEle;
        refEle = p.ele;
      }
    }
    if (p.hr) { hrSum += p.hr; hrN++; if (p.hr > maxHr) maxHr = p.hr; }
  }
  const first = points[0], last = points[points.length - 1];
  return {
    distance: dist,
    movingTime: moving,
    elapsedTime: first && last ? (last.t - first.t) / 1000 : 0,
    elevGain: gain,
    avgHr: hrN ? Math.round(hrSum / hrN) : null,
    maxHr: hrN ? maxHr : null,
  };
}

/** Per-km (or per-mile) splits from annotated points. */
export function computeSplits(points, unitM) {
  const splits = [];
  if (points.length < 2) return splits;
  let k = 1, startMt = 0, startEle = points[0].ele ?? null, hrSum = 0, hrN = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i], q = points[i - 1];
    if (p.hr) { hrSum += p.hr; hrN++; }
    while (p.cd >= k * unitM) {
      const span = p.cd - q.cd || 1;
      const frac = (k * unitM - q.cd) / span;
      const mt = q.mt + frac * (p.mt - q.mt);
      const ele = p.ele ?? null;
      splits.push({
        n: k, dist: unitM, time: mt - startMt,
        elev: ele != null && startEle != null ? ele - startEle : null,
        hr: hrN ? Math.round(hrSum / hrN) : null,
      });
      startMt = mt; startEle = ele; hrSum = 0; hrN = 0; k++;
    }
  }
  const last = points[points.length - 1];
  const rest = last.cd - (k - 1) * unitM;
  if (rest > unitM * 0.05) {
    splits.push({
      n: k, dist: rest, time: last.mt - startMt, partial: true,
      elev: last.ele != null && startEle != null ? last.ele - startEle : null,
      hr: hrN ? Math.round(hrSum / hrN) : null,
    });
  }
  return splits;
}

/** Downsamples to at most n items, always keeping the last one. */
export function downsample(arr, n) {
  if (arr.length <= n) return arr.slice();
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  out[out.length - 1] = arr[arr.length - 1];
  return out;
}

/** Smoothed speed (m/s) at each index using a trailing distance window. */
export function speedSeries(points, windowM = 150) {
  const out = new Array(points.length).fill(null);
  let j = 0;
  for (let i = 1; i < points.length; i++) {
    while (j < i - 1 && points[i].cd - points[j + 1].cd >= windowM) j++;
    const dd = points[i].cd - points[j].cd;
    const dt = points[i].mt - points[j].mt;
    out[i] = dt > 0 ? dd / dt : null;
  }
  out[0] = out[1] ?? null;
  return out;
}

// ---------- units & formatting ----------

export const units = {
  get() { try { return localStorage.getItem('runearn.units') || 'km'; } catch { return 'km'; } },
  set(v) { try { localStorage.setItem('runearn.units', v); } catch { /* storage unavailable */ } },
  meters() { return this.get() === 'mi' ? 1609.344 : 1000; },
  label() { return this.get() === 'mi' ? 'mi' : 'km'; },
};

export function fmtDist(m, withUnit = true) {
  const v = (m || 0) / units.meters();
  const s = v >= 100 ? v.toFixed(0) : v.toFixed(2);
  return withUnit ? `${s} ${units.label()}` : s;
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Pace from metres + seconds, e.g. "5:12 /km". */
export function fmtPace(meters, seconds, withUnit = true) {
  if (!meters || !seconds || meters < 1) return '–';
  const secPerUnit = (seconds / meters) * units.meters();
  if (secPerUnit > 60 * 60) return '–';
  const m = Math.floor(secPerUnit / 60), s = Math.round(secPerUnit % 60);
  const str = s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
  return withUnit ? `${str} /${units.label()}` : str;
}

export function fmtSpeed(meters, seconds, withUnit = true) {
  if (!meters || !seconds) return '–';
  const perHour = (meters / seconds) * 3600 / units.meters();
  return withUnit ? `${perHour.toFixed(1)} ${units.label()}/h` : perHour.toFixed(1);
}

export function fmtElev(m) {
  if (m == null) return '–';
  return units.get() === 'mi' ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`;
}
