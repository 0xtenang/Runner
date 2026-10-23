// RunnerToken tests: supply, run-reward claims, 4% trading tax, daily holder rewards
// (300,000 minimum held all day, 7-day claim window, expiry to protocol), plus a
// randomized test that checks the contract's bookkeeping against an independent model.
// Run: cd tests && npm install && node token.test.mjs
import { secp256k1 } from '@noble/curves/secp256k1';
import { compile, readContract, iface, chain, u, errSel, word, addrWord, keccakHex, toHex } from './evm.mjs';
import { emissionOn as jsEmissionOn } from '../js/rules.js';

const E18 = 10n ** 18n;
const DAY = 86400;
const DEV = '0x0f397e46e4e810313dbc782cdb0236347157f1b4';
const TEAM = '0x0f4fe718eb8492533e600b30f3287e2f04087332';
const DEPLOYER = '0x1111111111111111111111111111111111111111';
const W = (n) => `0x${(0xa0 + n).toString(16).padStart(2, '0').repeat(20)}`; // test wallets
const ZERO = '0x0000000000000000000000000000000000000000';

const MOCKS = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
interface IT { function transfer(address,uint256) external returns (bool); }
contract MockPair {
  address public token0; address public token1;
  constructor(address t, bool second) { if (second) { token1 = t; token0 = address(1); } else { token0 = t; token1 = address(1); } }
  function send(address t, address to, uint256 a) external { IT(t).transfer(to, a); }
}
contract MockSmartWallet { function send(address t, address to, uint256 a) external { IT(t).transfer(to, a); } }
contract MockOtherPool { address public token0 = address(2); address public token1 = address(3); }`;

const { contracts, warnings } = compile({ 'RunnerToken.sol': readContract('RunnerToken.sol'), 'Mocks.sol': MOCKS });
const T = iface(contracts['RunnerToken.sol'].RunnerToken);
const P = iface(contracts['Mocks.sol'].MockPair);
const SW = iface(contracts['Mocks.sol'].MockSmartWallet);
const OP = iface(contracts['Mocks.sol'].MockOtherPool);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`); } };
const reverts = (r, name) => !r.ok && r.error === errSel(name);

async function setup() {
  const c = await chain();
  c.setTime(20_500 * DAY + 3600); // 01:00 UTC on day 20500
  const d = await c.send(DEPLOYER, null, T.ctor(DEV, DEV, TEAM));
  if (!d.ok) throw new Error('deploy failed');
  const tok = d.created;
  const call = (from, name, ...args) => c.send(from, tok, T.data(name, ...args));
  const view = async (name, ...args) => c.view(tok, T.data(name, ...args));
  const bal = async (a) => u(await view('balanceOf', a));
  let pairs = 0;
  const newPair = async () => (await c.send(DEPLOYER, null, P.ctor(tok, pairs++ % 2 === 1))).created;
  const buy = (pair, to, amt) => c.send(DEPLOYER, pair, P.data('send', tok, to, amt));
  const today = async () => Number(u(await view('currentDay')));
  return { c, tok, call, view, bal, newPair, buy, today };
}

