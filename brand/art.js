// RUNNER brand art — original SVG drawn in code: a sliced italic wordmark (Anton
// outlines, SIL OFL — see brand/Anton-OFL.txt) and two sprinters in flat colour with
// ink outlines, on a vermilion "track" background. Used for the app icon, OpenSea
// logo/banner (api/_meta.js) and social images. Run `node brand/build.mjs` to export.
import glyphsJson from './glyphs.json' with { type: 'json' };
import { sneakerSvg } from '../js/sneaker-art.js';

const G = glyphsJson.glyphs;

export const PALETTE = {
  red: '#E8483B',     // track vermilion
  redDeep: '#C9362B',
  ink: '#141414',
  paper: '#FFF8EF',
  lime: '#A3E635',    // RUNNER brand
  limeDeep: '#6FA81A',
  blue: '#2F5BEA',
  blueDeep: '#1D3FB8',
  skin: '#F3C9A4',
  skinShade: '#D9A07A',
};
const P = PALETTE;
const TAN12 = Math.tan((12 * Math.PI) / 180);

// ------------------------------------------------------------------ wordmark
/**
 * Italic RUNNER wordmark with a horizontal "speed cut" through the letters.
 * Returns { svg, width, height } in its own units.
 */
export function wordmark({ size = 200, fill = P.paper, cut = true, tagline = true, taglineFill = fill, id = 'wm' } = {}) {
  const k = size / G.wordmark.size;
  const h = -G.wordmark.top * k;
  const w = G.wordmark.width * k + h * TAN12;
  const cutY = h * 0.62, cutH = Math.max(3, h * 0.055);
  const mask = cut ? `<mask id="${id}-cut" maskUnits="userSpaceOnUse" x="-20" y="-20" width="${w + 40}" height="${h + 40}">
      <rect x="-20" y="-20" width="${w + 40}" height="${h + 40}" fill="#fff"/>
      <polygon points="-20,${cutY} ${w + 20},${cutY - h * 0.05} ${w + 20},${cutY - h * 0.05 + cutH} -20,${cutY + cutH}" fill="#000"/>
    </mask>` : '';
  const word = `<g ${cut ? `mask="url(#${id}-cut)"` : ''}><g transform="translate(${h * TAN12} ${h}) skewX(-12) scale(${k})"><path d="${G.wordmark.d}" fill="${fill}"/></g></g>`;
  let tag = '', th = 0;
  if (tagline) {
    const tk = (size * 0.2) / G.tagline.size;
    th = -G.tagline.top * tk;
    const tw = G.tagline.width * tk;
    const ty = h + size * 0.07;
    tag = `<g transform="translate(${w - tw - th * TAN12} ${ty + th}) skewX(-12) scale(${tk})"><path d="${G.tagline.d}" fill="${taglineFill}"/></g>
      <polygon points="${w * 0.02},${ty + th * 0.62} ${w - tw - th * 0.9},${ty + th * 0.5} ${w - tw - th * 0.9},${ty + th * 0.5 + Math.max(2, size * 0.022)} ${w * 0.02},${ty + th * 0.62 + Math.max(2, size * 0.022)}" fill="${taglineFill}"/>`;
  }
  return { svg: `<defs>${mask}</defs>${word}${tag}`, width: w, height: h + (tagline ? th + size * 0.1 : 0) };
}

/** Big italic R with the speed cut (app icon mark). */
export function rMark({ size = 300, fill = P.paper, id = 'rm' } = {}) {
  const k = size / G.r.size, h = -G.r.top * k, off = h * TAN12;
  const w = G.r.width * k + off;
  const cutY = h * 0.6, cutH = h * 0.07;
  return {
    svg: `<defs><mask id="${id}-cut" maskUnits="userSpaceOnUse" x="-50" y="-50" width="${w + 100}" height="${h + 100}"><rect x="-50" y="-50" width="${w + 100}" height="${h + 100}" fill="#fff"/><polygon points="-50,${cutY} ${w + 50},${cutY - h * 0.06} ${w + 50},${cutY - h * 0.06 + cutH} -50,${cutY + cutH}" fill="#000"/></mask></defs>
      <g mask="url(#${id}-cut)"><g transform="translate(${off} ${h}) skewX(-12) scale(${k})"><path d="${G.r.d}" fill="${fill}"/></g></g>`,
    width: w, height: h,
  };
}

// ------------------------------------------------------------------ racing sneakers
// Two RUNNER Genesis-style sneakers (same art as the NFTs) racing, with motion streaks.
export const RACER_LIME = { model: 'stride', hue: 84, accent: 222, midTone: 0, pattern: 'mesh', laces: 'dark', edition: 'standard', rarity: 'epic' };
export const RACER_BLUE = { model: 'pod', hue: 224, accent: 84, midTone: 0, pattern: 'knit', laces: 'light', edition: 'standard', rarity: 'rare' };

