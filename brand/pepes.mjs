// Dresses IMD's Pepe frames in PepesFamily NFT outfits (the same recipe as
// pepesimd.fun / github.com/0xtenang/PepesFamilyNFT: colour-keyed masks pick out skin,
// shirt and shorts, each retinted from the pixel's lightness so IMD's lines and shading
// stay). Pure Node: a minimal PNG reader/writer for 8-bit RGBA images.
import fs from 'node:fs';
import zlib from 'node:zlib';

// ------------------------------------------------------------------ PNG (8-bit RGBA, non-interlaced)
export function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  let pos = 8, width = 0, height = 0, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('Only 8-bit RGBA, non-interlaced PNGs are supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y > 0 ? px[dst - stride + x] : 0, c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  return { width, height, data: px };
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
export function writePng({ width, height, data }) {
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ PepesFamily looks
export const LOOK = {
  skin: [null, '8aa86b', '7fd3e8', 'f29bb3', '4a4a4a', '9b7fe0', 'e6b422'],
  shirt: [null, 'd23c3c', '1f1f1f', 'ececec', '3ddc84', '7a4fd6', 'f28c28', '8a8f98', 'f5d33b'],
  shorts: [null, '6b6b6b', '3d5a80', '2a2a2a', 'a83232', 'e8e8e8'],
  base: { skin: 124, shirt: 71, shorts: 145 },
  shortsFrom: 175, // the shorts mask only applies below this row, so the lips are never caught
};
const hexRgb = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Recolours one 240×284 frame for look { skin, shirt, shorts } (palette indexes; 0 = IMD's original). */
export function dress(png, look) {
  const d = Buffer.from(png.data), W = png.width;
  const tint = (name) => { const h = LOOK[name][look[name] || 0]; if (!h) return null; const b = LOOK.base[name]; return hexRgb(h).map((v) => v / b); };
  const tSkin = tint('skin'), tShirt = tint('shirt'), tShorts = tint('shorts');
  for (let i = 0; i < d.length; i += 4) {
    const A = d[i + 3] / 255; if (A === 0) continue;
    const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255, L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const mix = (t, w) => { if (w <= 0) return; r += (clamp01(L * t[0]) * 255 - r) * w; g += (clamp01(L * t[1]) * 255 - g) * w; b += (clamp01(L * t[2]) * 255 - b) * w; };
    if (tSkin) mix(tSkin, clamp01(-10 * R + 20 * G - 10 * B - 0.8) * A);
    if (tShirt) mix(tShirt, clamp01(-6 * R - 3 * G + 6 * B - 0.4) * A);
    if (tShorts && Math.floor(i / 4 / W) >= LOOK.shortsFrom) mix(tShorts, clamp01(14 * R - 14 * G - 0.45) * clamp01(-27.2 * R + 40 * G + 0.05) * A);
    d[i] = Math.round(r); d[i + 1] = Math.round(g); d[i + 2] = Math.round(b);
  }
  return { ...png, data: d };
}

// Extras drawn as the PepesFamily contract places them: [x, y, scale %, tilt] per sheet frame.
export const XHAT = { 8: [130, 66, 94, 0], 10: [134, 71, 85, 0] };
const XLINE = 'stroke="#1c1c1c" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"';
const EXTRA_SIDE = {
  headphones: '<g transform="translate(0 10)"><path d="M-48 40C-56-16 4-24 14 30" fill="none" stroke-width="7"/><path d="M-48 40C-56-16 4-24 14 30" fill="none" stroke="#4b5563" stroke-width="3"/><ellipse cx="-22" cy="44" rx="12" ry="17" fill="#e11d48"/></g>',
  halo: '<g transform="translate(0 4)"><ellipse cy="-26" rx="40" ry="9" fill="none" stroke-width="7"/><ellipse cy="-26" rx="40" ry="9" fill="none" stroke="#fde047" stroke-width="3.5"/></g>',
};
/** SVG for an extra on a side-view frame, in the frame's own 240×284 space. */
export function extraSvg(frame, extra) {
  const x = XHAT[frame], art = EXTRA_SIDE[extra];
  if (!x || !art) return '';
  return `<g transform="translate(${x[0]} ${x[1]}) scale(${x[2] / 100}) rotate(${x[3]})" ${XLINE}>${art}</g>`;
}

/** The two RUNNER Pepes: { href, extra, frame } each (data URIs of the dressed frames). */
export function runnerPepes(dir) {
  const load = (n) => readPng(fs.readFileSync(new URL(`imd-frame-${String(n).padStart(2, '0')}.png`, dir)));
  const make = (frame, look, extra) => ({ frame, extra: extraSvg(frame, extra), href: `data:image/png;base64,${writePng(dress(load(frame), look)).toString('base64')}`, aspect: 240 / 284 });
  return {
    front: make(10, { skin: 0, shirt: 0, shorts: 0 }, null),         // IMD's original Pepe: green, blue shirt, brown shorts
    back: make(8, { skin: 2, shirt: 5, shorts: 5 }, 'halo'),         // blue skin, purple shirt, white shorts, halo
  };
}
