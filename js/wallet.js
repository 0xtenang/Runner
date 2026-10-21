// On-chain wallet data for the signed-in user's embedded wallet on Robinhood
// Chain: ETH balance, USD price, recent transfers and fee estimates.
// Amounts are kept as BigInt wei so real money never goes through floats.
import { ROBINHOOD_CHAIN, BLOCKSCOUT_API } from './config.js';

const WEI = 10n ** 18n;
const RPCS = ROBINHOOD_CHAIN.rpcUrls.default.http;

/** JSON-RPC call, trying each endpoint in turn. */
async function rpc(method, params = []) {
  let lastErr;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'RPC error');
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Couldn't reach Robinhood Chain (${lastErr?.message || 'network error'})`);
}

export const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a).trim());

/** "0.0123" (ETH, decimal string) → wei BigInt. Returns null if invalid. */
export function parseEth(str) {
  const s = String(str).trim().replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 18) return null;
  return BigInt(whole || '0') * WEI + BigInt((frac + '0'.repeat(18)).slice(0, 18));
}

/** wei BigInt → "0.0123" trimmed to `dp` decimals (rounded down). */
export function formatEth(wei, dp = 5) {
  const neg = wei < 0n; if (neg) wei = -wei;
  const whole = wei / WEI;
  const frac = (wei % WEI).toString().padStart(18, '0').slice(0, dp).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export async function getBalance(address) {
  return BigInt(await rpc('eth_getBalance', [address, 'latest']));
}

let priceCache = { at: 0, usd: null };
/** ETH price in USD (cached 5 min). Null if unavailable — it's only a display hint. */
export async function getEthUsd() {
  if (Date.now() - priceCache.at < 300000) return priceCache.usd;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    priceCache = { at: Date.now(), usd: (await r.json())?.ethereum?.usd ?? null };
  } catch { priceCache = { at: Date.now(), usd: null }; }
  return priceCache.usd;
}

export function toUsd(wei, usd) {
  if (usd == null) return null;
  return (Number(wei / 10n ** 12n) / 1e6) * usd; // 6-decimal precision is plenty for display
}

/** Recent ETH transfers (value > 0) in/out of `address`, from the Blockscout explorer API. */
export async function getTransfers(address, limit = 4) {
  const r = await fetch(`${BLOCKSCOUT_API}/addresses/${address}/transactions`);
  if (!r.ok) throw new Error(`Explorer unavailable (${r.status})`);
  const items = (await r.json()).items || [];
  const me = address.toLowerCase();
  return items.filter((t) => BigInt(t.value || '0') > 0n).slice(0, limit).map((t) => ({
    hash: t.hash,
    incoming: (t.to?.hash || '').toLowerCase() === me && (t.from?.hash || '').toLowerCase() !== me,
    counterparty: (t.from?.hash || '').toLowerCase() === me ? t.to?.hash : t.from?.hash,
    value: BigInt(t.value || '0'),
    time: t.timestamp ? Date.parse(t.timestamp) : null,
    ok: t.status !== 'error' && t.result !== 'error',
  }));
}

/** Estimated network fee (wei) for a plain ETH transfer, with a 30% safety margin. */
export async function estimateFee(from, to, value) {
  const [gas, price] = await Promise.all([
    rpc('eth_estimateGas', [{ from, to, value: `0x${value.toString(16)}` }]).catch(() => '0x5208'), // 21000 fallback
    rpc('eth_gasPrice'),
  ]);
  return (BigInt(gas) * BigInt(price) * 13n) / 10n;
}

export const txUrl = (hash) => `${ROBINHOOD_CHAIN.blockExplorers.default.url}/tx/${hash}`;
