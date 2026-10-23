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

let startCache = null;
/** UTC day the run-reward emission started (0 = not started). Never changes once set. */
export async function emissionStartDay(token = TOKEN_CONTRACT) {
  if (TESTING && env.REWARDS_FAKE_TOKEN) return JSON.parse(env.REWARDS_FAKE_TOKEN).startDay || 0;
  if (startCache) return startCache;
  const d = Number(await tokenUint(token, '0xe27831bb'));
  if (d) startCache = d;
  return d;
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
