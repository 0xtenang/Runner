// RUNNER Genesis — a fixed collection of 9,999 sneaker designs.
// Each token number (1–9999) deterministically defines how a sneaker LOOKS:
// line (silhouette), colours, foam tone, upper pattern, laces and edition.
// Gameplay stats (class, rarity, attributes) are separate and live in game.js.
// Because the look is derived from the number alone, the same token renders
// identically everywhere — ready to become on-chain NFT metadata later.

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
  return { tokenId: id, model, hue, accent, midTone, pattern, laces, edition };
}

/** A token number not yet used on this device (uniqueness is per device until on-chain). */
export function pickTokenId(used = []) {
  const taken = new Set(used.map(Number));
  if (taken.size >= COLLECTION.supply) throw new Error('All 9,999 sneakers have been claimed');
  let id;
  do { id = 1 + Math.floor(Math.random() * COLLECTION.supply); } while (taken.has(id));
  return id;
}

/** Collection-wide stats, computed once (how many of each line / edition). */
let statsCache = null;
export function collectionStats() {
  if (statsCache) return statsCache;
  const models = {}, editions = {};
  for (let i = 1; i <= COLLECTION.supply; i++) {
    const t = traitsFor(i);
    models[t.model] = (models[t.model] || 0) + 1;
    editions[t.edition] = (editions[t.edition] || 0) + 1;
  }
  statsCache = { models, editions };
  return statsCache;
}
