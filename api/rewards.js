// RUNNER rewards server — the source of truth for anything worth real RUNNER.
//
//   POST /api/rewards  { action, ... }
//     status                       → is the server set up? signer address for setSigner()
//     session  {address, message, signature}  → 30-day session token (wallet signs once)
//     state    {session}           → balance, energy, sneaker progress, recent runs
//     run      {session, run}      → re-scores an uploaded GPS run with js/rules.js and credits it
//     levelup / allocate / repair  → in-app spending from the server balance
//     claim    {session}           → EIP-712 signature for RunnerToken.claim()
//
// Emission follows the token's halving schedule (js/rules.js mirrors it): every
// run's earn rate is multiplied by that day's emission factor, the server never
// credits more than the day's emission in total, and claims are limited to what
// the contract can still pay out today (partial claims when it's nearly used up).
//
// Amounts are kept as integer micro-RUNNER (1e-6). Spending can only use what
// hasn't been signed for claiming, so a signature can never be "spent twice".
//
// Vercel env vars: SIGNER_PRIVATE_KEY (server key, its address is set on the
// token with setSigner) and the Upstash Redis REST URL/token.
import { TOKEN_CHAIN, TOKEN_CONTRACT as CONFIG_TOKEN, NFT_CONTRACT as CONFIG_NFT } from '../js/config.js';
import {
  scoreTrack, isVoided, maxEnergy, regenEnergy, sneakerFromToken, levelUpCost, repairCost,
  durabilityLossPerEnergy, ATTRS, POINTS_PER_LEVEL, MAX_LEVEL, round2,
  emissionOn, emissionFactor, nextHalving, utcDay,
} from '../js/rules.js';
import { addressOfKey, claimDigest, signDigest, personalDigest, recoverAddress, keccak, toHex, isAddress } from './_lib/eth.js';
import * as store from './_lib/store.js';
import { ownedTokenIds, emissionStartDay, claimState } from './_lib/chain.js';

const env = globalThis.process?.env || {};
const KEY = (env.SIGNER_PRIVATE_KEY || '').trim();
const TESTING = env.VERCEL_ENV !== 'production' && env.REWARDS_STORE === 'memory';
const TOKEN_CONTRACT = CONFIG_TOKEN || (TESTING && env.REWARDS_TEST_TOKEN) || '';
const NFT_CONTRACT = CONFIG_NFT || (TESTING && env.REWARDS_TEST_NFT) || '';
const MICRO = 1_000_000;
const SESSION_DAYS = 30;
const MAX_POINTS = 20000;
const MAX_RUN_MS = 6 * 3600e3;
const MAX_AGE_MS = 72 * 3600e3;
const CLAIM_TTL_S = 3600;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

const signerAddress = () => {
  try { return /^(0x)?[0-9a-fA-F]{64}$/.test(KEY) ? addressOfKey(KEY) : null; } catch { return null; }
};
const contractsSet = () => isAddress(TOKEN_CONTRACT) && isAddress(NFT_CONTRACT);
let startDay = 0; // emission start day, read from the token on each request (cached once set)
const isLive = () => Boolean(signerAddress() && store.storeConfigured() && contractsSet() && startDay);

function emissionView() {
  const today = utcDay();
  return { startDay, today, limit: emissionOn(today, startDay), factor: emissionFactor(today, startDay), nextHalving: nextHalving(today, startDay) };
}

// ------------------------------------------------------------------ sessions
// Token = base64url(json) + "." + keccak(secret ‖ json). keccak has no length
// extension weakness, so this is a sound MAC. The secret derives from the server key.
const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString();
const mac = (payload) => toHex(keccak(`runner-session:${KEY}:${payload}`));

export const sessionMessage = (address, issued) =>
  `Sign in to RUNNER rewards (runearn.fun)\nWallet: ${address.toLowerCase()}\nIssued: ${issued}`;

function openSession(body) {
  const [p, m] = String(body.session || '').split('.');
  if (!p || !m || mac(p) !== m) fail(401, 'Session expired — sign in again.');
  const s = JSON.parse(unb64(p));
  if (!(s.exp > Date.now()) || !isAddress(s.a)) fail(401, 'Session expired — sign in again.');
  return s.a.toLowerCase();
}