/** Sneaker (244×120 art) at x,y with width w, tilted forward, with streaks trailing left. */
function racer(s, x, y, w, { tilt = -9, streaks = 7, seed = 5 } = {}) {
  const k = w / 244, hgt = 120 * k;
  let r = seed; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  let lines = '';
  for (let i = 0; i < streaks; i++) {
    const yy = hgt * (0.28 + 0.6 * (i / Math.max(1, streaks - 1))) + (rnd() - 0.5) * hgt * 0.06;
    const len = w * (0.4 + rnd() * 0.55), th = hgt * (0.035 + rnd() * 0.035);
    const x0 = w * 0.12;
    lines += `<path d="M${x0},${yy - th} L${x0 - len},${yy - th * 0.15} L${x0 - len},${yy + th * 0.15} L${x0},${yy + th} Z" fill="${P.paper}" opacity="${(0.25 + rnd() * 0.4).toFixed(2)}"/>`;
  }
  const art = sneakerSvg(s, 'art').replace('<svg ', `<svg x="0" y="0" width="${w}" height="${hgt}" `);
  return `<g transform="translate(${x} ${y}) rotate(${tilt} ${w / 2} ${hgt / 2})">${lines}${art}</g>`;
}

/** The pair: lime in front, blue just behind and above — the two runners, as sneakers. */
export function racers(w) {
  return `${racer(RACER_BLUE, w * 0.18, -w * 0.16, w * 0.62, { tilt: -12, seed: 11, streaks: 6 })}
    ${racer(RACER_LIME, 0, 0, w * 0.82, { tilt: -8, seed: 5 })}`;
}

/** Slanted track lanes (white lines) across a w×h box. */
function lanes(w, h, { y0 = 0.62, gap = 0.16, count = 3, opacity = 0.32 } = {}) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const y = h * (y0 + gap * i);
    out += `<path d="M${-w * 0.05},${y + h * 0.18} L${w * 1.05},${y - h * 0.18}" stroke="${P.paper}" stroke-width="${Math.max(2, h * 0.012)}" opacity="${opacity}"/>`;
  }
  return out;
}

/** Diagonal speed lines across a w×h box. */
export function speedLines(w, h, { color = P.paper, opacity = 0.22, count = 18, seed = 7 } = {}) {
  let s = seed; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  let out = '';
  for (let i = 0; i < count; i++) {
    const y = r() * h, len = w * (0.15 + r() * 0.35), x = r() * w, t = 1 + r() * 3;
    out += `<path d="M${x.toFixed(0)},${y.toFixed(0)} l${len.toFixed(0)},${(-len * 0.18).toFixed(0)}" stroke="${color}" stroke-width="${t.toFixed(1)}" stroke-linecap="round" opacity="${opacity}"/>`;
  }
  return out;
}

// ------------------------------------------------------------------ partner character
/**
 * IMD's character artwork (provided by IMD, who confirmed the rights): { href (data URI), aspect (w/h) }.
 * Without it a dashed placeholder marks the spot.
 */
/** One dressed Pepe ({ href, extra, aspect }) standing on (x, y + hgt), with trailing streaks. */
function pepe(pp, x, y, hgt, seed = 13, part = 'all') {
  const w = hgt * (pp.aspect || 240 / 284);
  let r = seed; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  let trail = '';
  for (let i = 0; i < 8; i++) {
    const yy = y + hgt * (0.34 + 0.48 * (i / 7)), len = w * (0.6 + rnd() * 0.9), th = hgt * (0.012 + rnd() * 0.016), x0 = x - w * 0.02;
    trail += `<path d="M${x0},${yy} L${x0 - len * 0.18},${yy - th} L${x0 - len},${yy - th * 0.12} L${x0 - len},${yy + th * 0.12} L${x0 - len * 0.18},${yy + th} Z" fill="${P.paper}" opacity="${(0.25 + rnd() * 0.4).toFixed(2)}"/>`;
  }
  const k = hgt / 284;
  if (part === 'trail') return trail;
  const body = `<ellipse cx="${x}" cy="${y + hgt * 0.985}" rx="${w * 0.34}" ry="${hgt * 0.025}" fill="${P.ink}" opacity=".18"/>
    <g transform="translate(${x - w / 2} ${y}) scale(${k})"><image href="${pp.href}" width="240" height="284"/>${pp.extra || ''}</g>`;
  return part === 'body' ? body : trail + body;
}

