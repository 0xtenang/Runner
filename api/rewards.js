// RUNNER rewards server — the source of truth for anything worth real RUNNER.
//
//   POST /api/rewards  { action, ... }
//     status                       → is the server set up? signer address for setSigner()
//     session  {address, message, signature}  → 30-day session token (wallet signs once)
//     state    {session}           → balance, energy, sneaker progress, recent runs
//     run      {session, run}      → re-scores an uploaded GPS run with js/rules.js and credits it
//     levelup / allocate / repair  → in-app spending from the server balance
//     claim    {session}           → EIP-712 signature for RunnerToken.claim()
//     settings-set {settings, message, signature} → dev wallet updates game settings
//                  (level prices, per-runner daily max, NFT boosts)
//     admin-session / admin {op}    → review queue (approve / void held runs), bans
//
// Fair play: every run gets a trust score (api/_lib/trust.js). Earnings become usable
// 24 hours after the run; runs scoring under 70 (or copied tracks) are held until an
// admin approves or voids them. Banned wallets can't earn, spend or claim. Requests
// are rate-limited per IP and per wallet. Runs from the phone app carry the step
// counter (cadence must match the pace) and a device proof (api/_lib/attest.js:
// Play Integrity / App Attest). With the requireAttestation setting on, only runs
// proven to come from the genuine app on an unmodified phone earn RUNNER.
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
import { TOKEN_CHAIN, TOKEN_CONTRACT as CONFIG_TOKEN, NFT_CONTRACT as CONFIG_NFT, DEV_WALLET } from '../js/config.js';
import {
  scoreTrack, isVoided, maxEnergy, regenEnergy, sneakerFromToken, levelUpCost, repairCost,
  durabilityLossPerEnergy, ATTRS, POINTS_PER_LEVEL, MAX_LEVEL, round2,
  emissionOn, emissionFactor, nextHalving, utcDay, DEFAULT_SETTINGS, boostMultiplier, runPayload,
} from '../js/rules.js';
import { addressOfKey, claimDigest, signDigest, personalDigest, recoverAddress, keccak, toHex, isAddress } from './_lib/eth.js';
import * as store from './_lib/store.js';
import { ownedTokenIds, emissionSchedule, claimState, heldContracts } from './_lib/chain.js';
import { trustScore, trackFingerprint, cleanSteps, TRUST_REVIEW_BELOW } from './_lib/trust.js';
import { checkDevice, androidConfigured, iosConfigured } from './_lib/attest.js';

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
const HOLD_MS = 24 * 3600e3;           // earnings usable 24 h after the run
const REVIEW_KEY = 'rw:review';         // held runs: "address:runId"
const BANS_KEY = 'rw:bans';             // banned addresses

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

const signerAddress = () => {
  try { return /^(0x)?[0-9a-fA-F]{64}$/.test(KEY) ? addressOfKey(KEY) : null; } catch { return null; }
};
const contractsSet = () => isAddress(TOKEN_CONTRACT) && isAddress(NFT_CONTRACT);
let sch = null;                  // emission schedule from the token (see js/rules.js), read per request
let settings = DEFAULT_SETTINGS; // game settings from the store, read per request
const isLive = () => Boolean(signerAddress() && store.storeConfigured() && contractsSet() && sch?.startDay);

function emissionView() {
  const today = utcDay();
  return {
    startDay: sch.startDay, today, limit: emissionOn(today, sch), factor: emissionFactor(today, sch), nextHalving: nextHalving(today, sch),
    change: sch.next && sch.next.fromDay > today ? sch.next : null,
  };
}

// ------------------------------------------------------------------ game settings (admin)
const SETTINGS_KEY = 'rw:settings';
const admins = () => [DEV_WALLET, ...String(env.ADMIN_WALLETS || '').split(',')].map((a) => a.trim().toLowerCase()).filter(isAddress);
export const settingsMessage = (json, issued) => `RUNNER settings\n${json}\nIssued: ${issued}`;

function validateSettings(x) {
  const num = (v, lo, hi, name) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) fail(400, `${name} must be between ${lo} and ${hi}`); return n; };
  const boosts = Array.isArray(x?.boosts) ? x.boosts : [];
  if (boosts.length > 20) fail(400, 'At most 20 boost collections');
  const requireAttestation = x?.requireAttestation === true;
  if (requireAttestation && !androidConfigured() && !iosConfigured()) fail(400, 'Set up Play Integrity (PLAY_INTEGRITY_SA) or App Attest (APPLE_TEAM_ID) on the server before requiring the phone app.');
  return {
    levelCostBase: num(x?.levelCostBase, 1, 1e9, 'Level cost base'),
    levelCostExp: num(x?.levelCostExp, 0.5, 3, 'Level cost exponent'),
    perRunnerDailyMax: num(x?.perRunnerDailyMax ?? 0, 0, 1e9, 'Per-runner daily max'),
    boosts: boosts.map((b) => {
      if (!isAddress(b?.contract)) fail(400, `Bad boost contract ${b?.contract}`);
      return { contract: b.contract.toLowerCase(), label: String(b.label || 'NFT boost').trim().slice(0, 40), boostBps: Math.round(num(b.boostBps, 0, 10_000, 'Boost')) };
    }),
    requireAttestation,
  };
}

