// Read-only chain access for the rewards server: which sneakers a wallet owns,
// and the token's emission schedule / claim counters.
import { NFT_CHAIN, NFT_CONTRACT, TOKEN_CHAIN, TOKEN_CONTRACT } from '../../js/config.js';

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
