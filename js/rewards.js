// Client for the RUNNER rewards server (api/rewards.js).
//
// Once the token, the NFT and the server are live, the server is the source of
// truth: finished runs are uploaded and re-scored there, level-ups and repairs
// are paid from the server balance, and "Claim" turns that balance into real
// RUNNER tokens in the wallet. Before that, everything stays local (game.js).
import { auth } from './auth.js';
import { game } from './game.js';
import { TOKEN_CHAIN, TOKEN_CONTRACT, NFT_CONTRACT } from './config.js';

// The website calls its own API; the phone app (served from the device) calls runearn.fun.
const API = /(^|\.)runearn\.fun$/.test(location.hostname) || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? '/api/rewards' : 'https://www.runearn.fun/api/rewards';
const SESSION_KEY = (a) => `runner.rewards.session.${a.toLowerCase()}`;
const sessionMessage = (address, issued) =>
  `Sign in to RUNNER rewards (runearn.fun)\nWallet: ${address.toLowerCase()}\nIssued: ${issued}`;
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');

let serverLive = null; // null = not checked yet
let statusAt = 0;

async function checkStatus() {
  if (!isAddr(TOKEN_CONTRACT) || !isAddr(NFT_CONTRACT)) return (serverLive = false);
  if (serverLive != null && Date.now() - statusAt < 5 * 60e3) return serverLive;
  try {
    const s = await (await fetch(`${API}?action=status`, { cache: 'no-store' })).json();
    serverLive = Boolean(s.live);
  } catch { serverLive = serverLive ?? false; }
  statusAt = Date.now();
  return serverLive;
}

/** True when earnings are real: server live, contracts set, wallet signed in. */
export const rewardsActive = () => Boolean(serverLive && auth.signedIn);
/** Has this wallet signed in to the rewards server on this device? */
export const rewardsConnected = () => Boolean(auth.signedIn && storedSession(auth.state.address));
/** RUNNER already claimed on-chain by `address` (whole tokens). */
export async function claimedOnChain(address = auth.state.address) {
  if (!isAddr(TOKEN_CONTRACT) || !address) return 0;
  return Number(await tokenCall(`0xc884ef83${addrWord(address)}`)) / 1e18;
}
export { checkStatus as checkRewardsStatus };

function storedSession(address) {
  try { return localStorage.getItem(SESSION_KEY(address)); } catch { return null; }
}

async function session({ prompt = true } = {}) {
  const address = auth.state.address;
  const saved = storedSession(address);
  if (saved) return saved;
  if (!prompt) return null;
  const message = sessionMessage(address, new Date().toISOString());
  const signature = await auth.signMessage(message);
  const r = await post({ action: 'session', address, message, signature }, false);
  try { localStorage.setItem(SESSION_KEY(address), r.session); } catch { /* storage blocked: sign again next time */ }
  return r.session;
}

async function post(body, withSession = true, retried = false) {
  if (withSession) body = { ...body, session: await session() };
  let res;
  try {
    res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    const e = new Error('No connection to the RUNNER server.');
    e.offline = true;
    throw e;
  }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && withSession && !retried) {
    try { localStorage.removeItem(SESSION_KEY(auth.state.address)); } catch { /* ignore */ }
    return post({ ...body, session: undefined }, true, true);
  }
  if (!res.ok) {
    const e = new Error(j.error || `Server error (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return j;
}

/** Refreshes balance/energy/progress from the server and retries queued runs. */
export async function syncRewards({ prompt = false } = {}) {
  if (!(await checkStatus()) || !auth.signedIn) return null;
  if (!prompt && !storedSession(auth.state.address)) return null; // don't pop a signature request unasked
  for (const run of [...(game.state.pendingRuns || [])]) {
    try {
      const r = await post({ action: 'run', run });
      await game.applyServer(r.state);
      await game.dropPending(run);
      game.logServerRun(r.run);
    } catch (e) {
      if (e.offline || e.status === 409 && /Busy/.test(e.message)) break;
      await game.dropPending(run); // rejected for good (too old, overlap, not owned)
    }
  }
  const view = await post({ action: 'state' });
  await game.applyServer(view);
  return view;
}

/** Ask for the wallet signature now (from a button), then sync. */
export const connectRewards = () => syncRewards({ prompt: true });

/**
 * Settles a finished recording. With the server live the GPS track is uploaded
 * and the server decides the reward; otherwise the local engine does.
 */
export async function settleRun(earnSession, activityId, points) {
  await checkStatus();
  if (!rewardsActive() || !earnSession?.sneakerId) return game.settle(earnSession, activityId);
  const sneaker = game.sneaker(earnSession.sneakerId);
  const base = { coins: 0, energy: 0, voided: false, sneakerId: earnSession.sneakerId, zoneSec: Math.round(earnSession.zoneSec), server: true,
    sneakerLabel: sneaker ? `#${sneaker.serial}` : null, hrVerified: earnSession.hrSec > earnSession.zoneSec * 0.8 && earnSession.zoneSec > 0 };
  if (!sneaker || earnSession.used <= 0) return base;
  const run = { tokenId: sneaker.tokenId, points: points.map(({ t, lat, lon, hr, b }) => ({ t, lat, lon, ...(hr ? { hr } : {}), ...(b ? { b } : {}) })) };
  try {
    const r = await post({ action: 'run', run });
    await game.applyServer(r.state);
    game.logServerRun(r.run, activityId);
    return { ...base, coins: r.run.coins, energy: r.run.energy, voided: r.run.voided, capped: r.run.capped, zoneSec: r.run.zoneSec };
  } catch (e) {
    if (e.offline || e.status >= 500 || e.status === 409 && /Busy/.test(e.message)) {
      await game.queuePending(run);
      return { ...base, pending: true };
    }
    return { ...base, rejected: e.message };
  }
}

/** Level-up / repair / allocate: server-paid when live, local otherwise. */
export async function upgrade(action, id, add) {
  await checkStatus();
  if (!rewardsActive()) {
    if (action === 'levelup') return game.levelUp(id);
    if (action === 'repair') return game.repair(id);
    return game.allocate(id, add);
  }
  const s = game.sneaker(id);
  const view = await post({ action, tokenId: s.tokenId, add });
  await game.applyServer(view);
}

// ------------------------------------------------------------------ on-chain
async function tokenCallRaw(data) {
  let last;
  for (const url of TOKEN_CHAIN.rpcUrls.default.http) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: TOKEN_CONTRACT, data }, 'latest'] }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return String(j.result || '0x');
    } catch (e) { last = e; }
  }
  throw last || new Error('Network error');
}

