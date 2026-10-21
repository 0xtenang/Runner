// Importers for smartwatch activity files.
//   .fit  — Garmin, COROS, Wahoo, Suunto, Polar, Apple Watch exporters (binary)
//   .gpx  — almost every platform
//   .tcx  — Garmin Training Center / Polar / Fitbit
//   .zip  — Garmin Connect "Export Original" and bulk exports
// Every parser returns { type, name?, startTime, points[], summary?, device? }
// where points are { t(ms), lat?, lon?, ele?, hr?, cad?, d?(m) }.

export const SUPPORTED = ['fit', 'gpx', 'tcx', 'zip'];

export function mapType(s) {
  s = String(s ?? '').toLowerCase();
  if (/run|jog|trail|treadmill/.test(s)) return 'run';
  if (/bik|cycl|ride|bicycl/.test(s)) return 'ride';
  if (/hik/.test(s)) return 'hike';
  if (/walk/.test(s)) return 'walk';
  if (s === '9') return 'run'; // GPX type codes used by some exporters
  if (s === '1') return 'ride';
  return s ? 'workout' : 'run';
}

/** Parses one File (or {name, arrayBuffer()}) into zero or more activities. */
export async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'fit') return [parseFIT(await file.arrayBuffer())];
  if (ext === 'gpx') return [parseGPX(await file.text())];
  if (ext === 'tcx') return [parseTCX(await file.text())];
  if (ext === 'zip') {
    if (!window.JSZip) throw new Error('ZIP support failed to load');
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const out = [];
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const e = entry.name.split('.').pop().toLowerCase();
      if (!['fit', 'gpx', 'tcx'].includes(e)) continue;
      try {
        if (e === 'fit') out.push(parseFIT(await entry.async('arraybuffer')));
        else {
          const text = await entry.async('string');
          out.push(e === 'gpx' ? parseGPX(text) : parseTCX(text));
        }
      } catch (err) {
        console.warn('Skipping', entry.name, err);
      }
    }
    if (!out.length) throw new Error('No FIT, GPX or TCX activities inside this ZIP');
    return out;
  }
  throw new Error(`Unsupported file type .${ext}`);
}

// ======================================================================
// FIT (Flexible and Interoperable Data Transfer) — Garmin's binary format
// ======================================================================

const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z
const SEMICIRCLE = 180 / 2 ** 31;
const BASE_SIZE = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 1, 8: 4, 9: 8, 10: 1, 11: 2, 12: 4, 13: 1, 14: 8, 15: 8, 16: 8 };
const FIT_SPORT = { 1: 'run', 2: 'ride', 11: 'walk', 17: 'hike' };
const FIT_MANUFACTURER = { 1: 'Garmin', 23: 'Suunto', 32: 'Wahoo', 123: 'Polar', 294: 'COROS', 255: 'Development', 265: 'Strava', 260: 'Zwift' };

function readField(dv, pos, f, little) {
  const bt = f.base & 0x1f;
  if (BASE_SIZE[bt] == null || f.size !== BASE_SIZE[bt]) return null; // arrays/strings: not needed
  let v;
  switch (bt) {
    case 0: case 2: v = dv.getUint8(pos); return v === 0xff ? null : v;
    case 1: v = dv.getInt8(pos); return v === 0x7f ? null : v;
    case 3: v = dv.getInt16(pos, little); return v === 0x7fff ? null : v;
    case 4: v = dv.getUint16(pos, little); return v === 0xffff ? null : v;
    case 5: v = dv.getInt32(pos, little); return v === 0x7fffffff ? null : v;
    case 6: v = dv.getUint32(pos, little); return v === 0xffffffff ? null : v;
    case 8: v = dv.getFloat32(pos, little); return Number.isFinite(v) ? v : null;
    case 9: v = dv.getFloat64(pos, little); return Number.isFinite(v) ? v : null;
    case 10: v = dv.getUint8(pos); return v === 0 ? null : v;
    case 11: v = dv.getUint16(pos, little); return v === 0 ? null : v;
    case 12: v = dv.getUint32(pos, little); return v === 0 ? null : v;
    case 13: v = dv.getUint8(pos); return v === 0xff ? null : v;
    default: return null;
  }
}