function createSession({ address, message, signature }) {
  if (!isAddress(address)) fail(400, 'Bad address');
  const issued = String(message || '').split('\nIssued: ')[1] || '';
  if (message !== sessionMessage(address, issued)) fail(400, 'Unexpected sign-in message');
  const age = Date.now() - Date.parse(issued);
  if (!(Math.abs(age) < 10 * 60e3)) fail(400, 'Sign-in message too old — try again.');
  const who = recoverAddress(personalDigest(message), signature);
  if (!who || who !== address.toLowerCase()) fail(401, 'Signature does not match the wallet.');
  const payload = b64(JSON.stringify({ a: who, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return { session: `${payload}.${mac(payload)}`, address: who };
}

// ------------------------------------------------------------------ state
const userKey = (a) => `rw:u:${a}`;
const sneakerKey = (id) => `rw:t:${id}`;
const freshUser = () => ({ earned: 0, spent: 0, signed: 0, energy: null, energyAt: Date.now(), lastEnd: 0, runs: [] });

async function loadSneaker(id) {
  const saved = await store.get(sneakerKey(id));
  const base = sneakerFromToken(id);
  return { ...base, level: 0, durability: 100, points: { efficiency: 0, resilience: 0 }, unspent: 0, lastEnd: 0, ...(saved || {}) };
}
const saveSneaker = (s) => store.set(sneakerKey(s.tokenId), {
  level: s.level, durability: s.durability, points: s.points, unspent: s.unspent, lastEnd: s.lastEnd,
});

async function loadUser(address, owned) {
  const u = { ...freshUser(), ...((await store.get(userKey(address))) || {}) };
  const max = maxEnergy(owned.length);
  if (u.energy == null) u.energy = max;
  u.energy = regenEnergy(u.energy, u.energyAt, max);
  u.energyAt = Date.now();
  return u;
}
const available = (u) => u.earned - u.spent - u.signed;

async function view(address, u, owned) {
  const sneakers = {};
  for (const id of owned) {
    const s = await loadSneaker(id);
    sneakers[id] = { level: s.level, durability: s.durability, points: s.points, unspent: s.unspent };
  }
  return {
    address,
    balance: available(u) / MICRO,
    earned: u.earned / MICRO,
    spent: u.spent / MICRO,
    withdrawn: u.signed / MICRO,
    energy: round2(u.energy),
    maxEnergy: maxEnergy(owned.length),
    owned,
    sneakers,
    runs: u.runs,
    emission: emissionView(),
  };
}

/** Runs `fn` with the wallet's data locked, so two requests can't double-spend. */
async function withUser(address, fn) {
  const lock = `rw:lock:${address}`;
  if (!(await store.setNX(lock, 1, 20000))) fail(409, 'Busy — try again in a moment.');
  try {
    const owned = await ownedTokenIds(address);
    const u = await loadUser(address, owned);
    const out = await fn(u, owned);
    await store.set(userKey(address), u);
    return out ?? view(address, u, owned);
  } finally {
    await store.del(lock);
  }
}

// ------------------------------------------------------------------ runs
function cleanTrack(raw) {
  if (!Array.isArray(raw) || raw.length < 2) fail(400, 'Not enough GPS points');
  if (raw.length > MAX_POINTS) fail(400, 'Run too long');
  const pts = [];
  let lastT = -Infinity;
  for (const p of raw) {
    const t = Number(p?.t), lat = Number(p?.lat), lon = Number(p?.lon);
    if (!Number.isFinite(t) || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) fail(400, 'Bad GPS point');
    if (t <= lastT) fail(400, 'GPS points out of order');
    lastT = t;
    const q = { t, lat, lon };
    if (p.hr != null && Number(p.hr) > 30 && Number(p.hr) < 240) q.hr = Number(p.hr);
    if (p.b) q.b = 1;
    pts.push(q);
  }
  const start = pts[0].t, end = pts[pts.length - 1].t, now = Date.now();
  if (end - start > MAX_RUN_MS) fail(400, 'Run longer than 6 hours');
  if (end > now + 120e3) fail(400, 'Run is in the future — check the phone clock');
  if (now - end > MAX_AGE_MS) fail(400, 'Run is older than 72 hours and can no longer earn');
  return pts;
}

async function submitRun(address, { run }) {
  const pts = cleanTrack(run?.points);
  const tokenId = Number(run?.tokenId);
  const start = pts[0].t, end = pts[pts.length - 1].t;
  return withUser(address, async (u, owned) => {
    if (!owned.includes(tokenId)) fail(403, `This wallet doesn't own Genesis #${tokenId}.`);
    if (start < u.lastEnd) fail(409, 'This run overlaps one that was already counted.');
    const s = await loadSneaker(tokenId);
    if (start < s.lastEnd) fail(409, `Genesis #${tokenId} was already used during this time.`);

    const day = utcDay(end);
    const factor = emissionFactor(day, startDay);
    const session = scoreTrack(pts, s, u.energy, factor);
    const voided = isVoided(session);
    const used = voided ? 0 : Math.min(session.used, u.energy);
    let micro = voided || session.used <= 0 ? 0 : Math.floor(session.coins * (used / session.used) * MICRO);
    // Never credit more than the day's emission across all runners.
    let capped = false;
    if (micro > 0) {
      const budget = Math.round(emissionOn(day, startDay) * MICRO);
      const total = await store.incrBy(`rw:budget:${day}`, micro);
      const over = Math.min(micro, Math.max(0, total - budget));
      if (over > 0) { await store.incrBy(`rw:budget:${day}`, -over); micro -= over; capped = true; }
    }

    u.energy = Math.max(0, u.energy - used);
    u.earned += micro;
    u.lastEnd = end;
    s.lastEnd = end;
    s.durability = Math.max(0, round2(s.durability - used * durabilityLossPerEnergy(s)));
    await saveSneaker(s);
    const record = {
      id: toHex(keccak(`${address}:${tokenId}:${start}:${end}`)).slice(0, 16),
      start, end, tokenId, coins: micro / MICRO, energy: round2(used), zoneSec: Math.round(session.zoneSec),
      vehicleSec: Math.round(session.vehicleSec), voided, capped, factor,
    };
    u.runs = [record, ...u.runs].slice(0, 30);
    return { run: record, state: await view(address, u, owned) };
  });
}

// ------------------------------------------------------------------ spending
function spend(u, runner) {
  const micro = Math.round(runner * MICRO);
  if (available(u) < micro) fail(400, `Not enough RUNNER — you need ${runner}.`);
  u.spent += micro;
}

async function upgrade(address, body, action) {
  const tokenId = Number(body.tokenId);
  return withUser(address, async (u, owned) => {
    if (!owned.includes(tokenId)) fail(403, `This wallet doesn't own Genesis #${tokenId}.`);
    const s = await loadSneaker(tokenId);
    const factor = emissionFactor(utcDay(), startDay); // costs halve with emission
    if (action === 'levelup') {
      if (s.level >= MAX_LEVEL) fail(400, 'Already max level');
      spend(u, levelUpCost(s, factor));
      s.level++;
      s.unspent += POINTS_PER_LEVEL[s.rarity];
    } else if (action === 'repair') {
      const cost = repairCost(s, factor);
      if (cost > 0) { spend(u, cost); s.durability = 100; }
    } else if (action === 'allocate') {
      const add = body.add || {};
      const vals = ATTRS.map((k) => Number(add[k] || 0));
      if (vals.some((v) => v < 0 || !Number.isInteger(v))) fail(400, 'Invalid points');
      const total = vals.reduce((a, b) => a + b, 0);
      if (total > s.unspent) fail(400, 'Not enough points');
      ATTRS.forEach((k, i) => { s.points[k] += vals[i]; });
      s.unspent -= total;
    }
    await saveSneaker(s);
  });
}

// ------------------------------------------------------------------ claims
async function claim(address) {
  return withUser(address, async (u, owned) => {
    const total = u.earned - u.spent;              // everything ever earned and not spent in-app
    if (total <= 0) fail(400, 'Nothing to claim yet — go for a run!');
    // The contract pays at most today's emission across everyone: sign only what still fits.
    const today = utcDay();
    const chain = await claimState(address, today, TOKEN_CONTRACT);
    const doneMicro = Number(chain.claimed / 10n ** 12n);
    const leftToday = Math.max(0, Math.floor(emissionOn(today, startDay) * MICRO) - Number(chain.claimedToday / 10n ** 12n));
    const allowed = Math.min(total, doneMicro + leftToday);
    if (allowed <= doneMicro) {
      fail(total > doneMicro ? 429 : 400, total > doneMicro
        ? "Today's RUNNER claim limit is used up. Your balance is safe — claim again after 07:00 WIB (00:00 UTC)."
        : 'Everything you earned is already in your wallet.');
    }
    const totalWei = BigInt(allowed) * 10n ** 12n;
    const deadline = Math.floor(Date.now() / 1000) + CLAIM_TTL_S;
    const sig = await signDigest(claimDigest({ token: TOKEN_CONTRACT, chainId: TOKEN_CHAIN.id, account: address, totalWei, deadline }), KEY);
    u.signed = Math.max(u.signed, allowed);        // from now on this amount can't be spent in-app
    return { claim: { contract: TOKEN_CONTRACT, chainId: TOKEN_CHAIN.id, account: address, totalEarned: totalWei.toString(), deadline, partial: allowed < total, ...sig }, state: await view(address, u, owned) };
  });
}

// ------------------------------------------------------------------ handler
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // The phone app calls from its own origin. Sessions travel in the body (no cookies), so * is safe.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  try {
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) : { action: req.query?.action || 'status' };
    const action = body.action;
    if (contractsSet() && (!startDay || TESTING)) startDay = await emissionStartDay(TOKEN_CONTRACT).catch(() => 0);
    if (action === 'status') {
      res.status(200).json({ live: isLive(), signer: signerAddress(), store: store.storeConfigured(), token: TOKEN_CONTRACT || null, nft: NFT_CONTRACT || null, chainId: TOKEN_CHAIN.id, emission: startDay ? emissionView() : null });
      return;
    }
    if (req.method !== 'POST') fail(405, 'POST only');
    if (!isLive()) fail(503, 'Rewards are not switched on yet.');
    let out;
    if (action === 'session') out = createSession(body);
    else {
      const address = openSession(body);
      if (action === 'state') out = await withUser(address, () => null);
      else if (action === 'run') out = await submitRun(address, body);
      else if (action === 'levelup' || action === 'repair' || action === 'allocate') out = await upgrade(address, body, action);
      else if (action === 'claim') out = await claim(address);
      else fail(400, 'Unknown action');
    }
    res.status(200).json(out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: status === 500 ? 'Server error — try again later.' : e.message });
  }
}
