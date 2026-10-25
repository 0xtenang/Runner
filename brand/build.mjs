// Exports the brand SVGs to brand/out/. Run: node brand/build.mjs
// IMD's character: put a transparent PNG or SVG at brand/assets/character.(png|svg)
// and the "-imd" versions embed it (otherwise they show a placeholder).
import fs from 'node:fs';
import { iconSvg, wordmarkSvg, posterSvg, bannerSvg } from './art.js';
import { runnerPepes } from './pepes.mjs';

const here = (f) => new URL(f, import.meta.url);
function loadCharacter() {
  for (const [file, type] of [['assets/character.svg', 'image/svg+xml'], ['assets/character.png', 'image/png']]) {
    if (!fs.existsSync(here(file))) continue;
    const buf = fs.readFileSync(here(file));
    let aspect = 0.75;
    if (type === 'image/png') aspect = buf.readUInt32BE(16) / buf.readUInt32BE(20); // IHDR width/height
    else { const m = String(buf).match(/viewBox="[\d.\s-]+?\s([\d.]+)\s([\d.]+)"/); if (m) aspect = m[1] / m[2]; }
    return { href: `data:${type};base64,${buf.toString('base64')}`, aspect };
  }
  return null; // placeholder
}

const ch = loadCharacter();
// Two Pepes in PepesFamily outfits, from IMD's sprite frames (brand/assets/imd-frame-*.png)
const pair = fs.existsSync(here('assets/imd-frame-10.png')) ? runnerPepes(here('assets/')) : null;
// For round avatars (DexScreener crops the token logo to a circle): the R moved from right of centre to the
// middle and scaled a little, so nothing is cut off.
const centeredIcon = (svg) => svg.replace(/(<rect width="512" height="512"[^>]*\/>)([\s\S]*)<\/svg>\s*$/, '$1<g transform="translate(256 256) scale(0.86) translate(-331 -256)">$2</g></svg>');
fs.mkdirSync(here('out/'), { recursive: true });
const files = {
  'icon.svg': iconSvg(512),
  'wordmark.svg': wordmarkSvg(),
  'wordmark-ink.svg': wordmarkSvg({ fill: '#141414' }),
  'poster.svg': posterSvg(1000),
  'banner-opensea.svg': bannerSvg(1400, 350),
  'banner-social.svg': bannerSvg(1500, 500),
  'og.svg': bannerSvg(1200, 630),
  'poster-imd.svg': posterSvg(1000, { ch }),
  'banner-opensea-imd.svg': bannerSvg(1400, 350, { ch }),
  'og-imd.svg': bannerSvg(1200, 630, { ch }),
  'poster-pepes.svg': posterSvg(1000, { ch: pair }),
  'banner-opensea-pepes.svg': bannerSvg(1400, 350, { ch: pair }),
  'og-pepes.svg': bannerSvg(1200, 630, { ch: pair }),
  // DexScreener token profile: header 3:1 (1500×500) and a square icon
  'banner-dexscreener.svg': bannerSvg(1500, 500, { ch: pair }),
  'icon-dexscreener.svg': centeredIcon(iconSvg(512)),
};
for (const [name, svg] of Object.entries(files)) fs.writeFileSync(here(`out/${name}`), svg);
console.log(`${Object.keys(files).length} files in brand/out/ — IMD character: ${ch ? 'embedded' : 'placeholder (add brand/assets/character.png)'}`);