async function tokenCall(data) {
  let last;
  for (const url of TOKEN_CHAIN.rpcUrls.default.http) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: TOKEN_CONTRACT, data }, 'latest'] }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return BigInt(!j.result || j.result === '0x' ? 0 : j.result);
    } catch (e) { last = e; }
  }
  throw last || new Error('Network error');
}
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

/** RUNNER tokens already in the wallet (on-chain), in whole-token units. */
export async function tokenBalance(address = auth.state.address) {
  if (!isAddr(TOKEN_CONTRACT) || !address) return null;
  return Number(await tokenCall(`0x70a08231${addrWord(address)}`)) / 1e18;
}

/**
 * Moves the unclaimed balance on-chain: the server signs, the wallet sends claim()
 * to the token (needs a little ETH for gas). `instant` = 80% now and 20% burned;
 * otherwise the full amount is locked in the contract for 7 days.
 */
export async function claimRewards(onStatus = () => {}, instant = false) {
  onStatus('Asking the RUNNER server to sign your claim…');
  const r = await post({ action: 'claim' });
  await game.applyServer(r.state);
  const c = r.claim;
  const already = await tokenCall(`0xc884ef83${addrWord(c.account)}`).catch(() => 0n); // claimed(account)
  if (BigInt(c.totalEarned) <= already) throw new Error('Everything you earned is already in your wallet.');
  const data = `0xec558eda${addrWord(c.account)}${word(c.totalEarned)}${word(c.deadline)}${word(c.v)}${c.r.slice(2)}${c.s.slice(2)}${word(instant ? 1 : 0)}`;
  onStatus('Confirm the claim in your wallet…');
  const hash = await auth.sendTx({ to: TOKEN_CONTRACT, data, chainId: TOKEN_CHAIN.id });
  return { hash, amount: Number(BigInt(c.totalEarned) - already) / 1e18, partial: Boolean(c.partial), instant };
}

// ------------------------------------------------------------------ 7-day locks
export const INSTANT_BURN = 0.2;
export const LOCK_DAYS = 7;

/** Locked run rewards: { locked, unlocked, nextUnlockAt (ms), count } in whole tokens. */
export async function lockInfo(address = auth.state.address) {
  if (!isAddr(TOKEN_CONTRACT) || !address) return null;
  const h = (await tokenCallRaw(`0xc3f9ab58${addrWord(address)}`)).replace(/^0x/, '');
  if (h.length < 256) return { locked: 0, unlocked: 0, nextUnlockAt: null, count: 0 };
  const w = (i) => BigInt(`0x${h.slice(i * 64, (i + 1) * 64)}`);
  return { locked: Number(w(0)) / 1e18, unlocked: Number(w(1)) / 1e18, nextUnlockAt: w(2) ? Number(w(2)) * 1000 : null, count: Number(w(3)) };
}
/** Pays out finished locks (100%). */
export const releaseRewards = () => auth.sendTx({ to: TOKEN_CONTRACT, data: `0x19165587${addrWord(auth.state.address)}`, chainId: TOKEN_CHAIN.id });
/** Takes every lock now: finished ones 100%, unfinished 80% (20% burned). */
export const releaseEarly = () => auth.sendTx({ to: TOKEN_CONTRACT, data: '0xa2c48db8', chainId: TOKEN_CHAIN.id });

// ------------------------------------------------------------------ holder rewards (2% of trades)
export const MIN_HOLDING = 300_000;

/** Holder rewards `address` can claim now (whole tokens), or null if the token isn't live. */
export async function holderClaimable(address = auth.state.address) {
  if (!isAddr(TOKEN_CONTRACT) || !address) return null;
  return Number(await tokenCall(`0x7a8afcc2${addrWord(address)}`)) / 1e18;
}

/** Sends claimHolderRewards() from the wallet. Resolves with the tx hash. */
export const claimHolderRewards = () => auth.sendTx({ to: TOKEN_CONTRACT, data: '0x1979f81e', chainId: TOKEN_CHAIN.id });

export const tokenExplorerTx = (hash) => `${TOKEN_CHAIN.blockExplorers.default.url}/tx/${hash}`;
