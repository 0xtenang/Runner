// Shared helpers for the NFT metadata endpoints (OpenSea, wallets).
// Uses the same trait + art code as the app, so marketplaces show exactly
// what players see in RUNNER.
import { COLLECTION, MODELS, EDITIONS, traitsFor, PRICE_ETH } from '../js/collection.js';
import { sneakerSvg } from '../js/sneaker-art.js';

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
      { trait_type: 'Laces', value: t.laces === 'light' ? 'Light' : 'Dark' },
      { trait_type: 'Efficiency', value: t.base.efficiency, display_type: 'number' },
      { trait_type: 'Resilience', value: t.base.resilience, display_type: 'number' },
      { trait_type: 'Mint Price (ETH)', value: Number(PRICE_ETH[t.rarity]), display_type: 'number' },
    ],
  };
}

const RARITY_COLOR = { common: '#6b6b6b', uncommon: '#166534', rare: '#1e40af', epic: '#6b21a8' };

/** Square 1000×1000 artwork for marketplaces. */
export function tokenImage(id) {
  const t = traitsFor(id);
  const art = sneakerSvg(t, 'art').replace('<svg ', '<svg x="90" y="250" width="820" height="403" ');
  const h = t.hue;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
  <style>.sparkle{fill:#f5c518}</style>
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 70% 95%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 60% 86%)"/></linearGradient></defs>
  <rect width="1000" height="1000" fill="url(#bg)"/>
  <text x="70" y="110" font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="44" font-weight="900" fill="#111">RUNN<tspan fill="#3f7a0c">ER</tspan> <tspan font-weight="600" fill="#6b6b6b">GENESIS</tspan></text>
  ${art}
  <text x="70" y="880" font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="88" font-weight="900" fill="#111">#${id}</text>
  <text x="70" y="935" font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="${RARITY_COLOR[t.rarity]}">${RARITY[t.rarity]} · ${CLASS[t.type].label} · ${MODELS[t.model].label}${t.edition !== 'standard' ? ` · ${EDITIONS[t.edition].label}` : ''}</text>
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
  ${kind === 'banner' ? '' : `<text x="500" y="300" text-anchor="middle" font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="120" font-weight="900" fill="#fff">RUNN<tspan fill="#a3e635">ER</tspan></text>
  <text x="500" y="370" text-anchor="middle" font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#9c9ba3">GENESIS</text>`}
  ${arts}
</svg>`;
}