// =================================================================== basics
{
  const { c, tok, call, view, bal } = await setup();
  ok('compiles without warnings', warnings.length === 0, warnings.join('\n'));
  ok('supply 1B', u(await view('totalSupply')) === 1_000_000_000n * E18);
  ok('pool 800M in contract', await bal(tok) === 800_000_000n * E18 && u(await view('rewardsRemaining')) === 800_000_000n * E18);
  ok('dev 100M', await bal(DEV) === 100_000_000n * E18);
  ok('team 100M', await bal(TEAM) === 100_000_000n * E18);
  ok('deployer nothing', await bal(DEPLOYER) === 0n);
  ok('owner + protocol wallet = dev', u(await view('owner')) === BigInt(DEV) && u(await view('protocolWallet')) === BigInt(DEV));
  ok('tax constants 2% + 2%', u(await view('PROTOCOL_TAX_BPS')) === 200n && u(await view('HOLDER_TAX_BPS')) === 200n);
  ok('min holding 300,000', u(await view('MIN_HOLDING')) === 300_000n * E18);
  ok('every state-changing function is accounted for (none change tax, mint, or take pooled funds)', JSON.stringify(T.writes) === JSON.stringify(['addPair', 'approve', 'burn', 'burnFrom', 'claim', 'claimHolderRewards', 'setClaimsPaused', 'setProtocolWallet', 'setSigner', 'startEmission', 'sweepExpired', 'transfer', 'transferFrom', 'transferOwnership']), T.writes.join(' '));
  ok('contract excluded from holder rewards', u(await view('excludedFromHolderRewards', tok)) === 1n);
  ok('eligible supply = dev + team (200M)', u(await view('eligibleSupply')) === 200_000_000n * E18);
  ok('zero team rejected', reverts(await c.send(DEPLOYER, null, T.ctor(DEV, DEV, ZERO)), 'ZeroAddress'));
  ok('zero owner rejected', reverts(await c.send(DEPLOYER, null, T.ctor(ZERO, DEV, TEAM)), 'ZeroAddress'));

  // ERC-20
  ok('wallet transfer untaxed', (await call(TEAM, 'transfer', W(1), 1000n * E18)).ok && await bal(W(1)) === 1000n * E18 && await bal(TEAM) === 100_000_000n * E18 - 1000n * E18);
  ok('over balance', reverts(await call(W(1), 'transfer', W(2), 2000n * E18), 'InsufficientBalance'));
  ok('to zero', reverts(await call(W(1), 'transfer', ZERO, 1n), 'ZeroAddress'));
  await call(W(1), 'approve', W(2), 300n * E18);
  ok('transferFrom', (await call(W(2), 'transferFrom', W(1), W(3), 200n * E18)).ok && u(await view('allowance', W(1), W(2))) === 100n * E18);
  ok('transferFrom over allowance', reverts(await call(W(2), 'transferFrom', W(1), W(3), 200n * E18), 'InsufficientAllowance'));
  await call(W(1), 'approve', W(2), (1n << 256n) - 1n);
  await call(W(2), 'transferFrom', W(1), W(3), 1n * E18);
  ok('infinite allowance kept', u(await view('allowance', W(1), W(2))) === (1n << 256n) - 1n);
  const sup = u(await view('totalSupply'));
  ok('burn', (await call(W(3), 'burn', 10n * E18)).ok && u(await view('totalSupply')) === sup - 10n * E18);
  ok('self-transfer keeps balance', (await call(W(3), 'transfer', W(3), 5n * E18)).ok && await bal(W(3)) === 191n * E18);

  // ownership + admin
  ok('non-owner addPair', reverts(await call(W(1), 'addPair', tok), 'NotOwner'));
  ok('addPair rejects wallets (not a contract)', reverts(await call(DEV, 'addPair', W(5)), 'NotAContract'));
  const smart = (await c.send(DEPLOYER, null, SW.ctor())).created;
  ok('addPair rejects smart-contract wallets (not a RUNNER pool)', reverts(await call(DEV, 'addPair', smart), 'NotAPool'));
  const other = (await c.send(DEPLOYER, null, OP.ctor())).created;
  ok('addPair rejects pools of other tokens', reverts(await call(DEV, 'addPair', other), 'NotAPool'));
  ok('no adjustable daily cap exists (schedule is fixed)', !T.selectors.some((x) => /DailyClaimCap/.test(x)));
  ok('non-owner protocol wallet', reverts(await call(W(1), 'setProtocolWallet', W(1)), 'NotOwner'));
  ok('owner sets protocol wallet', (await call(DEV, 'setProtocolWallet', W(9))).ok && u(await view('protocolWallet')) === BigInt(W(9)));
  await call(DEV, 'transferOwnership', W(8));
  ok('old owner locked out', reverts(await call(DEV, 'setSigner', DEV), 'NotOwner'));
  ok('new owner works', (await call(W(8), 'setClaimsPaused', false)).ok);
}