async function setSettings({ settings: next, message, signature }) {
  const json = JSON.stringify(next);
  const issued = String(message || '').split('\nIssued: ')[1] || '';
  if (message !== settingsMessage(json, issued) || !(Math.abs(Date.now() - Date.parse(issued)) < 10 * 60e3)) fail(400, 'Unexpected or old settings message');
  const who = recoverAddress(personalDigest(message), signature);
  if (!who || !admins().includes(who)) fail(403, 'Only the dev wallet can change game settings.');
  const clean = validateSettings(next);
  await store.set(SETTINGS_KEY, clean);
  return { settings: clean };
}

// ------------------------------------------------------------------ sessions
// Token = base64url(json) + "." + keccak(secret ‖ json). keccak has no length
// extension weakness, so this is a sound MAC. The secret derives from the server key.
const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString();
const mac = (payload) => toHex(keccak(`runner-session:${KEY}:${payload}`));

export const sessionMessage = (address, issued) =>
  `Sign in to RUNNER rewards (runearn.fun)\nWallet: ${address.toLowerCase()}\nIssued: ${issued}`;

function openSession(body, { admin = false } = {}) {
  const [p, m] = String(body.session || '').split('.');
  if (!p || !m || mac(p) !== m) fail(401, 'Session expired — sign in again.');
  const s = JSON.parse(unb64(p));
  if (!(s.exp > Date.now()) || !isAddress(s.a)) fail(401, 'Session expired — sign in again.');
  if (admin && !(s.adm && admins().includes(s.a.toLowerCase()))) fail(403, 'Admin only.');
  return s.a.toLowerCase();
}

export const adminMessage = (address, issued) => `RUNNER admin sign-in\nWallet: ${address.toLowerCase()}\nIssued: ${issued}`;
function createAdminSession({ address, message, signature }) {
  const issued = String(message || '').split('\nIssued: ')[1] || '';
  if (!isAddress(address) || message !== adminMessage(address, issued) || !(Math.abs(Date.now() - Date.parse(issued)) < 10 * 60e3)) fail(400, 'Unexpected or old admin message');
  const who = recoverAddress(personalDigest(message), signature);
  if (!who || who !== address.toLowerCase() || !admins().includes(who)) fail(403, 'Only the dev wallet can open the review queue.');
  const payload = b64(JSON.stringify({ a: who, adm: 1, exp: Date.now() + 12 * 3600e3 }));
  return { session: `${payload}.${mac(payload)}` };
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
const freshUser = () => ({ earned: 0, spent: 0, signed: 0, energy: null, energyAt: Date.now(), lastEnd: 0, runs: [], pending: [] });

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
  releaseDue(u);
  return u;
}

