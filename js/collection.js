// RUNNER Genesis — 9,999 sneaker NFTs on Robinhood Chain.
// A token number (1–9999) deterministically defines the whole sneaker:
//   • rarity + mint price — same formula as the RunnerGenesis contract
//     (contracts/RunnerGenesis.sol), so app and chain always agree
//   • class (pace zone) and starting stats
//   • look: line, colours, foam tone, upper pattern, laces, edition

export const COLLECTION = { name: 'RUNNER Genesis', supply: 9999 };

export const MODELS = {
  stride: { label: 'Stride', note: 'Modern road runner' },
  pod: { label: 'Pod', note: 'Cloud-cushion runner' },
  knit: { label: 'Knit', note: 'Sock-knit lifestyle runner' },
  court: { label: 'Court', note: 'High-top court classic' },
};

export const EDITIONS = {
  standard: { label: 'Standard' },
  neon: { label: 'Neon', note: 'Electric glow colourway' },
  ghost: { label: 'Ghost', note: 'Translucent ice colourway' },
  gold: { label: 'Gold', note: 'Metallic gold — the rarest' },
};

const PATTERNS = ['mesh', 'knit', 'speckle', 'plain'];

export const RARITY_RANGE = { common: [4, 8], uncommon: [8, 14], rare: [15, 25], epic: [28, 42] };
/** Mint prices in wei — must match RunnerGenesis.priceOf. */
export const PRICE_WEI = { common: 5n * 10n ** 15n, uncommon: 15n * 10n ** 15n, rare: 4n * 10n ** 16n, epic: 10n ** 17n };
export const PRICE_ETH = { common: '0.005', uncommon: '0.015', rare: '0.04', epic: '0.1' };

/**
 * Rarity from the token id. Identical to RunnerGenesis.rarityOf (32-bit
 * xorshift on a multiplicative hash): 2% epic, 8% rare, 20% uncommon, 70% common.
 */
export function rarityOf(id) {
  const M = 0xffffffffn;
  let x = (BigInt(id) * 2654435761n + 24301n) & M;
  x ^= (x << 13n) & M;
  x ^= x >> 17n;
  x ^= (x << 5n) & M;
  const r = Number(x % 10000n);
  return r < 200 ? 'epic' : r < 1000 ? 'rare' : r < 3000 ? 'uncommon' : 'common';
}
export const priceOf = (id) => PRICE_WEI[rarityOf(id)];

/** Small deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted(r, table) {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of table) { if ((x -= w) < 0) return k; }
  return table[table.length - 1][0];
}

/** Look traits for token `id` (1–9999). Same id → same traits, always. */
export function traitsFor(id) {
  const r = rng(Math.imul(id, 2654435761) ^ 0x5eed);
  const model = weighted(r, [['stride', 30], ['pod', 27], ['knit', 24], ['court', 19]]);
  const hue = Math.floor(r() * 360);
  const accent = Math.floor((hue + 120 + r() * 120) % 360);
  const midTone = Math.floor(r() * 3);       // 0 white, 1 contrast, 2 tonal foam
  const pattern = PATTERNS[Math.floor(r() * PATTERNS.length)];
  const laces = r() < 0.5 ? 'light' : 'dark';
  // ~0.5% Gold, ~1% Ghost, ~1.5% Neon
  const roll = r();
  const edition = roll < 0.005 ? 'gold' : roll < 0.015 ? 'ghost' : roll < 0.03 ? 'neon' : 'standard';
  // Gameplay (drawn after the look so existing looks never change).
  const type = weighted(r, [['walker', 20], ['jogger', 40], ['runner', 25], ['trainer', 15]]);
  const rarity = rarityOf(id);
  const [lo, hi] = RARITY_RANGE[rarity];
  const stat = () => Math.round((lo + r() * (hi - lo)) * 100) / 100;
  const base = { efficiency: stat(), resilience: stat() };
  return { tokenId: id, model, hue, accent, midTone, pattern, laces, edition, type, rarity, base };
}

/** Collection-wide stats, computed once (how many of each line / edition). */
let statsCache = null;
export function collectionStats() {
  if (statsCache) return statsCache;
  const models = {}, editions = {}, rarities = {}, types = {};
  for (let i = 1; i <= COLLECTION.supply; i++) {
    const t = traitsFor(i);
    models[t.model] = (models[t.model] || 0) + 1;
    editions[t.edition] = (editions[t.edition] || 0) + 1;
    rarities[t.rarity] = (rarities[t.rarity] || 0) + 1;
    types[t.type] = (types[t.type] || 0) + 1;
  }
  statsCache = { models, editions, rarities, types };
  return statsCache;
}
