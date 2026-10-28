// Read-only chain access for the rewards server: which sneakers a wallet owns,
// and the token's emission schedule / claim counters.
import { NFT_CHAIN, NFT_CONTRACT, TOKEN_CHAIN, TOKEN_CONTRACT, HOOK_CONTRACT, IMD_TOKEN, IMD_ETH_POOL } from '../../js/config.js';
import { keccak_256 } from './noble/sha3.js';

const env = globalThis.process?.env || {};
const TESTING = env.VERCEL_ENV !== 'production' && env.REWARDS_STORE === 'memory';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

async function rpc(chain, method, params) {
  let last;
  for (const url of chain.rpcUrls.default.http) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; }
  }
  throw new Error(`Couldn't reach ${chain.name}: ${last?.message || 'network error'}`);
}

/** Token ids `address` owns in RUNNER Genesis (tokensOfOwner). */
export async function ownedTokenIds(address, nft = NFT_CONTRACT) {
  if (TESTING && env.REWARDS_FAKE_OWNED) return JSON.parse(env.REWARDS_FAKE_OWNED)[address.toLowerCase()] || [];
  const out = String(await rpc(NFT_CHAIN, 'eth_call', [{ to: nft, data: `0x8462151c${addrWord(address)}` }, 'latest'])).replace(/^0x/, '');
  if (out.length < 128) return [];
  const n = parseInt(out.slice(64, 128), 16);
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(parseInt(out.slice(128 + i * 64, 192 + i * 64), 16));
  return ids;
}

const tokenUint = async (token, data) => {
  const r = await rpc(TOKEN_CHAIN, 'eth_call', [{ to: token, data }, 'latest']);
  return BigInt(!r || r === '0x' ? 0 : r);
};

/** Several eth_calls in one JSON-RPC batch (falls back to one by one). Returns the results in order. */
async function callBatch(chain, calls) {
  for (const url of chain.rpcUrls.default.http) {
    try {
      const body = calls.map((c, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [c, 'latest'] }));
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!Array.isArray(j) || j.some((x) => x.error)) throw new Error('batch failed');
      return j.sort((x, y) => x.id - y.id).map((x) => x.result);
    } catch { /* next endpoint */ }
  }
  const out = [];
  for (const c of calls) out.push(await rpc(chain, 'eth_call', [c, 'latest']));
  return out;
}

/**
 * RUNNER Genesis holders: { holders (unique wallets), sneakers (minted) }. Finds the minted ids with
 * mintedBatch() in chunks (stopping once all totalSupply are found), then their owners with ownerOf().
 */
export async function genesisHolders(nft = NFT_CONTRACT) {
  if (TESTING && env.REWARDS_FAKE_OWNED) {
    const owned = Object.values(JSON.parse(env.REWARDS_FAKE_OWNED));
    return { holders: owned.filter((ids) => ids.length).length, sneakers: owned.reduce((n, ids) => n + ids.length, 0) };
  }
  const supply = Number(BigInt(await rpc(NFT_CHAIN, 'eth_call', [{ to: nft, data: '0x18160ddd' }, 'latest']) || 0)); // totalSupply()
  const minted = [];
  const CHUNK = 2000, MAX = 9999;
  for (let start = 1; start <= MAX && minted.length < supply; start += CHUNK) {
    const ids = []; for (let i = start; i < Math.min(start + CHUNK, MAX + 1); i++) ids.push(i);
    const data = `0x8b96caed${word(32)}${word(ids.length)}${ids.map(word).join('')}`; // mintedBatch(uint256[])
    const out = String(await rpc(NFT_CHAIN, 'eth_call', [{ to: nft, data }, 'latest'])).replace(/^0x/, '');
    ids.forEach((id, i) => { if (out.slice(128 + i * 64 + 63, 128 + i * 64 + 64) === '1') minted.push(id); });
  }
  const owners = new Set();
  for (let i = 0; i < minted.length; i += 200) {
    const res = await callBatch(NFT_CHAIN, minted.slice(i, i + 200).map((id) => ({ to: nft, data: `0x6352211e${word(id)}` }))); // ownerOf
    res.forEach((r) => { if (r && r.length >= 66) owners.add(`0x${r.slice(-40)}`.toLowerCase()); });
  }
  return { holders: owners.size, sneakers: minted.length };
}