/** Moves held earnings whose 24 h have passed (and that aren't under review) into the balance. */
function releaseDue(u) {
  const now = Date.now();
  const keep = [];
  for (const p of u.pending) {
    if (!p.review && p.releaseAt <= now) u.earned += p.micro;
    else keep.push(p);
  }
  u.pending = keep;
}
const isBanned = async (address) => Boolean(await store.get(`rw:ban:${address}`));
async function assertNotBanned(address) {
  if (await isBanned(address)) fail(403, 'This wallet is suspended from RUNNER rewards. Contact support if you think this is a mistake.');
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
    pending: u.pending.filter((p) => !p.review).reduce((t, p) => t + p.micro, 0) / MICRO,
    underReview: u.pending.filter((p) => p.review).reduce((t, p) => t + p.micro, 0) / MICRO,
    nextRelease: u.pending.filter((p) => !p.review).reduce((t, p) => Math.min(t, p.releaseAt), Infinity) === Infinity ? null : u.pending.filter((p) => !p.review).reduce((t, p) => Math.min(t, p.releaseAt), Infinity),
    energy: round2(u.energy),
    maxEnergy: maxEnergy(owned.length),
    owned,
    sneakers,
    runs: u.runs,
    emission: emissionView(),
    settings,
    boost: boostMultiplier(await heldContracts(address, settings.boosts.map((b) => b.contract)), settings),
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
    if (p.acc != null && Number(p.acc) >= 0 && Number(p.acc) < 1000) q.acc = Math.round(Number(p.acc));
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
  await assertNotBanned(address);
  await rateLimit(`run:${address}`, 30, 3600e3);
  // Device proof: required when the setting is on; otherwise checked (if the server
  // is set up for that phone) and only recorded.
  const att = run?.attestation;
  const platform = att?.platform === 'android' || att?.platform === 'ios' ? att.platform : null;
  let device = { verified: null, platform };
  const canCheck = platform === 'android' ? androidConfigured() : platform === 'ios' ? iosConfigured() : false;
  if (settings.requireAttestation || canCheck) {
    device = await checkDevice(att, runPayload(run), store);
    if (settings.requireAttestation) {
      if (device.retry) fail(503, device.reason);
      if (device.unknownKey) fail(412, device.reason);
      if (!device.verified) fail(403, `No RUNNER for this run: ${device.reason}`);
    }
  }
  const steps = cleanSteps(run?.steps, start, end);
  const mockFixes = Math.max(0, Math.min(1e6, Math.floor(Number(run?.mockFixes) || 0)));
  const trust = trustScore(pts, { steps, mockFixes, fromApp: Boolean(platform) });
  const fp = trackFingerprint(pts);
  if (fp && !(await store.setNX(`rw:fp:${fp}`, address, 30 * 864e5))) {
    trust.score = Math.max(0, trust.score - 60);
    trust.reasons.push('Same route as a run that was already uploaded');
  }
  return withUser(address, async (u, owned) => {
    if (!owned.includes(tokenId)) fail(403, `This wallet doesn't own Genesis #${tokenId}.`);
    if (start < u.lastEnd) fail(409, 'This run overlaps one that was already counted.');
    const s = await loadSneaker(tokenId);
    if (start < s.lastEnd) fail(409, `Genesis #${tokenId} was already used during this time.`);

    const day = utcDay(end);
    const factor = emissionFactor(day, sch);
    const boost = boostMultiplier(await heldContracts(address, settings.boosts.map((b) => b.contract)), settings);
    const session = scoreTrack(pts, s, u.energy, factor * boost);
    const voided = isVoided(session);
    const used = voided ? 0 : Math.min(session.used, u.energy);
    let micro = voided || session.used <= 0 ? 0 : Math.floor(session.coins * (used / session.used) * MICRO);
    // Optional per-runner daily max (admin setting), then never more than the day's
    // emission across all runners.
    let capped = false;
    if (micro > 0 && settings.perRunnerDailyMax > 0) {
      const mine = Math.round(settings.perRunnerDailyMax * factor * MICRO);
      const total = await store.incrBy(`rw:ud:${address}:${day}`, micro);
      const over = Math.min(micro, Math.max(0, total - mine));
      if (over > 0) { await store.incrBy(`rw:ud:${address}:${day}`, -over); micro -= over; capped = true; }
    }
    if (micro > 0) {
      const budget = Math.round(emissionOn(day, sch) * MICRO);
      const total = await store.incrBy(`rw:budget:${day}`, micro);
      const over = Math.min(micro, Math.max(0, total - budget));
      if (over > 0) { await store.incrBy(`rw:budget:${day}`, -over); micro -= over; capped = true; }
    }

    u.energy = Math.max(0, u.energy - used);
    u.lastEnd = end;
    s.lastEnd = end;
    s.durability = Math.max(0, round2(s.durability - used * durabilityLossPerEnergy(s)));
    await saveSneaker(s);
    const id = toHex(keccak(`${address}:${tokenId}:${start}:${end}`)).slice(0, 16);
    const review = micro > 0 && trust.score < TRUST_REVIEW_BELOW;
    const releaseAt = Date.now() + HOLD_MS;
    if (micro > 0) {
      u.pending.push({ id, micro, releaseAt, review });
      if (review) await store.listPush(REVIEW_KEY, `${address}:${id}`);
    }
    const record = {
      id, start, end, tokenId, coins: micro / MICRO, energy: round2(used), zoneSec: Math.round(session.zoneSec),
      vehicleSec: Math.round(session.vehicleSec), voided, capped, factor, boost,
      device: platform, attested: device.verified ?? null, cadence: trust.cadence,
      trust: trust.score, reasons: trust.reasons, review, releaseAt: micro > 0 ? releaseAt : null, status: micro > 0 ? (review ? 'review' : 'held') : 'none',
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
  await assertNotBanned(address);
  return withUser(address, async (u, owned) => {
    if (!owned.includes(tokenId)) fail(403, `This wallet doesn't own Genesis #${tokenId}.`);
    const s = await loadSneaker(tokenId);
    const factor = emissionFactor(utcDay(), sch); // costs halve with emission
    if (action === 'levelup') {
      if (s.level >= MAX_LEVEL) fail(400, 'Already max level');
      spend(u, levelUpCost(s, factor, settings));
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
  await assertNotBanned(address);
  return withUser(address, async (u, owned) => {
    const total = u.earned - u.spent;              // everything ever earned and not spent in-app
    if (total <= 0) fail(400, 'Nothing to claim yet — go for a run!');
    // The contract pays at most today's emission across everyone: sign only what still fits.
    const today = utcDay();
    const chain = await claimState(address, today, TOKEN_CONTRACT);
    const doneMicro = Number(chain.claimed / 10n ** 12n);
    const leftToday = Math.max(0, Math.floor(emissionOn(today, sch) * MICRO) - Number(chain.claimedToday / 10n ** 12n));
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

// ------------------------------------------------------------------ rate limits
async function rateLimit(key, limit, windowMs) {
  if (!store.storeConfigured()) return;
  const n = await store.incrTtl(`rw:rl:${key}`, windowMs);
  if (n > limit) fail(429, 'Too many requests — please slow down and try again in a few minutes.');
}

// ------------------------------------------------------------------ admin: review queue, bans
async function adminOp(admin, body) {
  const op = body.op;
  if (op === 'queue') {
    const items = [];
    for (const key of await store.listRange(REVIEW_KEY, 200)) {
      const [address, id] = key.split(':');
      const u = (await store.get(userKey(address))) || {};
      const run = (u.runs || []).find((r) => r.id === id);
      const p = (u.pending || []).find((x) => x.id === id);
      if (!p) { await store.listRemove(REVIEW_KEY, key); continue; }
      items.push({ address, id, coins: p.micro / MICRO, trust: run?.trust, reasons: run?.reasons || [], tokenId: run?.tokenId, start: run?.start, end: run?.end, device: run?.device ?? null, attested: run?.attested ?? null, cadence: run?.cadence ?? null, banned: await isBanned(address) });
    }
    return { queue: items, bans: await store.listRange(BANS_KEY, 500) };
  }
  if (op === 'approve' || op === 'void') {
    const address = String(body.address || '').toLowerCase(), id = String(body.id || '');
    if (!isAddress(address)) fail(400, 'Bad address');
    await withUser(address, async (u) => {
      const p = u.pending.find((x) => x.id === id);
      if (!p) fail(404, 'That run is no longer waiting for review.');
      u.pending = u.pending.filter((x) => x.id !== id);
      if (op === 'approve') u.earned += p.micro;
      const run = u.runs.find((r) => r.id === id);
      if (run) run.status = op === 'approve' ? 'approved' : 'voided';
      return { ok: true };
    });
    await store.listRemove(REVIEW_KEY, `${address}:${id}`);
    return { ok: true, op, address, id, by: admin };
  }
  if (op === 'ban' || op === 'unban') {
    const address = String(body.address || '').toLowerCase();
    if (!isAddress(address)) fail(400, 'Bad address');
    if (op === 'ban') {
      await store.set(`rw:ban:${address}`, { at: Date.now(), by: admin, reason: String(body.reason || '').slice(0, 200) });
      await store.listPush(BANS_KEY, address, 5000);
    } else {
      await store.del(`rw:ban:${address}`);
      await store.listRemove(BANS_KEY, address);
    }
    return { ok: true, op, address };
  }
  fail(400, 'Unknown admin operation');
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
    if (contractsSet()) sch = await emissionSchedule(TOKEN_CONTRACT).catch(() => sch);
    if (store.storeConfigured()) settings = { ...DEFAULT_SETTINGS, ...((await store.get(SETTINGS_KEY).catch(() => null)) || {}) };
    if (action === 'status') {
      res.status(200).json({ live: isLive(), signer: signerAddress(), store: store.storeConfigured(), token: TOKEN_CONTRACT || null, nft: NFT_CONTRACT || null, chainId: TOKEN_CHAIN.id, emission: sch?.startDay ? emissionView() : null, settings, attestation: { android: androidConfigured(), ios: iosConfigured() } });
      return;
    }
    if (req.method !== 'POST') fail(405, 'POST only');
    const ip = String(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || 'local').split(',')[0].trim();
    await rateLimit(`ip:${ip}`, 120, 60e3);
    if (['session', 'admin-session', 'settings-set'].includes(action)) await rateLimit(`ipsess:${ip}`, 20, 3600e3);
    if (action === 'settings-set') {
      if (!store.storeConfigured()) fail(503, 'Database not connected yet.');
      res.status(200).json(await setSettings(body));
      return;
    }
    if (action === 'admin-session') { res.status(200).json(createAdminSession(body)); return; }
    if (action === 'admin') { res.status(200).json(await adminOp(openSession(body, { admin: true }), body)); return; }
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
