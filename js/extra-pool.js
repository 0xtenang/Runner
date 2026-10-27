// RUNNER/ETH Uniswap v4 pool (10% LP fee, no hook), like the extra Pepes pools. It is created and
// filled through Uniswap's own v4 PositionManager, so the position is a normal Uniswap LP position
// (an NFT owned by the wallet that adds it), visible and manageable in the Uniswap app.
//
// Trades in this pool don't go through the RunnerHook: they pay the 10% LP fee to the liquidity
// provider, not the 4% split to the protocol and holders. The PoolManager is excluded from holder
// rewards, so the RUNNER in this pool doesn't dilute holders.
import { TOKEN_CHAIN, TOKEN_CONTRACT, HOOK_CONTRACT, IMD_TOKEN, IMD_ETH_POOL } from './config.js';

// Uniswap's Robinhood Chain deployments (Uniswap/sdks → sdk-core addresses.ts; PoolManager matches config.js).
export const POSITION_MANAGER = '0x58daec3116aae6d93017baaea7749052e8a04fa7';
export const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const VIEM = 'https://esm.sh/viem@2.21.54';

export const ETH_POOL_FEE = 100_000; // 10% (in hundredths of a bip)
export const ETH_POOL_TICK_SPACING = 1000; // what the Uniswap app uses for a custom fee: fee / 100
export const FULL_RANGE = { lower: -887000, upper: 887000 }; // widest ticks on a 1000 spacing
const ZERO = '0x0000000000000000000000000000000000000000';
const Q96 = 1n << 96n;

/** The pool key: ETH (currency0, address 0) / RUNNER, 10%, no hook. */
export const ethPoolKey = () => ({ currency0: ZERO, currency1: TOKEN_CONTRACT, fee: ETH_POOL_FEE, tickSpacing: ETH_POOL_TICK_SPACING, hooks: ZERO });

let viemP;
const viem = () => (viemP ||= import(VIEM));

async function rpc(method, params) {
  let last;
  for (const url of TOKEN_CHAIN.rpcUrls.default.http) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('Network error');
}
const ethCall = async (to, data) => (await rpc('eth_call', [{ to, data }, 'latest'])) || '0x';
const ethBalance = async (a) => BigInt(await rpc('eth_getBalance', [a, 'latest']));

const KEY_TYPE = '(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)';