// =================================================================== run-reward claims
{
  const { c, tok, call, view, bal, newPair, buy } = await setup();
  const SKEY = secp256k1.utils.randomPrivateKey();
  const SIGNER = `0x${keccakHex(secp256k1.getPublicKey(SKEY, false).slice(1)).slice(24)}`;
  const domain = keccakHex(Buffer.from(keccakHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)') + keccakHex('RUNNER') + keccakHex('1') + word(4663) + addrWord(tok), 'hex'));
  const sign = (key, account, total, deadline) => {
    const struct = keccakHex(Buffer.from(keccakHex('Claim(address account,uint256 totalEarned,uint256 deadline)') + addrWord(account) + word(total) + word(deadline), 'hex'));
    const s = secp256k1.sign(Buffer.from(keccakHex(Buffer.from(`1901${domain}${struct}`, 'hex')), 'hex'), key);
    return { v: 27 + s.recovery, r: `0x${s.r.toString(16).padStart(64, '0')}`, s: `0x${s.s.toString(16).padStart(64, '0')}` };
  };
  const claim = (from, account, total, deadline, sg) => call(from, 'claim', account, total, deadline, sg.v, sg.r, sg.s);
  const dl = () => c.now + 3600n;
  ok('domain separator matches', (await view('domainSeparator')).slice(2) === domain);
  let sg = sign(SKEY, W(1), 100n * E18, dl());
  ok('only owner sets signer', reverts(await call(W(1), 'setSigner', W(1)), 'NotOwner'));
  await call(DEV, 'setSigner', SIGNER);
  ok('claims blocked before emission starts', reverts(await claim(W(1), W(1), 100n * E18, dl(), sg), 'EmissionNotStarted'));
  ok('emission 0 before start', u(await view('emissionOn', 20_500)) === 0n);
  ok('only owner starts emission', reverts(await call(W(1), 'startEmission'), 'NotOwner'));
  ok('owner starts emission', (await call(DEV, 'startEmission')).ok);
  ok('emission starts only once', reverts(await call(DEV, 'startEmission'), 'AlreadyStarted'));
  const start = Number(u(await view('emissionStartDay')));
  ok('start day = today', start === 20_500);
  const em = async (d) => u(await view('emissionOn', d)) / E18;
  ok('10M/day for the first 30 days', await em(start) === 10_000_000n && await em(start + 29) === 10_000_000n);
  ok('halves on day 30 and 60', await em(start + 30) === 5_000_000n && await em(start + 60) === 2_500_000n);
  ok('floor 100k after the 7th halving', await em(start + 180) === 156_250n && await em(start + 210) === 100_000n && await em(start + 100_000) === 100_000n);
  let mirror = true;
  for (let d = start - 3; d < start + 400; d++) if (Number(await em(d)) !== Math.floor(jsEmissionOn(d, start))) mirror = false;
  ok('app/server schedule (js/rules.js) matches the contract for 400 days', mirror);
  const today0 = await view('emissionToday');
  await call(DEV, 'setSigner', ZERO);
  ok('no signer → rejected', reverts(await claim(W(1), W(1), 100n * E18, dl(), sg), 'BadSignature'));
  await call(DEV, 'setSigner', SIGNER);
  ok('emissionToday: full limit unused', u(today0, 0) === 10_000_000n * E18 && u(today0, 1) === 10_000_000n * E18);
  const r = await claim(W(7), W(1), 100n * E18, dl(), sg);
  ok('claim pays runner (submitted by anyone), untaxed', r.ok && await bal(W(1)) === 100n * E18 && await bal(W(7)) === 0n, `gas ${r.gas}`);
  ok('replay', reverts(await claim(W(1), W(1), 100n * E18, dl(), sg), 'NothingToClaim'));
  sg = sign(SKEY, W(1), 250n * E18, dl());
  ok('cumulative difference', (await claim(W(1), W(1), 250n * E18, dl(), sg)).ok && await bal(W(1)) === 250n * E18);
  sg = sign(SKEY, W(1), 300n * E18, dl());
  ok('tampered amount', reverts(await claim(W(1), W(1), 999n * E18, dl(), sg), 'BadSignature'));
  ok('other account', reverts(await claim(W(2), W(2), 300n * E18, dl(), sg), 'BadSignature'));
  ok('wrong key', reverts(await claim(W(1), W(1), 300n * E18, dl(), sign(secp256k1.utils.randomPrivateKey(), W(1), 300n * E18, dl())), 'BadSignature'));
  const N = secp256k1.CURVE.n;
  ok('high-s', reverts(await claim(W(1), W(1), 300n * E18, dl(), { v: sg.v === 27 ? 28 : 27, r: sg.r, s: `0x${(N - BigInt(sg.s)).toString(16).padStart(64, '0')}` }), 'BadSignature'));
  const past = c.now - 1n;
  ok('expired', reverts(await claim(W(1), W(1), 300n * E18, past, sign(SKEY, W(1), 300n * E18, past)), 'Expired'));
  await call(DEV, 'setClaimsPaused', true);
  ok('paused', reverts(await claim(W(1), W(1), 300n * E18, dl(), sg), 'ClaimsPaused'));
  await call(DEV, 'setClaimsPaused', false);
  const bigTotal = 250n * E18 + 10_000_000n * E18; // more than today's 10M emission
  ok('claim over today\'s emission rejected', reverts(await claim(W(1), W(1), bigTotal, dl(), sign(SKEY, W(1), bigTotal, dl())), 'DailyCapReached'));
  const t1 = await view('emissionToday');
  ok('emissionToday counts claims', u(t1, 1) === 10_000_000n * E18 - 250n * E18);
  c.addTime(31 * DAY);
  ok('after the halving, 5M/day: 5M+1 rejected, 5M ok', reverts(await claim(W(1), W(1), 250n * E18 + 5_000_001n * E18, c.now + 3600n, sign(SKEY, W(1), 250n * E18 + 5_000_001n * E18, c.now + 3600n)), 'DailyCapReached')
    && (await claim(W(1), W(1), 250n * E18 + 5_000_000n * E18, c.now + 3600n, sign(SKEY, W(1), 250n * E18 + 5_000_000n * E18, c.now + 3600n))).ok);
  // pool never counts holder tax: create holder tax, then try to claim more than the pool
  const pair = await newPair();
  await call(DEV, 'transfer', pair, 10_000_000n * E18);
  await call(DEV, 'addPair', pair);
  await buy(pair, W(2), 1_000_000n * E18);
  const held = u(await view('holderRewardsHeld'));
  ok('holder tax kept apart from the run pool', held === 20_000n * E18 && u(await view('rewardsRemaining')) === await bal(tok) - held);
}

// =================================================================== tax
{
  const { c, tok, call, view, bal, newPair, buy, today } = await setup();
  const pair = await newPair();
  ok('liquidity can be added before the pool is registered (untaxed)', (await call(DEV, 'transfer', pair, 50_000_000n * E18)).ok && await bal(pair) === 50_000_000n * E18);
  const before = await bal(pair);
  await call(DEV, 'addPair', pair);
  ok('pair registered + excluded', u(await view('isPair', pair)) === 1n && u(await view('excludedFromHolderRewards', pair)) === 1n);
  ok('pair can\'t be added twice', reverts(await call(DEV, 'addPair', pair), 'AlreadyPair'));
  ok('pair gets no holder share', u(await view('eligibleBalanceOn', pair, await today())) === 0n);
  ok('eligible supply dropped by the pair\'s balance', u(await view('eligibleSupply')) === 150_000_000n * E18);
  const devBefore = await bal(DEV);
  await buy(pair, W(1), 1_000_000n * E18);
  ok('buy: buyer gets 96%', await bal(W(1)) === 960_000n * E18);
  ok('buy: protocol gets 2%', await bal(DEV) - devBefore === 20_000n * E18);
  ok('buy: holders get 2%', u(await view('holderRewardsHeld')) === 20_000n * E18);
  ok('pair paid the full amount', before - await bal(pair) === 1_000_000n * E18);
  await call(W(1), 'transfer', pair, 100_000n * E18);
  ok('sell: pair receives 96%', await bal(pair) === before - 1_000_000n * E18 + 96_000n * E18);
  ok('sell: tax split', u(await view('holderRewardsHeld')) === 22_000n * E18 && await bal(DEV) - devBefore === 22_000n * E18);
  await call(W(1), 'approve', W(5), 50_000n * E18);
  await call(W(5), 'transferFrom', W(1), pair, 50_000n * E18);
  ok('router-style sell (transferFrom) taxed', u(await view('holderRewardsHeld')) === 23_000n * E18);
  await call(W(1), 'transfer', W(2), 10_000n * E18);
  ok('wallet → wallet still untaxed', await bal(W(2)) === 10_000n * E18);
  const [, rewards] = [0, u(await view('dayInfo', await today()), 1)];
  ok('day rewards recorded', rewards === 23_000n * E18);
  // tiny amounts: tax rounds down, never reverts
  await call(W(1), 'transfer', pair, 49n);
  ok('dust trade ok (tax rounds to 0)', u(await view('holderRewardsHeld')) === 23_000n * E18);
}

// =================================================================== holder rewards
{
  const { c, tok, call, view, bal, newPair, buy, today } = await setup();
  const pair = await newPair();
  await call(DEV, 'transfer', pair, 50_000_000n * E18);
  await call(DEV, 'addPair', pair);
  // Day 0: give A 1,000,000, B 500,000, C 200,000 (below minimum)
  const A = W(1), B = W(2), C = W(3), D = W(4);
  await call(TEAM, 'transfer', A, 1_000_000n * E18);
  await call(TEAM, 'transfer', B, 500_000n * E18);
  await call(TEAM, 'transfer', C, 200_000n * E18);
  const day0 = await today();
  ok('received today → not eligible today', u(await view('eligibleBalanceOn', A, day0)) === 0n);
  c.addTime(DAY); // day 1: A, B, C held all day
  const day1 = await today();
  // trading on day 1 creates holder rewards
  await buy(pair, D, 10_000_000n * E18); // D buys mid-day → not eligible for day 1
  await call(B, 'transfer', W(6), 100_000n * E18); // B drops to 400k → share 400k
  await call(B, 'transfer', B, 0n);
  const [shares, rewards] = [u(await view('dayInfo', day1), 0), u(await view('dayInfo', day1), 1)];
  // eligible today: DEV (100M - 50M lp + 200k tax so far but min = start balance), TEAM (start balance), A 1M, B min 400k
  const devStart = 50_000_000n * E18;            // dev after LP; tax received today doesn't raise the day's min
  const teamStart = 100_000_000n * E18 - 1_700_000n * E18;
  const expectShares = devStart + teamStart + 1_000_000n * E18 + 400_000n * E18;
  ok('day shares = lowest balances of eligible wallets', shares === expectShares, `${shares} vs ${expectShares}`);
  ok('day rewards = 2% of buy', rewards === 200_000n * E18);
  ok('A counts 1M', u(await view('eligibleBalanceOn', A, day1)) === 1_000_000n * E18);
  ok('B counts its lowest (400k)', u(await view('eligibleBalanceOn', B, day1)) === 400_000n * E18);
  ok('C under 300k → 0', u(await view('eligibleBalanceOn', C, day1)) === 0n);
  ok('D bought today → 0', u(await view('eligibleBalanceOn', D, day1)) === 0n);
  ok('nothing claimable during the day itself', u(await view('holderClaimable', A)) === 0n && reverts(await call(A, 'claimHolderRewards'), 'NothingToClaim'));
  c.addTime(DAY); // day 2
  const expA = rewards * 1_000_000n * E18 / expectShares;
  ok('A claimable next day', u(await view('holderClaimable', A)) === expA, `${u(await view('holderClaimable', A))} vs ${expA}`);
  const aBefore = await bal(A);
  ok('A claims', (await call(A, 'claimHolderRewards')).ok && await bal(A) - aBefore === expA);
  ok('A can\'t claim twice', reverts(await call(A, 'claimHolderRewards'), 'NothingToClaim'));
  ok('C nothing', reverts(await call(C, 'claimHolderRewards'), 'NothingToClaim'));
  ok('D eligible from day 2 (held all day)', u(await view('eligibleBalanceOn', D, await today())) === 9_600_000n * E18);
  // B waits until the last day of the window (day1 + 7 = day 8)
  c.setTime((day1 + 7) * DAY + 80000);
  const expB = rewards * 400_000n * E18 / expectShares;
  ok('B still claimable on day 7 after', u(await view('holderClaimable', B)) === expB);
  ok('expired days not sweepable yet', u(await view('nextSweepDay')) === BigInt(day0) && (await call(W(9), 'sweepExpired', 30)).ok && u(await view('dayInfo', day1), 2) === expA);
  c.setTime((day1 + 8) * DAY + 10);
  ok('after 7 days B can no longer claim', u(await view('holderClaimable', B)) === 0n && reverts(await call(B, 'claimHolderRewards'), 'NothingToClaim'));
  const devBefore = await bal(DEV);
  const left = rewards - expA;
  const sw = await call(W(9), 'sweepExpired', 30);
  ok('anyone sweeps expired rewards to protocol', sw.ok && await bal(DEV) - devBefore === left, `${await bal(DEV) - devBefore} vs ${left}`);
  ok('holder bucket empty after sweep', u(await view('holderRewardsHeld')) === 0n);
  ok('sweep is idempotent', (await call(W(9), 'sweepExpired', 30)).ok && await bal(DEV) - devBefore === left);
  ok('sweep progress saved', u(await view('nextSweepDay')) === BigInt(day1 + 1));
}

// =================================================================== randomized model check
{
  const { c, tok, call, view, bal, newPair, buy, today } = await setup();
  const MIN = 300_000n * E18;
  let seed = 0x5eed1234;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const holders = [DEV, TEAM, W(1), W(2), W(3), W(4), W(5), W(6)];
  const pairs = [await newPair(), await newPair()];
  const m = { bal: new Map(), dayMin: new Map(), rewards: new Map(), paid: new Map(), claimed: new Set(), excluded: new Set([tok.toLowerCase()]), day: await today(), held: 0n };
  const B = (a) => m.bal.get(a.toLowerCase()) || 0n;
  const setB = (a, v) => {
    a = a.toLowerCase(); m.bal.set(a, v);
    const dm = m.dayMin.get(m.day); if (dm.has(a)) dm.set(a, v < dm.get(a) ? v : dm.get(a)); else dm.set(a, v);
  };
  const enterDay = (d) => {
    while (m.day < d) { m.day++; m.dayMin.set(m.day, new Map([...m.bal].map(([k, v]) => [k, v]))); }
  };
  m.dayMin.set(m.day, new Map());
  for (const a of [tok, DEV, TEAM, ...pairs, ...holders]) m.bal.set(a.toLowerCase(), await bal(a));
  for (const [k, v] of m.bal) m.dayMin.get(m.day).set(k, 0n); // minted today: lowest balance today was 0
  const elig = (a, d) => {
    a = a.toLowerCase();
    if (m.excluded.has(a)) return 0n;
    const v = m.dayMin.get(d)?.get(a) ?? 0n;
    return v >= MIN ? v : 0n;
  };
  const move = (from, to, amt) => { setB(from, B(from) - amt); setB(to, B(to) + amt); };
  // LP + pairs (before registering → untaxed)
  for (const p of pairs) { await call(DEV, 'transfer', p, 20_000_000n * E18); move(DEV, p, 20_000_000n * E18); await call(DEV, 'addPair', p); m.excluded.add(p.toLowerCase()); }
  for (const h of holders.slice(2)) { const a = BigInt(Math.floor(rnd() * 1_500_000)) * E18; await call(TEAM, 'transfer', h, a); move(TEAM, h, a); }

  let steps = 0, checks = 0, claims = 0, sweeps = 0, taxed = 0;
  const check = async (label) => {
    const d = await today();
    let sumB = 0n;
    for (const a of new Set([tok, ...pairs, ...holders])) {
      const cb = await bal(a);
      if (cb !== B(a)) throw new Error(`${label}: balance ${a} ${cb} != model ${B(a)}`);
      sumB += cb;
    }
    if (sumB !== u(await view('totalSupply'))) throw new Error(`${label}: supply mismatch`);
    for (const dd of [d, d - 1, d - 3].filter((x) => m.dayMin.has(x))) {
      let s = 0n;
      for (const h of holders) {
        const ce = u(await view('eligibleBalanceOn', h, dd));
        if (ce !== elig(h, dd)) throw new Error(`${label}: eligible ${h} day ${dd} ${ce} != ${elig(h, dd)}`);
        s += ce;
      }
      const info = await view('dayInfo', dd);
      if (u(info, 0) !== s && (u(info, 0) > 0n || (m.rewards.get(dd) || 0n) > 0n)) throw new Error(`${label}: shares day ${dd} ${u(info, 0)} != ${s}`);
      if (u(info, 1) !== (m.rewards.get(dd) || 0n)) throw new Error(`${label}: rewards day ${dd}`);
    }
    if (u(await view('holderRewardsHeld')) !== m.held) throw new Error(`${label}: held ${u(await view('holderRewardsHeld'))} != ${m.held}`);
    if (u(await view('rewardsRemaining')) !== B(tok) - m.held) throw new Error(`${label}: pool`);
    checks++;
  };
  const expectedClaim = (h) => {
    let t = 0n; const list = [];
    for (let dd = Math.max(0, m.day - 7); dd < m.day; dd++) {
      const r = m.rewards.get(dd) || 0n; if (!r || m.claimed.has(`${h}:${dd}`)) continue;
      let s = 0n; for (const x of holders) s += elig(x, dd);
      const e = elig(h, dd); if (!e || !s) continue;
      t += r * e / s; list.push([dd, r * e / s]);
    }
    return { t, list };
  };

  for (; steps < 600; steps++) {
    const roll = rnd();
    if (roll < 0.12) {                     // time passes
      c.addTime(Math.floor(rnd() * 30 * 3600));
      enterDay(await today());
    } else if (roll < 0.35) {               // buy
      const p = pick(pairs), h = pick(holders);
      const amt = BigInt(Math.floor(rnd() * 900_000)) * E18 + BigInt(Math.floor(rnd() * 1e6));
      if (amt > B(p)) continue;
      const r = await buy(p, h, amt); if (!r.ok) throw new Error('buy failed');
      const pc = amt * 200n / 10000n, hc = amt * 200n / 10000n;
      move(p, h, amt - pc - hc); move(p, DEV, pc); move(p, tok, hc);
      m.held += hc; m.rewards.set(m.day, (m.rewards.get(m.day) || 0n) + hc); taxed++;
    } else if (roll < 0.55) {               // sell
      const p = pick(pairs), h = pick(holders);
      const amt = B(h) * BigInt(Math.floor(rnd() * 100)) / 100n; if (!amt) continue;
      const r = await call(h, 'transfer', p, amt); if (!r.ok) throw new Error('sell failed');
      const pc = amt * 200n / 10000n, hc = amt * 200n / 10000n;
      move(h, p, amt - pc - hc); move(h, DEV, pc); move(h, tok, hc);
      m.held += hc; m.rewards.set(m.day, (m.rewards.get(m.day) || 0n) + hc); taxed++;
    } else if (roll < 0.72) {               // wallet transfer
      const a = pick(holders), b = pick(holders);
      const amt = B(a) * BigInt(Math.floor(rnd() * 100)) / 100n;
      const r = await call(a, 'transfer', b, amt); if (!r.ok) throw new Error('transfer failed');
      move(a, b, amt);
    } else if (roll < 0.88) {               // claim holder rewards
      const h = pick(holders);
      const { t, list } = expectedClaim(h);
      const view0 = u(await view('holderClaimable', h));
      if (view0 !== t) throw new Error(`claimable ${h} ${view0} != ${t}`);
      const r = await call(h, 'claimHolderRewards');
      if (!t) { if (r.ok) throw new Error('claim of 0 succeeded'); continue; }
      if (!r.ok) throw new Error('claim failed');
      for (const [dd, a] of list) { m.claimed.add(`${h}:${dd}`); m.paid.set(dd, (m.paid.get(dd) || 0n) + a); }
      move(tok, h, t); m.held -= t; claims++;
    } else if (roll < 0.95) {               // sweep
      const next = Number(u(await view('nextSweepDay')));
      const max = 1 + Math.floor(rnd() * 5);
      let t = 0n, d = next;
      while (d + 7 < m.day && d < next + max) { const left = (m.rewards.get(d) || 0n) - (m.paid.get(d) || 0n); if (left > 0n) { t += left; m.paid.set(d, m.rewards.get(d)); } d++; }
      const r = await call(W(9), 'sweepExpired', max); if (!r.ok) throw new Error('sweep failed');
      if (t) { move(tok, DEV, t); m.held -= t; sweeps++; }
    } else {                                 // burn
      const h = pick(holders); const amt = B(h) / 10n;
      const r = await call(h, 'burn', amt); if (!r.ok) throw new Error('burn failed');
      setB(h, B(h) - amt);
    }
    if (steps % 5 === 0) await check(`step ${steps}`);
  }
  await check('final');
  console.log(`randomized: ${steps} steps over ${m.dayMin.size} days, ${taxed} taxed trades, ${claims} holder claims, ${sweeps} sweeps, ${checks} full bookkeeping checks — all matched`);
  ok('randomized model check', true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