export function parseFIT(buffer) {
  const dv = new DataView(buffer);
  if (buffer.byteLength < 14) throw new Error('File too small to be FIT');
  const headerSize = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== '.FIT') throw new Error('Not a FIT file');

  const records = [];
  let session = null, sport = null, manufacturer = null, created = null;
  let pos = headerSize;
  let fileEnd = headerSize + dv.getUint32(4, true);

  // FIT files may be chained (several files back-to-back); loop over each.
  while (pos < buffer.byteLength) {
    const defs = {};
    let lastTs = 0;
    const end = Math.min(fileEnd, buffer.byteLength);
    while (pos < end) {
      const h = dv.getUint8(pos++);
      if (!(h & 0x80) && (h & 0x40)) {
        // Definition message
        const local = h & 0x0f;
        const hasDev = h & 0x20;
        pos++; // reserved
        const little = dv.getUint8(pos++) === 0;
        const global = dv.getUint16(pos, little); pos += 2;
        const n = dv.getUint8(pos++);
        const fields = [];
        let size = 0;
        for (let i = 0; i < n; i++, pos += 3) {
          const f = { num: dv.getUint8(pos), size: dv.getUint8(pos + 1), base: dv.getUint8(pos + 2) };
          fields.push(f); size += f.size;
        }
        if (hasDev) {
          const nd = dv.getUint8(pos++);
          for (let i = 0; i < nd; i++, pos += 3) size += dv.getUint8(pos + 1);
        }
        defs[local] = { global, little, fields, size };
        continue;
      }

      let local, ts = null;
      if (h & 0x80) {
        // Compressed-timestamp header: 5-bit offset from the last full timestamp
        local = (h >> 5) & 0x03;
        const off = h & 0x1f;
        ts = (lastTs & ~0x1f) + off;
        if (off < (lastTs & 0x1f)) ts += 0x20;
        lastTs = ts;
      } else {
        local = h & 0x0f;
      }
      const def = defs[local];
      if (!def) throw new Error('Corrupt FIT file (missing definition)');
      if (pos + def.size > buffer.byteLength) break;

      const m = {};
      let p = pos;
      for (const f of def.fields) { m[f.num] = readField(dv, p, f, def.little); p += f.size; }
      pos += def.size;
      if (m[253] != null) { lastTs = m[253]; ts = m[253]; }

      switch (def.global) {
        case 0: // file_id
          if (m[1] != null) manufacturer = m[1];
          if (m[4] != null) created = (m[4] + FIT_EPOCH_S) * 1000;
          break;
        case 12: // sport
          if (m[0] != null) sport = m[0];
          break;
        case 18: // session — device-computed totals, the most accurate source
          session = {
            sport: m[5], start: m[2] != null ? (m[2] + FIT_EPOCH_S) * 1000 : null,
            elapsed: m[7] != null ? m[7] / 1000 : null,
            timer: m[8] != null ? m[8] / 1000 : null,
            distance: m[9] != null ? m[9] / 100 : null,
            avgHr: m[16], maxHr: m[17], ascent: m[22],
          };
          break;
        case 20: { // record — one track point
          if (ts == null) break;
          const pt = { t: (ts + FIT_EPOCH_S) * 1000 };
          if (m[0] != null && m[1] != null) { pt.lat = m[0] * SEMICIRCLE; pt.lon = m[1] * SEMICIRCLE; }
          const alt = m[78] ?? m[2];
          if (alt != null) pt.ele = alt / 5 - 500;
          if (m[3] != null) pt.hr = m[3];
          if (m[4] != null) pt.cad = m[4];
          if (m[5] != null) pt.d = m[5] / 100;
          records.push(pt);
          break;
        }
      }
    }
    // Skip CRC and look for a chained file header.
    pos = fileEnd + 2;
    if (pos + 12 > buffer.byteLength) break;
    const hs = dv.getUint8(pos);
    const s2 = String.fromCharCode(dv.getUint8(pos + 8), dv.getUint8(pos + 9), dv.getUint8(pos + 10), dv.getUint8(pos + 11));
    if (s2 !== '.FIT') break;
    fileEnd = pos + hs + dv.getUint32(pos + 4, true);
    pos += hs;
  }

  if (!records.length && !session) throw new Error('FIT file has no activity data (is it a settings or course file?)');

  const sportCode = session?.sport ?? sport;
  return {
    format: 'fit',
    type: FIT_SPORT[sportCode] || (sportCode == null ? 'run' : 'workout'),
    startTime: session?.start || records[0]?.t || created,
    points: records,
    device: FIT_MANUFACTURER[manufacturer] || null,
    summary: session ? {
      distance: session.distance, movingTime: session.timer, elapsedTime: session.elapsed,
      elevGain: session.ascent, avgHr: session.avgHr, maxHr: session.maxHr,
    } : null,
  };
}

