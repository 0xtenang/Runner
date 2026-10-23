// Read-only chain access for the rewards server (which sneakers a wallet owns).
import { NFT_CHAIN, NFT_CONTRACT } from '../../js/config.js';

const env = globalThis.process?.env || {};

async function rpc(method, params) {
  let last;
  for (const url of NFT_CHAIN.rpcUrls.default.http) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; }
  }
  throw new Error(`Couldn't reach ${NFT_CHAIN.name}: ${last?.message || 'network error'}`);
}

/** Token ids `address` owns in RUNNER Genesis (tokensOfOwner). */
export async function ownedTokenIds(address) {
  if (env.REWARDS_FAKE_OWNED && env.VERCEL_ENV !== 'production') return JSON.parse(env.REWARDS_FAKE_OWNED)[address.toLowerCase()] || []; // local tests only
  const data = `0x8462151c${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
  const out = String(await rpc('eth_call', [{ to: NFT_CONTRACT, data }, 'latest'])).replace(/^0x/, '');
  if (out.length < 128) return [];
  const n = parseInt(out.slice(64, 128), 16);
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(parseInt(out.slice(128 + i * 64, 192 + i * 64), 16));
  return ids;
}