function character(ch, x, y, hgt) {
  if (ch?.front) {
    // two Pepes racing: the second a step behind and a little smaller
    const hb = hgt * 0.84;
    const b = [ch.back, x - hgt * 0.5, y + hgt * 0.02, hb, 29], f = [ch.front, x + hgt * 0.08, y + hgt * 0.04, hgt * 0.96, 13];
    return pepe(...f, 'trail') + pepe(...b, 'trail') + pepe(...b, 'body') + pepe(...f, 'body'); // all streaks behind both runners
  }
  if (ch?.href) {
    const w = hgt * (ch.aspect || 1);
    let r = 13; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    let trail = '';
    for (let i = 0; i < 9; i++) {
      const yy = y + hgt * (0.32 + 0.5 * (i / 8)), len = w * (0.7 + rnd() * 1.1), th = hgt * (0.012 + rnd() * 0.016), x0 = x - w * 0.02;
      trail += `<path d="M${x0},${yy} L${x0 - len * 0.18},${yy - th} L${x0 - len},${yy - th * 0.12} L${x0 - len},${yy + th * 0.12} L${x0 - len * 0.18},${yy + th} Z" fill="${P.paper}" opacity="${(0.25 + rnd() * 0.4).toFixed(2)}"/>`;
    }
    const shadow = `<ellipse cx="${x}" cy="${y + hgt * 0.985}" rx="${w * 0.34}" ry="${hgt * 0.025}" fill="${P.ink}" opacity=".18"/>`;
    return `${trail}${shadow}<image href="${ch.href}" x="${x - w / 2}" y="${y}" width="${w}" height="${hgt}" preserveAspectRatio="xMidYMax meet"/>`;
  }
  const w = hgt * 0.75;
  return `<g><rect x="${x - w / 2}" y="${y}" width="${w}" height="${hgt}" rx="${hgt * 0.06}" fill="${P.paper}" fill-opacity=".12" stroke="${P.paper}" stroke-width="${Math.max(2, hgt * 0.012)}" stroke-dasharray="${hgt * 0.04} ${hgt * 0.03}"/>
    <text x="${x}" y="${y + hgt / 2}" fill="${P.paper}" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-weight="800" font-size="${hgt * 0.07}" text-anchor="middle">IMD character</text>
    <text x="${x}" y="${y + hgt / 2 + hgt * 0.08}" fill="${P.paper}" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="${hgt * 0.045}" text-anchor="middle" opacity=".8">transparent PNG / SVG goes here</text></g>`;
}

// ------------------------------------------------------------------ compositions
const wrap = (w, h, body, bg = P.red) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><style>.sparkle{fill:#f5c518}</style><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;

/** App icon / favicon: italic R with the speed cut on vermilion. */
export function iconSvg(size = 512) {
  const r = rMark({ size: size * 0.8, id: 'ic' });
  const x = (size - r.width) / 2 + size * 0.01, y = (size - r.height) / 2;
  return wrap(size, size, `${speedLines(size, size, { count: 6, opacity: 0.25, seed: 3 })}<g transform="translate(${x} ${y})">${r.svg}</g>`);
}

/** Wordmark on its own (transparent background) for headers. */
export function wordmarkSvg({ fill = P.paper, tagline = true } = {}) {
  const m = wordmark({ size: 200, fill, tagline, id: 'wms' });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${m.width + 20} ${m.height + 20}" width="${m.width + 20}" height="${m.height + 20}">${m.svg}</svg>`;
}

/** Poster (OpenSea collection logo, 1000×1000): racing sneakers over track lanes, wordmark below. */
export function posterSvg(size = 1000, { ch } = {}) {
  if (ch !== undefined) {
    const m = wordmark({ size: 170, id: 'pwc' });
    return wrap(size, size, `${lanes(size, size, { y0: 0.18, gap: 0.2, count: 4, opacity: 0.2 })}${speedLines(size, size, { count: 16, opacity: 0.18 })}
      ${character(ch, size * 0.56, size * 0.05, size * 0.68)}
      <g transform="translate(${(size - m.width) / 2} ${size * 0.76})">${m.svg}</g>`);
  }
  const m = wordmark({ size: 190, id: 'pw' });
  return wrap(size, size, `${lanes(size, size, { y0: 0.18, gap: 0.2, count: 4, opacity: 0.22 })}${speedLines(size, size, { count: 16, opacity: 0.18 })}
    <g transform="translate(${size * 0.17} ${size * 0.33})">${racers(size * 0.74)}</g>
    <g transform="translate(${(size - m.width) / 2} ${size * 0.72})">${m.svg}</g>`);
}

/** Wide banner (OpenSea 1400×350, social 1500×500, og 1200×630). */
export function bannerSvg(w = 1400, h = 350, { ch } = {}) {
  if (ch !== undefined) {
    const m = wordmark({ size: Math.min(h * 0.4, (w * 0.38) / 3.2), id: 'bwc' });
    return wrap(w, h, `${lanes(w, h, { y0: 0.3, gap: 0.3, count: 3, opacity: 0.2 })}${speedLines(w, h, { count: 22, opacity: 0.18 })}
      <g transform="translate(${w * 0.05} ${(h - m.height) / 2})">${m.svg}</g>
      ${character(ch, w - Math.min(h, w * 0.4) * 0.55, h * 0.04, Math.min(h, w * 0.4) * 0.98)}`);
  }
  const m = wordmark({ size: Math.min(h * 0.42, (w * 0.42) / 3.2), id: 'bw' });
  const rw = Math.min(w * 0.4, h * 1.35);
  return wrap(w, h, `${lanes(w, h, { y0: 0.3, gap: 0.3, count: 3, opacity: 0.2 })}${speedLines(w, h, { count: 22, opacity: 0.18 })}
    <g transform="translate(${w * 0.06} ${(h - m.height) / 2})">${m.svg}</g>
    <g transform="translate(${w - rw * 1.04} ${h * 0.5 - rw * 0.06})">${racers(rw)}</g>`);
}