// ======================================================================
// XML formats
// ======================================================================

function xml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');
  return doc;
}
const byName = (el, name) => el.getElementsByTagNameNS('*', name);
const first = (el, name) => byName(el, name)[0] ?? null;
const num = (el, name) => {
  const n = first(el, name);
  if (!n) return undefined;
  const v = parseFloat(n.textContent);
  return Number.isFinite(v) ? v : undefined;
};

export function parseGPX(text) {
  const doc = xml(text);
  let nodes = [...byName(doc, 'trkpt')];
  if (!nodes.length) nodes = [...byName(doc, 'rtept')];
  if (!nodes.length) throw new Error('GPX has no track points');
  const points = [];
  for (const n of nodes) {
    const time = first(n, 'time');
    const t = time ? Date.parse(time.textContent) : NaN;
    if (!Number.isFinite(t)) continue;
    const p = { t, lat: parseFloat(n.getAttribute('lat')), lon: parseFloat(n.getAttribute('lon')) };
    const ele = num(n, 'ele'); if (ele != null) p.ele = ele;
    const hr = num(n, 'hr'); if (hr) p.hr = hr;
    const cad = num(n, 'cad'); if (cad != null) p.cad = cad;
    points.push(p);
  }
  if (!points.length) throw new Error('GPX track has no timestamps (route files can\'t be imported as activities)');
  const trk = first(doc, 'trk');
  const name = trk && [...trk.children].find((c) => c.localName === 'name')?.textContent?.trim();
  const type = trk && [...trk.children].find((c) => c.localName === 'type')?.textContent?.trim();
  const creator = doc.documentElement.getAttribute('creator') || '';
  return { format: 'gpx', type: mapType(type), name: name || null, startTime: points[0].t, points, device: deviceFrom(creator) };
}

export function parseTCX(text) {
  const doc = xml(text);
  const act = first(doc, 'Activity');
  if (!act) throw new Error('TCX has no Activity');
  const points = [];
  for (const n of byName(act, 'Trackpoint')) {
    const time = first(n, 'Time');
    const t = time ? Date.parse(time.textContent) : NaN;
    if (!Number.isFinite(t)) continue;
    const p = { t };
    const lat = num(n, 'LatitudeDegrees'), lon = num(n, 'LongitudeDegrees');
    if (lat != null && lon != null) { p.lat = lat; p.lon = lon; }
    const ele = num(n, 'AltitudeMeters'); if (ele != null) p.ele = ele;
    const d = num(n, 'DistanceMeters'); if (d != null) p.d = d;
    const hrEl = first(n, 'HeartRateBpm');
    if (hrEl) { const hr = num(hrEl, 'Value'); if (hr) p.hr = hr; }
    const cad = num(n, 'Cadence') ?? num(n, 'RunCadence'); if (cad != null) p.cad = cad;
    points.push(p);
  }
  let dist = 0, time = 0, hasLaps = false;
  for (const lap of byName(act, 'Lap')) {
    hasLaps = true;
    dist += num(lap, 'DistanceMeters') ?? 0;
    time += num(lap, 'TotalTimeSeconds') ?? 0;
  }
  const idEl = first(act, 'Id');
  const startTime = idEl ? Date.parse(idEl.textContent) : points[0]?.t;
  const creatorName = first(act, 'Creator') && first(first(act, 'Creator'), 'Name')?.textContent;
  if (!points.length && !hasLaps) throw new Error('TCX has no track points');
  return {
    format: 'tcx',
    type: mapType(act.getAttribute('Sport')),
    startTime: Number.isFinite(startTime) ? startTime : points[0]?.t,
    points,
    device: deviceFrom(creatorName || ''),
    summary: hasLaps ? { distance: dist || null, movingTime: time || null } : null,
  };
}

function deviceFrom(s) {
  s = s.toLowerCase();
  for (const [k, v] of [['garmin', 'Garmin'], ['coros', 'COROS'], ['suunto', 'Suunto'], ['polar', 'Polar'],
    ['wahoo', 'Wahoo'], ['fitbit', 'Fitbit'], ['apple', 'Apple Watch'], ['healthfit', 'Apple Watch'], ['strava', 'Strava'], ['amazfit', 'Amazfit'], ['zepp', 'Amazfit']]) {
    if (s.includes(k)) return v;
  }
  return null;
}
