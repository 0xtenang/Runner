// Shared helpers for the NFT metadata endpoints (OpenSea, wallets).
// Uses the same trait + art code as the app, so marketplaces show exactly
// what players see in RUNNER.
import { COLLECTION, MODELS, EDITIONS, traitsFor, PRICE_ETH } from '../js/collection.js';
import { sneakerSvg, colorwayName } from '../js/sneaker-art.js';
import { wordmark, textPath, PALETTE } from '../brand/art.js';

export const SITE = 'https://runearn.fun';
const CLASS = {
  walker: { label: 'Recovery Runner', zone: '10:00 /km or slower' },
  jogger: { label: 'Daily Runner', zone: '6:00–15:00 /km' },
  runner: { label: 'Tempo Runner', zone: '3:00–7:30 /km' },
  trainer: { label: 'Hybrid Runner', zone: '3:00 /km or slower' },
};
const RARITY = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic' };

export function parseId(raw) {
  const id = Number.parseInt(String(raw ?? '').replace(/\.(json|svg)$/, ''), 10);
  return Number.isInteger(id) && id >= 1 && id <= COLLECTION.supply ? id : null;
}

export function tokenMetadata(id) {
  const t = traitsFor(id);
  const cls = CLASS[t.type];
  return {
    name: `${COLLECTION.name} #${id}`,
    description: `${RARITY[t.rarity]} ${cls.label} from the ${COLLECTION.name} collection — 9,999 sneakers for RUNNER, the run-to-earn app. `
      + `Equip it in RUNNER and run at ${cls.zone} to earn the RUNNER token. ${SITE}`,
    image: `${SITE}/nft/image/${id}`,
    external_url: `${SITE}/#/earn`,
    background_color: 'F2F2F2',
    attributes: [
      { trait_type: 'Rarity', value: RARITY[t.rarity] },
      { trait_type: 'Class', value: cls.label },
      { trait_type: 'Pace Zone', value: cls.zone },
      { trait_type: 'Line', value: MODELS[t.model].label },
      { trait_type: 'Edition', value: EDITIONS[t.edition].label },
      { trait_type: 'Upper', value: t.pattern[0].toUpperCase() + t.pattern.slice(1) },
      { trait_type: 'Colorway', value: colorwayName(t) },
      { trait_type: 'Laces', value: t.laces === 'light' ? 'Light' : 'Dark' },
      { trait_type: 'Efficiency', value: t.base.efficiency, display_type: 'number' },
      { trait_type: 'Resilience', value: t.base.resilience, display_type: 'number' },
      { trait_type: 'Mint Price (ETH)', value: Number(PRICE_ETH[t.rarity]), display_type: 'number' },
    ],
  };
}

const RARITY_COLOR = { common: '#5f5f5f', uncommon: '#15803d', rare: '#1d4ed8', epic: '#7e22ce' };
// Studio backdrop per edition: [centre, edge, ink, muted].
const STUDIO = {
  standard: ['#fafaf8', '#dcdcd6', '#141414', '#6b6b6b'],
  ghost: ['#ffffff', '#e3e8ee', '#1d2633', '#6b7a8c'],
  gold: ['#fff9ea', '#e8d5a6', '#2b1f06', '#80662c'],
  neon: ['#4a4a52', '#1c1c20', '#f4f4f5', '#b4b4bc'],
};

/** Square 1000×1000 card for marketplaces: studio shot, Anton type, rarity pill. */
export function tokenImage(id) {
  const t = traitsFor(id);
  const [c0, c1, ink, muted] = STUDIO[t.edition] || STUDIO.standard;
  const art = sneakerSvg(t, 'art').replace('<svg ', '<svg x="60" y="262" width="880" height="433" ');
  const wm = wordmark({ size: 46, fill: ink, tagline: false, id: 'cwm' });
  const rar = RARITY[t.rarity].toUpperCase();
  const pillW = 64 + rar.length * 19;
  const facts = [colorwayName(t), CLASS[t.type].label, MODELS[t.model].label].join('  ·  '); // editions are named by their colourway
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
  <style>.sparkle{fill:#f5c518}</style>
  <defs><radialGradient id="bg" cx=".5" cy=".46" r=".75"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></radialGradient></defs>
  <rect width="1000" height="1000" fill="url(#bg)"/>
  <rect x="70" y="70" width="44" height="8" rx="4" fill="${PALETTE.red}"/>
  <g transform="translate(70 96)">${wm.svg}</g>
  ${textPath('GENESIS', { size: 26, fill: muted, x: 82 + wm.width, y: 142, tracking: 5 })}
  <rect x="${930 - pillW}" y="84" width="${pillW}" height="64" rx="32" fill="${RARITY_COLOR[t.rarity]}"/>
  ${textPath(rar, { size: 30, fill: '#fff', x: 930 - pillW / 2, y: 131, anchor: 'middle', tracking: 3 })}
  ${art}
  ${textPath(`#${id}`, { size: 150, fill: ink, x: 70, y: 880 })}
  ${textPath(facts, { size: 28, fill: muted, x: 74, y: 932, tracking: 2.5 })}
  ${textPath('PACE ZONE', { size: 22, fill: muted, x: 930, y: 838, anchor: 'end', tracking: 4 })}
  ${textPath(CLASS[t.type].zone.replace('/km', '/KM'), { size: 40, fill: ink, x: 930, y: 884, anchor: 'end', tracking: 1 })}
</svg>`;
}

/** Collection logo / banner built from a few signature sneakers. */
export function collectionImage(kind = 'logo') {
  const ids = kind === 'banner' ? [3, 146, 42, 4021, 7777] : [146, 3, 42];
  const w = kind === 'banner' ? 1400 : 1000, hgt = kind === 'banner' ? 350 : 1000;
  const slot = kind === 'banner' ? 260 : 300;
  const arts = ids.map((id, i) => {
    const x = kind === 'banner' ? 40 + i * 270 : 50 + i * 310;
    const y = kind === 'banner' ? 90 : 420;
    return sneakerSvg(traitsFor(id), 'art').replace('<svg ', `<svg x="${x}" y="${y}" width="${slot}" height="${slot / 2}" `);
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}">
  <style>.sparkle{fill:#f5c518}</style>
  <rect width="${w}" height="${hgt}" fill="#0b0b0c"/>
  ${kind === 'banner' ? '' : `<text x="500" y="300" text-anchor="middle" font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="120" font-weight="900" fill="#fff">RUNN<tspan fill="#E8483B">ER</tspan></text>
  <text x="500" y="370" text-anchor="middle" font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#9c9ba3">GENESIS</text>`}
  ${arts}
</svg>`;
}