export async function poolId(key) {
  const { keccak256, encodeAbiParameters, parseAbiParameters } = await viem();
  return keccak256(encodeAbiParameters(parseAbiParameters('address, address, uint24, int24, address'), [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}

/** StateView.getSlot0(poolId) → { sqrtPriceX96, tick } (sqrtPriceX96 0 = pool not created). */
async function slot0(key) {
  const { encodeFunctionData, decodeFunctionResult, parseAbi } = await viem();
  const abi = parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)']);
  const data = encodeFunctionData({ abi, functionName: 'getSlot0', args: [await poolId(key)] });
  const [sqrtPriceX96, tick] = decodeFunctionResult({ abi, functionName: 'getSlot0', data: await ethCall(STATE_VIEW, data) });
  return { sqrtPriceX96, tick };
}

/**
 * RUNNER's price in ETH from the two live pools: RUNNER/IMD (our hook pool) and IMD/ETH.
 * Returns the sqrtPriceX96 of the ETH/RUNNER pool (token1 RUNNER per token0 ETH).
 */
export async function impliedSqrtPrice() {
  const hookKey = BigInt(TOKEN_CONTRACT) < BigInt(IMD_TOKEN)
    ? { currency0: TOKEN_CONTRACT, currency1: IMD_TOKEN, fee: 0, tickSpacing: 200, hooks: HOOK_CONTRACT }
    : { currency0: IMD_TOKEN, currency1: TOKEN_CONTRACT, fee: 0, tickSpacing: 200, hooks: HOOK_CONTRACT };
  const imdEthKey = { currency0: ZERO, currency1: IMD_TOKEN, fee: IMD_ETH_POOL.fee, tickSpacing: IMD_ETH_POOL.tickSpacing, hooks: IMD_ETH_POOL.hooks };
  const [h, e] = await Promise.all([slot0(hookKey), slot0(imdEthKey)]);
  if (!h.sqrtPriceX96 || !e.sqrtPriceX96) throw new Error('The RUNNER/IMD or IMD/ETH pool has no price yet.');
  // sqrt(IMD per ETH) / sqrt(IMD per RUNNER) = sqrt(RUNNER per ETH). If RUNNER is currency1 of the hook
  // pool, its sqrt price is already sqrt(RUNNER per IMD).
  const sqrtImdPerRunner = hookKey.currency0 === TOKEN_CONTRACT ? h.sqrtPriceX96 : (Q96 * Q96) / h.sqrtPriceX96;
  return (e.sqrtPriceX96 * Q96) / sqrtImdPerRunner;
}

// ---------------------------------------------------------------- v4 math (TickMath / LiquidityAmounts)
const MAX_UINT256 = (1n << 256n) - 1n;
const TICK_FACTORS = [
  [0x2n, 0xfff97272373d413259a46990580e213an], [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn], [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n], [0x20n, 0xff973b41fa98c081472e6896dfb254c0n], [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n], [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n], [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n], [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n], [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n], [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n], [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n], [0x20000n, 0x5d6af8dedb81196699c329225ee604n], [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

/** TickMath.getSqrtPriceAtTick, ported exactly. */
export function sqrtPriceAtTick(tick) {
  const abs = BigInt(tick < 0 ? -tick : tick);
  if (abs > 887272n) throw new Error('tick out of range');
  let price = abs & 1n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 1n << 128n;
  for (const [bit, f] of TICK_FACTORS) if (abs & bit) price = (price * f) >> 128n;
  if (tick > 0) price = MAX_UINT256 / price;
  return (price >> 32n) + (price % (1n << 32n) === 0n ? 0n : 1n);
}

const divUp = (a, b) => (a % b === 0n ? a / b : a / b + 1n);

/**
 * Full-range position for `runnerWei` RUNNER at `sqrtP`: the liquidity and the ETH it needs
 * (rounded up, as the PoolManager charges).
 */
export function fullRangeQuote(runnerWei, sqrtP) {
  const sa = sqrtPriceAtTick(FULL_RANGE.lower), sb = sqrtPriceAtTick(FULL_RANGE.upper);
  if (sqrtP <= sa || sqrtP >= sb) throw new Error('price outside the full range');
  const liquidity = (runnerWei * Q96) / (sqrtP - sa); // LiquidityAmounts.getLiquidityForAmount1
  const ethWei = divUp(divUp(liquidity * Q96 * (sb - sqrtP), sb), sqrtP); // SqrtPriceMath.getAmount0Delta, round up
  const runnerNeeded = divUp(liquidity * (sqrtP - sa), Q96); // SqrtPriceMath.getAmount1Delta, round up
  return { liquidity, ethWei, runnerNeeded };
}

/** RUNNER per ETH at a sqrt price (both 18 decimals), as a Number for display. */
export const runnerPerEth = (sqrtP) => Number((sqrtP * sqrtP * 10n ** 6n) / (Q96 * Q96)) / 1e6;

// ---------------------------------------------------------------- state & transactions
/** Pool status and the wallet's balances/approvals. */
export async function status(owner) {
  const { encodeFunctionData, decodeFunctionResult, parseAbi } = await viem();
  const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)']);
  const permit2 = parseAbi(['function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)']);
  const call = async (to, abi, fn, args) => decodeFunctionResult({ abi, functionName: fn, data: await ethCall(to, encodeFunctionData({ abi, functionName: fn, args })) });
  const [pool, implied, runner, toPermit2, p2, eth] = await Promise.all([
    slot0(ethPoolKey()),
    impliedSqrtPrice(),
    owner ? call(TOKEN_CONTRACT, erc20, 'balanceOf', [owner]) : 0n,
    owner ? call(TOKEN_CONTRACT, erc20, 'allowance', [owner, PERMIT2]) : 0n,
    owner ? call(PERMIT2, permit2, 'allowance', [owner, TOKEN_CONTRACT, POSITION_MANAGER]) : [0n, 0, 0],
    owner ? ethBalance(owner) : 0n,
  ]);
  return {
    created: pool.sqrtPriceX96 > 0n, poolSqrtPrice: pool.sqrtPriceX96, impliedSqrtPrice: implied,
    runner, eth, runnerToPermit2: toPermit2, permit2Amount: p2[0], permit2Expiration: Number(p2[1]),
  };
}

/** How far (in %) the existing pool's price is from the price implied by the two live pools. */
export const priceGapPct = (s) => (s.created ? Math.abs(runnerPerEth(s.poolSqrtPrice) / runnerPerEth(s.impliedSqrtPrice) - 1) * 100 : 0);

/** RUNNER.approve(Permit2, max). */
export async function approvePermit2Tx() {
  const { encodeFunctionData, parseAbi, maxUint256 } = await viem();
  return { to: TOKEN_CONTRACT, data: encodeFunctionData({ abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [PERMIT2, maxUint256] }) };
}

/** Permit2.approve(RUNNER, PositionManager, amount, 30 days). */
export async function approvePositionManagerTx(amount) {
  const { encodeFunctionData, parseAbi } = await viem();
  const max160 = (1n << 160n) - 1n;
  return {
    to: PERMIT2,
    data: encodeFunctionData({ abi: parseAbi(['function approve(address token, address spender, uint160 amount, uint48 expiration)']), functionName: 'approve', args: [TOKEN_CONTRACT, POSITION_MANAGER, amount > max160 ? max160 : amount, Math.floor(Date.now() / 1000) + 30 * 86400] }),
  };
}

/**
 * One PositionManager.multicall: create the pool at `sqrtP` (unless it exists) and mint a full-range
 * position owned by `owner`. Sends `ethMax` ETH; whatever isn't used is swept back to `owner`.
 */
export async function mintTx({ owner, runnerWei, sqrtP, create, slippageBps = 100 }) {
  const { encodeFunctionData, encodeAbiParameters, parseAbiParameters, parseAbi, encodePacked } = await viem();
  const key = ethPoolKey();
  const q = fullRangeQuote(runnerWei, sqrtP);
  const ethMax = q.ethWei + (q.ethWei * BigInt(slippageBps)) / 10_000n + 1n;
  const runnerMax = q.runnerNeeded + (q.runnerNeeded * BigInt(slippageBps)) / 10_000n + 1n;
  const actions = encodePacked(['uint8', 'uint8', 'uint8'], [0x02, 0x0d, 0x14]); // MINT_POSITION, SETTLE_PAIR, SWEEP
  const params = [
    encodeAbiParameters(parseAbiParameters(`${KEY_TYPE}, int24, int24, uint256, uint128, uint128, address, bytes`),
      [key, FULL_RANGE.lower, FULL_RANGE.upper, q.liquidity, ethMax, runnerMax, owner, '0x']),
    encodeAbiParameters(parseAbiParameters('address, address'), [key.currency0, key.currency1]),
    encodeAbiParameters(parseAbiParameters('address, address'), [ZERO, owner]), // return unused ETH
  ];
  const abi = parseAbi([
    `function initializePool(${KEY_TYPE} key, uint160 sqrtPriceX96) payable returns (int24)`,
    'function modifyLiquidities(bytes unlockData, uint256 deadline) payable',
    'function multicall(bytes[] data) payable returns (bytes[])',
  ]);
  const calls = [];
  if (create) calls.push(encodeFunctionData({ abi, functionName: 'initializePool', args: [key, sqrtP] }));
  calls.push(encodeFunctionData({ abi, functionName: 'modifyLiquidities', args: [encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [actions, params]), BigInt(Math.floor(Date.now() / 1000) + 1800)] }));
  return { to: POSITION_MANAGER, data: encodeFunctionData({ abi, functionName: 'multicall', args: [calls] }), value: ethMax, quote: q, ethMax, runnerMax };
}

// ---------------------------------------------------------------- RUNNER/IMD pool (10% LP fee, no hook)
// A second RUNNER/IMD pool next to the hook pool: no hook (the RunnerHook refuses any pool but its own),
// 10% fee to whoever provides liquidity. Created at the hook pool's price. Both tokens are ERC-20s, so
// both go through Permit2; no ETH is sent.
export const IMD_POOL_FEE = 100_000; // 10%
const RUNNER_IS_0 = () => BigInt(TOKEN_CONTRACT) < BigInt(IMD_TOKEN);

/** The pool key: RUNNER and IMD sorted by address, 10%, no hook. */
export const imdPoolKey = () => (RUNNER_IS_0()
  ? { currency0: TOKEN_CONTRACT, currency1: IMD_TOKEN, fee: IMD_POOL_FEE, tickSpacing: ETH_POOL_TICK_SPACING, hooks: ZERO }
  : { currency0: IMD_TOKEN, currency1: TOKEN_CONTRACT, fee: IMD_POOL_FEE, tickSpacing: ETH_POOL_TICK_SPACING, hooks: ZERO });
const hookPoolKey = () => (RUNNER_IS_0()
  ? { currency0: TOKEN_CONTRACT, currency1: IMD_TOKEN, fee: 0, tickSpacing: 200, hooks: HOOK_CONTRACT }
  : { currency0: IMD_TOKEN, currency1: TOKEN_CONTRACT, fee: 0, tickSpacing: 200, hooks: HOOK_CONTRACT });

/** IMD per RUNNER at a sqrt price of a RUNNER/IMD pool (same currency order as both keys above). */
export const imdPerRunner = (sqrtP) => {
  const p = Number((sqrtP * sqrtP * 10n ** 12n) / (Q96 * Q96)) / 1e12; // token1 per token0
  return RUNNER_IS_0() ? p : 1 / p;
};

/** Full-range position for `runnerWei` RUNNER at `sqrtP`: liquidity, IMD needed and RUNNER needed (rounded up). */
export function imdFullRangeQuote(runnerWei, sqrtP) {
  const sa = sqrtPriceAtTick(FULL_RANGE.lower), sb = sqrtPriceAtTick(FULL_RANGE.upper);
  if (sqrtP <= sa || sqrtP >= sb) throw new Error('price outside the full range');
  const amount0 = (L) => divUp(divUp(L * Q96 * (sb - sqrtP), sb), sqrtP); // SqrtPriceMath.getAmount0Delta, round up
  const amount1 = (L) => divUp(L * (sqrtP - sa), Q96);                     // SqrtPriceMath.getAmount1Delta, round up
  if (RUNNER_IS_0()) {
    const liquidity = (runnerWei * sqrtP * sb) / (Q96 * (sb - sqrtP)); // LiquidityAmounts.getLiquidityForAmount0
    return { liquidity, runnerNeeded: amount0(liquidity), imdWei: amount1(liquidity) };
  }
  const liquidity = (runnerWei * Q96) / (sqrtP - sa); // LiquidityAmounts.getLiquidityForAmount1
  return { liquidity, runnerNeeded: amount1(liquidity), imdWei: amount0(liquidity) };
}

/** Pool status, the hook pool's price, and the wallet's balances and approvals for both tokens. */
export async function imdStatus(owner) {
  const { encodeFunctionData, decodeFunctionResult, parseAbi } = await viem();
  const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)']);
  const permit2 = parseAbi(['function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)']);
  const call = async (to, abi, fn, args) => decodeFunctionResult({ abi, functionName: fn, data: await ethCall(to, encodeFunctionData({ abi, functionName: fn, args })) });
  const token = async (addr) => {
    if (!owner) return { balance: 0n, toPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0 };
    const [balance, toPermit2, p2] = await Promise.all([
      call(addr, erc20, 'balanceOf', [owner]), call(addr, erc20, 'allowance', [owner, PERMIT2]), call(PERMIT2, permit2, 'allowance', [owner, addr, POSITION_MANAGER]),
    ]);
    return { balance, toPermit2, permit2Amount: p2[0], permit2Expiration: Number(p2[1]) };
  };
  const [pool, hook, runner, imd] = await Promise.all([slot0(imdPoolKey()), slot0(hookPoolKey()), token(TOKEN_CONTRACT), token(IMD_TOKEN)]);
  if (!hook.sqrtPriceX96) throw new Error('The RUNNER/IMD hook pool has no price yet.');
  return { created: pool.sqrtPriceX96 > 0n, poolSqrtPrice: pool.sqrtPriceX96, hookSqrtPrice: hook.sqrtPriceX96, runner, imd };
}

/** How far (in %) the 10% pool's price is from the hook pool's. */
export const imdPriceGapPct = (s) => (s.created ? Math.abs(imdPerRunner(s.poolSqrtPrice) / imdPerRunner(s.hookSqrtPrice) - 1) * 100 : 0);

/** token.approve(Permit2, max). */
export async function approveTokenToPermit2Tx(token) {
  const { encodeFunctionData, parseAbi, maxUint256 } = await viem();
  return { to: token, data: encodeFunctionData({ abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [PERMIT2, maxUint256] }) };
}

/** Permit2.approve(token, PositionManager, amount, 30 days). */
export async function approveTokenToPositionManagerTx(token, amount) {
  const { encodeFunctionData, parseAbi } = await viem();
  const max160 = (1n << 160n) - 1n;
  return {
    to: PERMIT2,
    data: encodeFunctionData({ abi: parseAbi(['function approve(address token, address spender, uint160 amount, uint48 expiration)']), functionName: 'approve', args: [token, POSITION_MANAGER, amount > max160 ? max160 : amount, Math.floor(Date.now() / 1000) + 30 * 86400] }),
  };
}

/** One PositionManager.multicall: create the 10% pool at `sqrtP` (unless it exists) and mint a full-range position for `owner`. */
export async function imdMintTx({ owner, runnerWei, sqrtP, create, slippageBps = 100 }) {
  const { encodeFunctionData, encodeAbiParameters, parseAbiParameters, parseAbi, encodePacked } = await viem();
  const key = imdPoolKey();
  const q = imdFullRangeQuote(runnerWei, sqrtP);
  const pad = (x) => x + (x * BigInt(slippageBps)) / 10_000n + 1n;
  const runnerMax = pad(q.runnerNeeded), imdMax = pad(q.imdWei);
  const [max0, max1] = RUNNER_IS_0() ? [runnerMax, imdMax] : [imdMax, runnerMax];
  const actions = encodePacked(['uint8', 'uint8'], [0x02, 0x0d]); // MINT_POSITION, SETTLE_PAIR
  const params = [
    encodeAbiParameters(parseAbiParameters(`${KEY_TYPE}, int24, int24, uint256, uint128, uint128, address, bytes`),
      [key, FULL_RANGE.lower, FULL_RANGE.upper, q.liquidity, max0, max1, owner, '0x']),
    encodeAbiParameters(parseAbiParameters('address, address'), [key.currency0, key.currency1]),
  ];
  const abi = parseAbi([
    `function initializePool(${KEY_TYPE} key, uint160 sqrtPriceX96) payable returns (int24)`,
    'function modifyLiquidities(bytes unlockData, uint256 deadline) payable',
    'function multicall(bytes[] data) payable returns (bytes[])',
  ]);
  const calls = [];
  if (create) calls.push(encodeFunctionData({ abi, functionName: 'initializePool', args: [key, sqrtP] }));
  calls.push(encodeFunctionData({ abi, functionName: 'modifyLiquidities', args: [encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [actions, params]), BigInt(Math.floor(Date.now() / 1000) + 1800)] }));
  return { to: POSITION_MANAGER, data: encodeFunctionData({ abi, functionName: 'multicall', args: [calls] }), value: 0n, quote: q, runnerMax, imdMax };
}