/** RUNNER paid out by claim() so far (whole tokens), read from the token. */
export async function totalClaimed(token = TOKEN_CONTRACT) {
  return Number((await tokenUint(token, '0xd54ad2a1')) / 10n ** 12n) / 1e6; // totalClaimed()
}

const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'; // Uniswap v4 StateView on Robinhood Chain
const toWhole = (raw) => Number(raw / 10n ** 12n) / 1e6; // 18-decimal amount → number (6 decimals kept)

/**
 * IMD earned by RUNNER holders so far: what the token has booked (totalHolderRewards) plus the 2%
 * share still waiting in the hook for its next flush. Also IMD's price in ETH from the IMD/ETH
 * pool, so the stats can show a value. { imd, ethPerImd }.
 */
export async function holderRewards(token = TOKEN_CONTRACT) {
  if (TESTING) return { imd: Number(env.REWARDS_FAKE_HOLDER_IMD || 0), ethPerImd: 0.002, imdPerRunner: 0.000003 };
  const id = (c0, c1, fee, spacing, hooks) => Buffer.from(keccak_256(Buffer.from(addrWord(c0) + addrWord(c1) + word(fee) + word(spacing) + addrWord(hooks), 'hex'))).toString('hex');
  const imdEth = id('0x0', IMD_TOKEN, IMD_ETH_POOL.fee, IMD_ETH_POOL.tickSpacing, IMD_ETH_POOL.hooks);
  const runnerIs0 = BigInt(token) < BigInt(IMD_TOKEN);
  const hookPool = runnerIs0 ? id(token, IMD_TOKEN, 0, 200, HOOK_CONTRACT) : id(IMD_TOKEN, token, 0, 200, HOOK_CONTRACT);
  const [booked, pending, slot0, hookSlot0] = await callBatch(TOKEN_CHAIN, [
    { to: token, data: '0xca0c8045' }, // totalHolderRewards()
    { to: HOOK_CONTRACT, data: `0x2f22b8a2${addrWord(token)}` }, // pendingHolderFees(token)
    { to: STATE_VIEW, data: `0xc815641c${imdEth}` }, // getSlot0(IMD/ETH pool): ETH is currency0
    { to: STATE_VIEW, data: `0xc815641c${hookPool}` }, // getSlot0(RUNNER/IMD hook pool)
  ]);
  const imd = toWhole(BigInt(booked || 0) + BigInt(pending || 0));
  const price = (ret) => { // token1 per token0 from sqrtPriceX96
    const sq = BigInt(String(ret || '0x').slice(0, 66) || 0);
    return sq ? Number((sq * sq * 10n ** 18n) >> 192n) / 1e18 : 0;
  };
  const imdPerEth = price(slot0), hookP = price(hookSlot0);
  return { imd, ethPerImd: imdPerEth ? 1 / imdPerEth : null, imdPerRunner: hookP ? (runnerIs0 ? hookP : 1 / hookP) : null };
}

let ethUsdCache = null; // { at, usd }
/** ETH in USD (CoinGecko, cached 5 minutes). Null if unavailable: the value is only a display hint. */
export async function ethUsd() {
  if (TESTING) return 3000;
  if (ethUsdCache && Date.now() - ethUsdCache.at < 300e3) return ethUsdCache.usd;
  let usd = ethUsdCache?.usd ?? null;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    usd = (await r.json())?.ethereum?.usd ?? usd;
  } catch { /* keep the last price */ }
  ethUsdCache = { at: Date.now(), usd };
  return usd;
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/**
 * RUNNER (wei) that `address` burned in transaction `txHash`: the token's Transfer(address → 0) logs,
 * only if the transaction succeeded. 0n if none (or the transaction isn't mined yet).
 */
