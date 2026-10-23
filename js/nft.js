// RUNNER Genesis NFT contract: read ownership/availability and build the
// mint transaction. Uses raw JSON-RPC + hand-encoded ABI (selectors from the
// compiled contract) so no web3 library is needed.
import { NFT_CHAIN, NFT_CONTRACT } from './config.js';

const SEL = {
  tokensOfOwner: '8462151c', // tokensOfOwner(address)
  mintedBatch: '8b96caed',   // mintedBatch(uint256[])
  totalSupply: '18160ddd',   // totalSupply()
  paused: '5c975abb',        // paused()
  mint: 'a0712d68',          // mint(uint256)
};
const RPCS = NFT_CHAIN.rpcUrls.default.http;

export const nftLive = () => /^0x[0-9a-fA-F]{40}$/.test(NFT_CONTRACT);
export const nftExplorerTx = (hash) => `${NFT_CHAIN.blockExplorers.default.url}/tx/${hash}`;
export const nftExplorerToken = (id) => `${NFT_CHAIN.blockExplorers.default.url}/token/${NFT_CONTRACT}/instance/${id}`;

async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'RPC error');
      return j.result;
    } catch (e) { last = e; }
  }
  throw new Error(`Couldn't reach ${NFT_CHAIN.name} (${last?.message || 'network error'})`);
}

const u256 = (n) => BigInt(n).toString(16).padStart(64, '0');
const addr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const word = (hex, i) => BigInt(`0x${hex.slice(2 + i * 64, 2 + i * 64 + 64) || '0'}`);
const call = (data) => rpc('eth_call', [{ to: NFT_CONTRACT, data: `0x${data}` }, 'latest']);

/** Token ids owned by `address` (sorted). */
export async function ownedTokens(address) {
  if (!nftLive()) return [];
  const ret = await call(SEL.tokensOfOwner + addr(address));
  const n = Number(word(ret, 1));
  return Array.from({ length: n }, (_, i) => Number(word(ret, 2 + i))).sort((a, b) => a - b);
}

/** For each id: true if already minted. */
export async function mintedStatus(ids) {
  if (!nftLive() || !ids.length) return ids.map(() => false);
  const ret = await call(SEL.mintedBatch + u256(32) + u256(ids.length) + ids.map(u256).join(''));
  return ids.map((_, i) => word(ret, 2 + i) === 1n);
}

export async function totalMinted() {
  if (!nftLive()) return 0;
  return Number(word(await call(SEL.totalSupply), 0));
}

export async function salesPaused() {
  if (!nftLive()) return true;
  return word(await call(SEL.paused), 0) === 1n;
}

export const mintData = (id) => `0x${SEL.mint}${u256(id)}`;

export async function nativeBalance(address) {
  return BigInt(await rpc('eth_getBalance', [address, 'latest']));
}

/** Rough fee for a mint (gas ≈ 130k), with margin. */
export async function mintFeeEstimate() {
  const price = BigInt(await rpc('eth_gasPrice', []));
  return price * 160000n;
}

/** Waits for a transaction to be mined; resolves with the receipt. */
export async function waitForReceipt(hash, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const rcpt = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (rcpt) return rcpt;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Still waiting for the network to confirm — check again in a minute.');
}

export { rpc as nftRpc };