export async function burnedBy(txHash, address, token = TOKEN_CONTRACT) {
  if (TESTING && env.REWARDS_FAKE_BURNS) {
    const b = JSON.parse(env.REWARDS_FAKE_BURNS)[txHash];
    return b && b.from.toLowerCase() === address.toLowerCase() ? BigInt(b.wei) : 0n;
  }
  const r = await rpc(TOKEN_CHAIN, 'eth_getTransactionReceipt', [txHash]);
  if (!r || r.status !== '0x1') return 0n;
  const from = `0x${addrWord(address)}`, zero = `0x${'0'.repeat(64)}`;
  return (r.logs || [])
    .filter((l) => l.address?.toLowerCase() === token.toLowerCase() && l.topics?.[0] === TRANSFER_TOPIC && l.topics[1]?.toLowerCase() === from && l.topics[2] === zero)
    .reduce((t, l) => t + BigInt(l.data), 0n);
}

let scheduleCache = null; // { at, value }
/**
 * The token's emission schedule in whole RUNNER: { startDay, current, next } (see
 * js/rules.js), or null before startEmission(). Cached for a minute.
 */
export async function emissionSchedule(token = TOKEN_CONTRACT) {
  if (TESTING && env.REWARDS_FAKE_TOKEN) {
    const f = JSON.parse(env.REWARDS_FAKE_TOKEN);
    if (!f.startDay) return null;
    return { startDay: f.startDay, current: f.current || { dailyStart: 10_000_000, floor: 100_000, halvingDays: 30, fromDay: f.startDay }, next: f.next || null };
  }
  if (scheduleCache && Date.now() - scheduleCache.at < 60e3) return scheduleCache.value;
  const startDay = Number(await tokenUint(token, '0xe27831bb')); // emissionStartDay()
  let value = null;
  if (startDay) {
    value = decodeSchedule(await rpc(TOKEN_CHAIN, 'eth_call', [{ to: token, data: '0xed51e69c' }, 'latest']), startDay); // emissionSchedule()
  }
  scheduleCache = { at: Date.now(), value };
  return value;
}

/** Decodes emissionSchedule() return data (two Schedule structs) into whole-RUNNER numbers. */
export function decodeSchedule(ret, startDay) {
  const h = String(ret).replace(/^0x/, '');
  const w = (i) => BigInt(`0x${h.slice(i * 64, (i + 1) * 64) || '0'}`);
  const sch = (o) => ({ dailyStart: Number(w(o) / 10n ** 18n), floor: Number(w(o + 1) / 10n ** 18n), halvingDays: Number(w(o + 2)), fromDay: Number(w(o + 3)) });
  const next = sch(4);
  return { startDay, current: sch(0), next: next.fromDay ? next : null };
}

/** Which of `contracts` (ERC-721) `address` holds at least one token of. */
export async function heldContracts(address, contracts) {
  if (!contracts.length) return [];
  if (TESTING && env.REWARDS_FAKE_HELD) {
    const held = (JSON.parse(env.REWARDS_FAKE_HELD)[address.toLowerCase()] || []).map((c) => c.toLowerCase());
    return contracts.filter((c) => held.includes(c.toLowerCase()));
  }
  const results = await Promise.all(contracts.map(async (c) => {
    try {
      const r = await rpc(NFT_CHAIN, 'eth_call', [{ to: c, data: `0x70a08231${addrWord(address)}` }, 'latest']); // balanceOf(address)
      return BigInt(!r || r === '0x' ? 0 : r) > 0n ? c : null;
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

/** On-chain claim state: RUNNER (wei) already claimed by `account`, and claimed today by everyone. */
export async function claimState(account, day, token = TOKEN_CONTRACT) {
  if (TESTING && env.REWARDS_FAKE_TOKEN) {
    const f = JSON.parse(env.REWARDS_FAKE_TOKEN);
    return { claimed: BigInt(f.claimed?.[account.toLowerCase()] || 0), claimedToday: BigInt(f.claimedToday || 0) };
  }
  const [claimed, claimedToday] = await Promise.all([
    tokenUint(token, `0xc884ef83${addrWord(account)}`),
    tokenUint(token, `0xd5171c01${word(day)}`),
  ]);
  return { claimed, claimedToday };
}
