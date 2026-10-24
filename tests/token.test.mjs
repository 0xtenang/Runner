// RunnerToken tests: supply, no transfer tax, run-reward claims, daily holder rewards paid in
// IMD (300,000 minimum held all day, 7-day claim window, expiry to protocol), plus a randomized
// test that checks the contract's bookkeeping against an independent model. The RunnerHook (the
// RUNNER/IMD Uniswap v4 pool that charges the 4% fee in IMD) is tested with Foundry:
// forge test (see contracts/test). Here the hook is an address and IMD a mock token.
// Run: cd tests && npm install && node token.test.mjs
import { secp256k1 } from '@noble/curves/secp256k1';
import { compile, readContract, iface, chain, u, errSel, word, addrWord, keccakHex, toHex } from './evm.mjs';
import { emissionOn as jsEmissionOn, launchSchedule } from '../js/rules.js';
import { decodeSchedule } from '../api/_lib/chain.js';

const E18 = 10n ** 18n;
const DAY = 86400;
const DEV = '0x0f397e46e4e810313dbc782cdb0236347157f1b4';
const TEAM = '0x0f4fe718eb8492533e600b30f3287e2f04087332';
const HOOK = '0x2222222222222222222222222222222222222222'; // stands in for the RunnerHook
const PM = '0x3333333333333333333333333333333333333333';   // stands in for the Uniswap v4 PoolManager
const DEAD = '0x000000000000000000000000000000000000dead';
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
contract MockOtherPool { address public token0 = address(2); address public token1 = address(3); }
interface IClaim { function claimHolderRewards() external returns (uint256); }
contract ClaimingPool {
  address public token0; address public token1;
  constructor(address t) { token0 = t; token1 = address(1); }
  function claim(address t) external { IClaim(t).claimHolderRewards(); }
}
contract MockIMD {
  mapping(address => uint256) public balanceOf;
  function mint(address to, uint256 a) external { balanceOf[to] += a; }
  function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
}`;

const { contracts, warnings } = compile({ 'RunnerToken.sol': readContract('RunnerToken.sol'), 'Mocks.sol': MOCKS });
const T = iface(contracts['RunnerToken.sol'].RunnerToken);
const P = iface(contracts['Mocks.sol'].MockPair);
const SW = iface(contracts['Mocks.sol'].MockSmartWallet);
const OP = iface(contracts['Mocks.sol'].MockOtherPool);
const I = iface(contracts['Mocks.sol'].MockIMD);
const CP = iface(contracts['Mocks.sol'].ClaimingPool);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`); } };
const reverts = (r, name) => !r.ok && r.error === errSel(name);

async function setup() {
  const c = await chain();
  c.setTime(20_500 * DAY + 3600); // 01:00 UTC on day 20500
  const imd = (await c.send(DEPLOYER, null, I.ctor())).created;
  const d = await c.send(DEPLOYER, null, T.ctor(DEV, HOOK, TEAM, imd, PM));
  if (!d.ok) throw new Error('deploy failed');
  const tok = d.created;
  const call = (from, name, ...args) => c.send(from, tok, T.data(name, ...args));
  const view = async (name, ...args) => c.view(tok, T.data(name, ...args));
  const bal = async (a) => u(await view('balanceOf', a));
  let pairs = 0;
  const newPair = async () => (await c.send(DEPLOYER, null, P.ctor(tok, pairs++ % 2 === 1))).created;
  const buy = (pair, to, amt) => c.send(DEPLOYER, pair, P.data('send', tok, to, amt)); // a pool paying out RUNNER
  const today = async () => Number(u(await view('currentDay')));
  // What the hook does after a trade: send the holder share in IMD, then book it.
  const reward = async (amt) => { await c.send(DEPLOYER, imd, I.data('mint', tok, amt)); return call(W(9), 'syncHolderRewards'); };
  const imdBal = async (a) => u(await c.view(imd, I.data('balanceOf', a)));
  return { c, tok, imd, call, view, bal, newPair, buy, today, reward, imdBal };
}

// =================================================================== basics
{
  const { c, tok, imd, call, view, bal } = await setup();
  ok('compiles without warnings', warnings.length === 0, warnings.join('\n'));
  ok('supply 1B', u(await view('totalSupply')) === 1_000_000_000n * E18);
  ok('pool 800M in contract', await bal(tok) === 800_000_000n * E18 && u(await view('rewardsRemaining')) === 800_000_000n * E18);
  ok('liquidity allocation (100M) goes to the hook, which locks it in the pool', await bal(HOOK) === 100_000_000n * E18);
  ok('team 100M', await bal(TEAM) === 100_000_000n * E18);
  ok('dev and deployer hold nothing', await bal(DEV) === 0n && await bal(DEPLOYER) === 0n);
  ok('owner + protocol wallet = dev', u(await view('owner')) === BigInt(DEV) && u(await view('protocolWallet')) === BigInt(DEV));
  ok('wired to the hook, the pool manager and IMD', u(await view('hook')) === BigInt(HOOK) && u(await view('poolManager')) === BigInt(PM) && u(await view('rewardToken')) === BigInt(imd));
  ok('no tax anywhere in the token', !T.selectors.some((x) => /tax|pair/i.test(x)));
  ok('min holding 300,000', u(await view('MIN_HOLDING')) === 300_000n * E18);
  ok('every state-changing function is accounted for (none mint, tax, or take pooled funds)', JSON.stringify(T.writes) === JSON.stringify(['acceptOwnership', 'approve', 'burn', 'burnFrom', 'claim', 'claimHolderRewards', 'excludePool', 'release', 'releaseEarly', 'setClaimsPaused', 'setEmissionSchedule', 'setProtocolWallet', 'setSigner', 'startEmission', 'sweepExpired', 'syncHolderRewards', 'transfer', 'transferFrom', 'transferOwnership']), T.writes.join(' '));
  ok('contract, hook, pool manager and burn address excluded from holder rewards', [tok, HOOK, PM, DEAD].every(Boolean) && u(await view('excludedFromHolderRewards', tok)) === 1n && u(await view('excludedFromHolderRewards', HOOK)) === 1n && u(await view('excludedFromHolderRewards', PM)) === 1n && u(await view('excludedFromHolderRewards', DEAD)) === 1n);
  ok('eligible supply = team (the hook\'s liquidity is excluded)', u(await view('eligibleSupply')) === 100_000_000n * E18);
  const zeroArgs = [[ZERO, HOOK, TEAM, imd, PM], [DEV, ZERO, TEAM, imd, PM], [DEV, HOOK, ZERO, imd, PM], [DEV, HOOK, TEAM, ZERO, PM], [DEV, HOOK, TEAM, imd, ZERO]];
  let allZero = true;
  for (const a of zeroArgs) if (!reverts(await c.send(DEPLOYER, null, T.ctor(...a)), 'ZeroAddress')) allZero = false;
  ok('zero owner, hook, team, reward token or pool manager rejected', allZero);

  // ERC-20: no transfer tax
  ok('wallet transfer moves the exact amount', (await call(TEAM, 'transfer', W(1), 1000n * E18)).ok && await bal(W(1)) === 1000n * E18 && await bal(TEAM) === 100_000_000n * E18 - 1000n * E18);
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
  ok('the pool manager and hook can move RUNNER like anyone (plain ERC-20 for Uniswap v4)', (await call(HOOK, 'transfer', PM, 1000n * E18)).ok && await bal(PM) === 1000n * E18);

  // ownership + admin
  ok('non-owner excludePool', reverts(await call(W(1), 'excludePool', tok), 'NotOwner'));
  ok('excludePool rejects wallets (not a contract)', reverts(await call(DEV, 'excludePool', W(5)), 'NotAContract'));
  const smart = (await c.send(DEPLOYER, null, SW.ctor())).created;
  ok('excludePool rejects smart-contract wallets (not a RUNNER pool)', reverts(await call(DEV, 'excludePool', smart), 'NotAPool'));
  const other = (await c.send(DEPLOYER, null, OP.ctor())).created;
  ok('excludePool rejects pools of other tokens', reverts(await call(DEV, 'excludePool', other), 'NotAPool'));
  ok('no adjustable daily cap exists (schedule is fixed)', !T.selectors.some((x) => /DailyClaimCap/.test(x)));
  ok('non-owner protocol wallet', reverts(await call(W(1), 'setProtocolWallet', W(1)), 'NotOwner'));
  ok('owner sets protocol wallet', (await call(DEV, 'setProtocolWallet', W(9))).ok && u(await view('protocolWallet')) === BigInt(W(9)));
  // Two-step handover (audit finding 7): a proposal changes nothing until it is accepted.
  ok('only owner proposes a new owner', reverts(await call(W(8), 'transferOwnership', W(8)), 'NotOwner'));
  await call(DEV, 'transferOwnership', W(9));                 // e.g. a mistyped address
  ok('proposal alone changes nothing', (await view('owner')).slice(26) === DEV.slice(2) && (await call(DEV, 'setClaimsPaused', false)).ok);
  ok('nobody else can accept', reverts(await call(W(8), 'acceptOwnership'), 'NotOwner'));
  await call(DEV, 'transferOwnership', W(8));                 // owner corrects the mistake
  ok('replaced proposal can no longer be accepted', reverts(await call(W(9), 'acceptOwnership'), 'NotOwner'));
  ok('proposed owner accepts', (await call(W(8), 'acceptOwnership')).ok && (await view('pendingOwner')).slice(26) === '0'.repeat(40));
  ok('old owner locked out', reverts(await call(DEV, 'setSigner', DEV), 'NotOwner'));
  ok('new owner works', (await call(W(8), 'setClaimsPaused', false)).ok);
}

// =================================================================== run-reward claims
{
  const { c, tok, call, view, bal, reward } = await setup();
  const SKEY = secp256k1.utils.randomPrivateKey();
  const SIGNER = `0x${keccakHex(secp256k1.getPublicKey(SKEY, false).slice(1)).slice(24)}`;
  const domain = keccakHex(Buffer.from(keccakHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)') + keccakHex('RUNNER') + keccakHex('1') + word(4663) + addrWord(tok), 'hex'));
  const sign = (key, account, total, deadline, instant = false) => {
    const struct = keccakHex(Buffer.from(keccakHex('Claim(address account,uint256 totalEarned,uint256 deadline,bool instant)') + addrWord(account) + word(total) + word(deadline) + word(instant ? 1 : 0), 'hex'));
    const s = secp256k1.sign(Buffer.from(keccakHex(Buffer.from(`1901${domain}${struct}`, 'hex')), 'hex'), key);
    return { v: 27 + s.recovery, r: `0x${s.r.toString(16).padStart(64, '0')}`, s: `0x${s.s.toString(16).padStart(64, '0')}` };
  };
  const claim = (from, account, total, deadline, sg, instant = false) => call(from, 'claim', account, total, deadline, sg.v, sg.r, sg.s, instant);
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
  for (let d = start - 3; d < start + 400; d++) if (Number(await em(d)) !== Math.floor(jsEmissionOn(d, launchSchedule(start)))) mirror = false;
  ok('app/server schedule (js/rules.js) matches the contract for 400 days', mirror);
  const today0 = await view('emissionToday');
  await call(DEV, 'setSigner', ZERO);
  ok('no signer → rejected', reverts(await claim(W(1), W(1), 100n * E18, dl(), sg), 'BadSignature'));
  await call(DEV, 'setSigner', SIGNER);
  ok('emissionToday: full limit unused', u(today0, 0) === 10_000_000n * E18 && u(today0, 1) === 10_000_000n * E18);
  ok('only the runner can choose instant (no one can burn your rewards)', reverts(await claim(W(7), W(1), 100n * E18, dl(), sg, true), 'OnlyRunnerCanClaimInstantly'));
  const r = await claim(W(7), W(1), 100n * E18, dl(), sg);
  const lk = await view('locksOf', W(1));
  ok('locked claim (submitted by anyone): 100 locked for 7 days, nothing paid yet', r.ok && await bal(W(1)) === 0n && await bal(W(7)) === 0n && u(lk, 0) === 100n * E18 && u(lk, 2) === c.now + 7n * 86400n, `gas ${r.gas}`);
  ok('locked rewards leave the run pool', u(await view('totalLocked')) === 100n * E18 && u(await view('rewardsRemaining')) === 800_000_000n * E18 - 100n * E18);
  ok('replay', reverts(await claim(W(1), W(1), 100n * E18, dl(), sg), 'NothingToClaim'));
  sg = sign(SKEY, W(1), 250n * E18, dl(), true);
  const supply0 = u(await view('totalSupply'));
  ok('instant claim of the difference: 80% paid, 20% burned', (await claim(W(1), W(1), 250n * E18, dl(), sg, true)).ok && await bal(W(1)) === 120n * E18
    && u(await view('totalSupply')) === supply0 - 30n * E18 && u(await view('totalBurnedInstant')) === 30n * E18);
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
  // holder rewards are IMD, so they can never be paid out of the RUNNER run-reward pool
  await reward(20_000n * E18);
  const held = u(await view('holderRewardsHeld'));
  ok('holder IMD and locks kept apart from the RUNNER run pool', held === 20_000n * E18 && u(await view('rewardsRemaining')) === await bal(tok) - u(await view('totalLocked')));
}

// =================================================================== emission controls
{
  const { c, call, view } = await setup();
  const M = 10n ** 18n;
  const em = async (d) => u(await view('emissionOn', d)) / M;
  const sched = async () => { const r = await view('emissionSchedule'); return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => u(r, i)); };
  ok('only owner sets the schedule', reverts(await call(W(1), 'setEmissionSchedule', 5_000_000n * M, 30, 100_000n * M), 'NotOwner'));
  ok('above 20M/day rejected', reverts(await call(DEV, 'setEmissionSchedule', 20_000_001n * M, 30, 0), 'BadSchedule'));
  ok('floor above daily amount rejected', reverts(await call(DEV, 'setEmissionSchedule', 1_000n * M, 30, 2_000n * M), 'BadSchedule'));
  ok('halving under 7 or over 3650 days rejected', reverts(await call(DEV, 'setEmissionSchedule', 1_000n * M, 6, 0), 'BadSchedule') && reverts(await call(DEV, 'setEmissionSchedule', 1_000n * M, 3651, 0), 'BadSchedule'));
  ok('before launch: replaces the launch schedule', (await call(DEV, 'setEmissionSchedule', 8_000_000n * M, 14, 50_000n * M)).ok);
  await call(DEV, 'startEmission');
  const d0 = Number(u(await view('emissionStartDay')));
  ok('launch uses the replaced schedule (8M, halving every 14 days)', await em(d0) === 8_000_000n && await em(d0 + 14) === 4_000_000n);
  c.addTime(20 * DAY);                      // day 20: 4M under the current schedule
  const d20 = d0 + 20;
  ok('mid-run: today follows the current schedule', await em(d20) === 4_000_000n);
  await call(DEV, 'setEmissionSchedule', 20_000_000n * M, 30, 200_000n * M);
  ok('a new schedule never changes today', await em(d20) === 4_000_000n);
  ok('it starts tomorrow with a fresh halving clock', await em(d20 + 1) === 20_000_000n && await em(d20 + 30) === 20_000_000n && await em(d20 + 31) === 10_000_000n);
  const sc = await sched();
  ok('emissionSchedule() shows current and pending', sc[0] === 8_000_000n * M && sc[2] === 14n && sc[4] === 20_000_000n * M && sc[7] === BigInt(d20 + 1));
  await call(DEV, 'setEmissionSchedule', 2_000_000n * M, 60, 0);
  ok('setting again the same day replaces the pending one', await em(d20 + 1) === 2_000_000n && await em(d20) === 4_000_000n);
  c.addTime(5 * DAY);                        // day 25: pending (2M, 60 days) is in force since day 21
  ok('pending schedule in force on its day', await em(d20 + 5) === 2_000_000n && await em(d20 + 61) === 1_000_000n);
  await call(DEV, 'setEmissionSchedule', 3_000_000n * M, 7, 100_000n * M);
  const sc2 = await sched();
  ok('a later change promotes the old pending one to current', sc2[0] === 2_000_000n * M && sc2[3] === BigInt(d20 + 1) && sc2[4] === 3_000_000n * M && sc2[7] === BigInt(d20 + 6));
  ok('zero emission allowed (acts like a pause from tomorrow)', (await call(DEV, 'setEmissionSchedule', 0, 30, 0)).ok && await em(d20 + 6) === 0n);
  // JS mirror against the on-chain schedule
  const js = decodeSchedule(await view('emissionSchedule'), d0); // the server's decoder
  let same = true;
  for (let d = d20 + 5; d < d20 + 300; d++) if (Number(await em(d)) !== Math.floor(jsEmissionOn(d, js))) same = false;
  ok('server decoder + js/rules.js mirror a changed on-chain schedule', same && js.next?.dailyStart === 0 && js.current.dailyStart === 2_000_000);
}

// =================================================================== 7-day locks
{
  const { c, tok, call, view, bal } = await setup();
  const SKEY = secp256k1.utils.randomPrivateKey();
  const SIGNER = `0x${keccakHex(secp256k1.getPublicKey(SKEY, false).slice(1)).slice(24)}`;
  const domain = keccakHex(Buffer.from(keccakHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)') + keccakHex('RUNNER') + keccakHex('1') + word(4663) + addrWord(tok), 'hex'));
  const claimAs = (from, account, total, instant = false) => {
    const deadline = c.now + 3600n;
    const struct = keccakHex(Buffer.from(keccakHex('Claim(address account,uint256 totalEarned,uint256 deadline,bool instant)') + addrWord(account) + word(total) + word(deadline) + word(instant ? 1 : 0), 'hex'));
    const sg = secp256k1.sign(Buffer.from(keccakHex(Buffer.from(`1901${domain}${struct}`, 'hex')), 'hex'), SKEY);
    return call(from, 'claim', account, total, deadline, 27 + sg.recovery, `0x${sg.r.toString(16).padStart(64, '0')}`, `0x${sg.s.toString(16).padStart(64, '0')}`, instant);
  };
  await call(DEV, 'setSigner', SIGNER);
  await call(DEV, 'startEmission');
  const A = W(1), B = W(2);
  const supply0 = u(await view('totalSupply'));
  await claimAs(A, A, 1000n * E18);                      // lock 1000 (day 0)
  ok('release before 7 days → nothing', reverts(await call(W(9), 'release', A), 'NothingToRelease'));
  c.addTime(3 * DAY);
  await claimAs(A, A, 1500n * E18);                      // lock 500 more (day 3)
  let lk = await view('locksOf', A);
  ok('two locks, nothing unlocked yet', u(lk, 0) === 1500n * E18 && u(lk, 1) === 0n && u(lk, 3) === 2n);
  c.addTime(4 * DAY + 1);                                // day 7: first lock done
  lk = await view('locksOf', A);
  ok('after 7 days the first lock is ready', u(lk, 0) === 500n * E18 && u(lk, 1) === 1000n * E18);
  ok('anyone can release finished locks to the runner: 100%', (await call(W(9), 'release', A)).ok && await bal(A) === 1000n * E18 && await bal(W(9)) === 0n);
  ok('no burn for locked rewards', u(await view('totalSupply')) === supply0);
  c.addTime(3 * DAY);                                    // day 10: second lock done
  await claimAs(A, A, 1600n * E18);                      // new claim auto-releases the finished lock
  ok('a new claim pays out finished locks automatically', await bal(A) === 1500n * E18 && u(await view('locksOf', A), 0) === 100n * E18);
  // early release: B locks 1000, waits 2 days, takes it early → 800, 200 burned
  await claimAs(B, B, 1000n * E18);
  c.addTime(2 * DAY);
  const s1 = u(await view('totalSupply'));
  ok('release early: 80% now, 20% burned', (await call(B, 'releaseEarly')).ok && await bal(B) === 800n * E18 && u(await view('totalSupply')) === s1 - 200n * E18);
  ok('nothing left after early release', reverts(await call(B, 'releaseEarly'), 'NothingToRelease') && u(await view('locksOf', B), 3) === 0n);
  // early release with a mix of finished and unfinished locks (no claim in between)
  const D = W(4);
  await claimAs(D, D, 1000n * E18);                      // lock 1000
  c.addTime(3 * DAY);
  await claimAs(D, D, 2000n * E18);                      // lock 1000 more
  c.addTime(5 * DAY);                                    // first finished, second not
  const dBefore = await bal(D), sD = u(await view('totalSupply'));
  ok('early release: finished lock 100%, unfinished 80% (only 20% of the unfinished burned)', (await call(D, 'releaseEarly')).ok && await bal(D) - dBefore === 1800n * E18 && u(await view('totalSupply')) === sD - 200n * E18);
  // lock limit
  const C = W(3);
  let total = 0n, okAll = true;
  for (let i = 0; i < 30; i++) { total += E18; if (!(await claimAs(C, C, total)).ok) okAll = false; }
  ok('30 active locks allowed', okAll && u(await view('locksOf', C), 3) === 30n);
  ok('31st lock rejected until some finish', reverts(await claimAs(C, C, total + E18), 'TooManyLocks'));
  ok('instant claims still work at the limit', (await claimAs(C, C, total + E18, true)).ok);
  c.addTime(7 * DAY + 1);
  ok('after locks finish, locking works again', (await claimAs(C, C, total + 2n * E18)).ok && u(await view('locksOf', C), 3) === 1n);
  // accounting
  const burned = u(await view('totalBurnedInstant'));
  ok('supply fell by exactly what was burned', u(await view('totalSupply')) === supply0 - burned);
  ok('contract RUNNER balance = pool + locks', await bal(tok) === u(await view('rewardsRemaining')) + u(await view('totalLocked')));
}

// =================================================================== holder rewards arrive in IMD
{
  const { c, tok, call, view, bal, newPair, buy, today, reward, imdBal } = await setup();
  const pair = await newPair();
  ok('liquidity moves untaxed', (await call(HOOK, 'transfer', pair, 50_000_000n * E18)).ok && await bal(pair) === 50_000_000n * E18);
  await buy(pair, W(1), 1_000_000n * E18);
  ok('a pool payout (buy) moves the exact amount: no RUNNER tax', await bal(W(1)) === 1_000_000n * E18 && await bal(DEV) === 0n);
  await call(W(1), 'transfer', pair, 100_000n * E18);
  await call(W(1), 'approve', W(5), 50_000n * E18);
  await call(W(5), 'transferFrom', W(1), pair, 50_000n * E18);
  ok('sells (transfer or transferFrom) move the exact amount', await bal(pair) === 49_150_000n * E18 && await bal(W(1)) === 850_000n * E18);
  ok('no holder rewards from transfers themselves', u(await view('holderRewardsHeld')) === 0n);
  const d = await today();
  ok('IMD from the hook is booked as today\'s holder rewards', (await reward(23_000n * E18)).ok && u(await view('holderRewardsHeld')) === 23_000n * E18
    && u(await view('dayInfo', d), 1) === 23_000n * E18 && u(await view('totalHolderRewards')) === 23_000n * E18);
  ok('syncing again adds nothing', (await call(W(7), 'syncHolderRewards')).ok && u(await view('holderRewardsHeld')) === 23_000n * E18);
  ok('rewards are held in IMD, not RUNNER', await imdBal(tok) === 23_000n * E18 && u(await view('rewardsRemaining')) === 800_000_000n * E18);
  await reward(1n);
  ok('a second delivery the same day adds up', u(await view('dayInfo', d), 1) === 23_000n * E18 + 1n);
  ok('owner can exclude another RUNNER pool from rewards', (await call(DEV, 'excludePool', pair)).ok && u(await view('excludedFromHolderRewards', pair)) === 1n);
  ok('a pool can\'t be excluded twice', reverts(await call(DEV, 'excludePool', pair), 'AlreadyExcluded'));
  ok('excluded pool gets no holder share', u(await view('eligibleBalanceOn', pair, d)) === 0n);
}

// =================================================================== holder rewards
{
  const { c, tok, call, view, bal, newPair, buy, today, reward, imdBal } = await setup();
  const pair = await newPair();
  await call(HOOK, 'transfer', pair, 50_000_000n * E18);
  await call(DEV, 'excludePool', pair);
  // Day 0: give A 1,000,000, B 500,000, C 200,000 (below minimum)
  const A = W(1), B = W(2), C = W(3), D = W(4);
  await call(TEAM, 'transfer', A, 1_000_000n * E18);
  await call(TEAM, 'transfer', B, 500_000n * E18);
  await call(TEAM, 'transfer', C, 200_000n * E18);
  const day0 = await today();
  ok('received today → not eligible today', u(await view('eligibleBalanceOn', A, day0)) === 0n);
  c.addTime(DAY); // day 1: A, B, C held all day
  const day1 = await today();
  // trading on day 1: D buys, the hook delivers the holders' 2% in IMD
  await buy(pair, D, 10_000_000n * E18); // D buys mid-day → not eligible for day 1
  await reward(200_000n * E18);
  await call(B, 'transfer', W(6), 100_000n * E18); // B drops to 400k → share 400k
  await call(B, 'transfer', B, 0n);
  const [shares, rewards] = [u(await view('dayInfo', day1), 0), u(await view('dayInfo', day1), 1)];
  // eligible today: TEAM (start balance), A 1M, B min 400k (the hook, pool manager and pool are excluded)
  const teamStart = 100_000_000n * E18 - 1_700_000n * E18;
  const expectShares = teamStart + 1_000_000n * E18 + 400_000n * E18;
  ok('day shares = lowest balances of eligible wallets', shares === expectShares, `${shares} vs ${expectShares}`);
  ok('day rewards = IMD delivered that day', rewards === 200_000n * E18);
  ok('A counts 1M', u(await view('eligibleBalanceOn', A, day1)) === 1_000_000n * E18);
  ok('B counts its lowest (400k)', u(await view('eligibleBalanceOn', B, day1)) === 400_000n * E18);
  ok('C under 300k → 0', u(await view('eligibleBalanceOn', C, day1)) === 0n);
  ok('D bought today → 0', u(await view('eligibleBalanceOn', D, day1)) === 0n);
  ok('nothing claimable during the day itself', u(await view('holderClaimable', A)) === 0n && reverts(await call(A, 'claimHolderRewards'), 'NothingToClaim'));
  c.addTime(DAY); // day 2
  const expA = rewards * 1_000_000n * E18 / expectShares;
  ok('A claimable next day', u(await view('holderClaimable', A)) === expA, `${u(await view('holderClaimable', A))} vs ${expA}`);
  const aBefore = await imdBal(A), aTok = await bal(A);
  ok('A claims, paid in IMD', (await call(A, 'claimHolderRewards')).ok && await imdBal(A) - aBefore === expA && await bal(A) === aTok);
  ok('A can\'t claim twice', reverts(await call(A, 'claimHolderRewards'), 'NothingToClaim'));
  ok('C nothing', reverts(await call(C, 'claimHolderRewards'), 'NothingToClaim'));
  ok('D eligible from day 2 (held all day, no tax taken)', u(await view('eligibleBalanceOn', D, await today())) === 10_000_000n * E18);
  // B waits until the last day of the window (day1 + 7 = day 8)
  c.setTime((day1 + 7) * DAY + 80000);
  const expB = rewards * 400_000n * E18 / expectShares;
  ok('B still claimable on day 7 after', u(await view('holderClaimable', B)) === expB);
  ok('expired days not sweepable yet', u(await view('nextSweepDay')) === BigInt(day0) && (await call(W(9), 'sweepExpired', 30)).ok && u(await view('dayInfo', day1), 2) === expA);
  c.setTime((day1 + 8) * DAY + 10);
  ok('after 7 days B can no longer claim', u(await view('holderClaimable', B)) === 0n && reverts(await call(B, 'claimHolderRewards'), 'NothingToClaim'));
  const devBefore = await imdBal(DEV);
  const left = rewards - expA;
  const sw = await call(W(9), 'sweepExpired', 30);
  ok('anyone sweeps expired rewards to protocol, in IMD', sw.ok && await imdBal(DEV) - devBefore === left, `${await imdBal(DEV) - devBefore} vs ${left}`);
  ok('holder bucket empty after sweep', u(await view('holderRewardsHeld')) === 0n && await imdBal(tok) === 0n);
  ok('sweep is idempotent', (await call(W(9), 'sweepExpired', 30)).ok && await imdBal(DEV) - devBefore === left);
  ok('sweep progress saved', u(await view('nextSweepDay')) === BigInt(day1 + 1));
}

// =================================================================== the 300,000 boundary
{
  const { c, call, view, today } = await setup();
  await call(TEAM, 'transfer', W(7), 300_000n * E18);
  await call(TEAM, 'transfer', W(8), 300_000n * E18 - 1n);
  const d = await today();
  c.setTime((d + 1) * DAY + 10);
  ok('exactly 300,000 held all day counts', u(await view('eligibleBalanceOn', W(7), d + 1)) === 300_000n * E18);
  ok('one wei under 300,000 does not', u(await view('eligibleBalanceOn', W(8), d + 1)) === 0n);
}

// =================================================================== audit fixes (IMD audit 28c0a5e2)
{
  // Finding 5: opening balances count for the deploy day, so launch-day holder rewards go to holders.
  const { c, tok, call, view, bal, newPair, buy, today, reward } = await setup();
  const d0 = await today();
  ok('deploy day: share total = opening eligible balances (team; the hook\'s liquidity is excluded)', u(await view('dayInfo', d0), 0) === 100_000_000n * E18);
  ok('deploy day: team wallet counts for the whole day', u(await view('eligibleBalanceOn', TEAM, d0)) === 100_000_000n * E18);
  const p = await newPair();
  await call(HOOK, 'transfer', p, 10_000_000n * E18);
  await call(DEV, 'excludePool', p);
  await buy(p, W(1), 1_000_000n * E18);                        // a launch-day trade
  await reward(20_000n * E18);                                 // its holder fee, in IMD
  const [shares, rewards] = [u(await view('dayInfo', d0), 0), u(await view('dayInfo', d0), 1)];
  c.setTime((d0 + 1) * DAY + 10);
  const team = u(await view('holderClaimable', TEAM)), dev = u(await view('holderClaimable', DEV));
  ok('launch-day holder IMD is claimable by holders', rewards === 20_000n * E18 && team === rewards * 100_000_000n * E18 / shares && team > 0n);
  ok('…and holders\' shares add up to the day\'s rewards (no slice stranded)', rewards - team - dev < 10n, `${rewards - team - dev}`);
  ok('…the pool held no weight on the deploy day', shares === 100_000_000n * E18);

  // Finding 1: a self-transfer never lowers the day's lowest balance.
  await call(TEAM, 'transfer', W(2), 1_000_000n * E18);
  c.setTime((d0 + 2) * DAY + 10);
  const d2 = d0 + 2;
  await call(W(9), 'transfer', W(9), 0n);                     // starts day d2 (its share total freezes)
  const sh0 = u(await view('dayInfo', d2), 0);
  ok('self-transfer: balance and day minimum unchanged', (await call(W(2), 'transfer', W(2), 1_000_000n * E18)).ok
    && await bal(W(2)) === 1_000_000n * E18 && u(await view('eligibleBalanceOn', W(2), d2)) === 1_000_000n * E18
    && u(await view('dayInfo', d2), 0) === sh0);
  await call(W(2), 'approve', W(3), 1n);
  ok('transferFrom(self, self) by a spender with a 1 wei allowance changes nothing', (await call(W(3), 'transferFrom', W(2), W(2), 1n)).ok
    && u(await view('eligibleBalanceOn', W(2), d2)) === 1_000_000n * E18 && u(await view('dayInfo', d2), 0) === sh0);
  ok('self-transfer still spends the allowance and emits normally', u(await view('allowance', W(2), W(3))) === 0n);

  // Finding 2: excluding a pool that held RUNNER on earlier days keeps those days consistent.
  const late = await newPair();
  await call(HOOK, 'transfer', late, 50_000_000n * E18);      // day d2: not excluded yet, so it is just a big holder
  c.setTime((d2 + 1) * DAY + 10);
  await buy(p, W(4), 1_000_000n * E18);                        // day d2+1: a trade…
  await reward(20_000n * E18);                                 // …and its holder IMD, with the late pool still counted
  const d3 = d2 + 1;
  const ws = async (d) => { let t = 0n; for (const a of [DEV, TEAM, W(1), W(2), W(3), W(4), late, p]) t += u(await view('eligibleBalanceOn', a, d)); return t; };
  ok('before exclusion: weights add up to the share total', await ws(d3) === u(await view('dayInfo', d3), 0));
  c.setTime((d3 + 1) * DAY + 10);
  await call(DEV, 'excludePool', late);
  ok('after exclusion: the pool counts for no day', u(await view('eligibleBalanceOn', late, d3)) === 0n && u(await view('eligibleBalanceOn', late, d2)) === 0n);
  ok('…and past days\' share totals dropped by its weight, so weights still add up', await ws(d3) === u(await view('dayInfo', d3), 0) && await ws(d2) === u(await view('dayInfo', d2), 0));
  const rw = u(await view('dayInfo', d3), 1);
  const sh3 = u(await view('dayInfo', d3), 0);
  let tot = 0n;
  for (const a of [DEV, TEAM, W(1), W(2), W(3), W(4)]) tot += rw * u(await view('eligibleBalanceOn', a, d3)) / sh3;
  ok('…so the whole day\'s holder IMD is claimable by real holders', rw > 0n && rw - tot < 10n, `${rw - tot}`);

  // Finding 3: the payout choice is signed, so nobody can switch a runner's claim into a lock.
  const SKEY = secp256k1.utils.randomPrivateKey();
  const SIGNER = `0x${keccakHex(secp256k1.getPublicKey(SKEY, false).slice(1)).slice(24)}`;
  const domain = keccakHex(Buffer.from(keccakHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)') + keccakHex('RUNNER') + keccakHex('1') + word(4663) + addrWord(tok), 'hex'));
  const sign = (account, total, deadline, instant) => {
    const struct = keccakHex(Buffer.from(keccakHex('Claim(address account,uint256 totalEarned,uint256 deadline,bool instant)') + addrWord(account) + word(total) + word(deadline) + word(instant ? 1 : 0), 'hex'));
    const sg = secp256k1.sign(Buffer.from(keccakHex(Buffer.from(`1901${domain}${struct}`, 'hex')), 'hex'), SKEY);
    return [27 + sg.recovery, `0x${sg.r.toString(16).padStart(64, '0')}`, `0x${sg.s.toString(16).padStart(64, '0')}`];
  };
  await call(DEV, 'setSigner', SIGNER);
  await call(DEV, 'startEmission');
  const A = W(5), dl = c.now + 3600n;
  const inst = sign(A, 1000n * E18, dl, true);
  ok('someone else submitting a runner\'s instant claim as a lock is rejected', reverts(await call(W(6), 'claim', A, 1000n * E18, dl, ...inst, false), 'BadSignature'));
  ok('…or as instant (only the runner can)', reverts(await call(W(6), 'claim', A, 1000n * E18, dl, ...inst, true), 'OnlyRunnerCanClaimInstantly'));
  ok('the runner\'s own instant claim goes through: 80% now, nothing locked', (await call(A, 'claim', A, 1000n * E18, dl, ...inst, true)).ok
    && await bal(A) === 800n * E18 && u(await view('locksOf', A), 3) === 0n);
  const lock = sign(A, 1500n * E18, dl, false);
  ok('a lock signature cannot be used for an instant payout', reverts(await call(A, 'claim', A, 1500n * E18, dl, ...lock, true), 'BadSignature'));
  ok('a signed lock can still be submitted by anyone', (await call(W(6), 'claim', A, 1500n * E18, dl, ...lock, false)).ok && u(await view('locksOf', A), 0) === 500n * E18);
}

// =================================================================== second IMD audit fixes (66b2e980)
{
  const { c, tok, imd, call, view, bal, newPair, today, reward, imdBal } = await setup();
  const H = W(1), P = (await c.send(DEPLOYER, null, CP.ctor(tok))).created;
  // Finding 1, case (a) from the report: a pool that already claimed a day is excluded afterwards.
  const X = await newPair();
  await call(TEAM, 'transfer', H, 1_000_000n * E18);
  await call(TEAM, 'transfer', P, 1_000_000n * E18);
  await call(TEAM, 'transfer', X, 97_000_000n * E18);
  await call(DEV, 'excludePool', X);
  const d0 = await today(), d1 = d0 + 1;
  c.setTime(d1 * DAY + 100);                                  // day 1: TEAM, H and P each held 1M all day
  await reward(100_000n * E18);
  ok('day 1: three holders of 1M share 100,000 IMD', u(await view('dayInfo', d1), 0) === 3_000_000n * E18);
  c.setTime((d1 + 1) * DAY + 100);
  await c.send(DEPLOYER, P, CP.data('claim', tok));
  const pGot = await imdBal(P);
  ok('the pool contract claims its third first', pGot === 100_000n * E18 / 3n);
  ok('owner excludes it afterwards', (await call(DEV, 'excludePool', P)).ok);
  ok('a day already paid from keeps its share total', u(await view('dayInfo', d1), 0) === 3_000_000n * E18);
  const h = await call(H, 'claimHolderRewards'), t = await call(TEAM, 'claimHolderRewards');
  ok('the other holders still claim (no underflow) at the same rate', h.ok && t.ok && await imdBal(H) === pGot && await imdBal(TEAM) === pGot);
  ok('the day never pays out more than it received', u(await view('dayInfo', d1), 2) <= u(await view('dayInfo', d1), 1));
  // Case (b): sweeping keeps working past that day.
  c.setTime((d1 + 9) * DAY + 100);
  ok('expired days still sweep, past the frozen day', (await call(W(9), 'sweepExpired', 30)).ok && u(await view('nextSweepDay')) === BigInt(d1 + 2));
  ok('bookkeeping matches the IMD held', u(await view('holderRewardsHeld')) === await imdBal(tok));
  // Case (c): two identical holders are paid the same, whether they claim before or after an exclusion.
  const A2 = W(2), B2 = W(3), Q = (await c.send(DEPLOYER, null, CP.ctor(tok))).created;
  await call(TEAM, 'transfer', A2, 300_000n * E18 + 1n);      // TEAM keeps ~700k
  await call(H, 'transfer', B2, 300_000n * E18 + 1n);
  await call(TEAM, 'transfer', Q, 300_000n * E18);
  const e0 = await today(), e1 = e0 + 1;
  c.setTime(e1 * DAY + 100);
  await reward(9_000n * E18);
  c.setTime((e1 + 1) * DAY + 100);
  const a0 = await imdBal(A2);
  await call(A2, 'claimHolderRewards');
  const aGot = await imdBal(A2) - a0;
  await call(DEV, 'excludePool', Q);                          // Q never claimed; excluded after A2 was paid
  const b0 = await imdBal(B2);
  await call(B2, 'claimHolderRewards');
  ok('identical holders get identical rewards around an exclusion', aGot > 0n && await imdBal(B2) - b0 === aGot, `${aGot} vs ${await imdBal(B2) - b0}`);
}
{
  // Finding 2: claimable() only promises what claim() would pay right now.
  const { c, tok, call, view } = await setup();
  const SKEY = secp256k1.utils.randomPrivateKey();
  const SIGNER = `0x${keccakHex(secp256k1.getPublicKey(SKEY, false).slice(1)).slice(24)}`;
  const A = W(1);
  ok('claimable is 0 before emission starts', u(await view('claimable', A, 100n * E18)) === 0n);
  await call(DEV, 'startEmission');
  ok('claimable is 0 with no signer set', u(await view('claimable', A, 100n * E18)) === 0n);
  await call(DEV, 'setSigner', SIGNER);
  ok('claimable = the difference once claims are on', u(await view('claimable', A, 100n * E18)) === 100n * E18);
  ok('claimable never exceeds what is left of today\'s emission', u(await view('claimable', A, 30_000_000n * E18)) === 10_000_000n * E18);
  await call(DEV, 'setClaimsPaused', true);
  ok('claimable is 0 while claims are paused', u(await view('claimable', A, 100n * E18)) === 0n);
  // Finding 3: a pending ownership proposal can be cancelled.
  await call(DEV, 'transferOwnership', W(5));
  ok('owner can cancel a proposal with address(0)', (await call(DEV, 'transferOwnership', ZERO)).ok && (await view('pendingOwner')).slice(26) === '0'.repeat(40));
  ok('the cancelled address can no longer take over', reverts(await call(W(5), 'acceptOwnership'), 'NotOwner') && (await view('owner')).slice(26) === DEV.slice(2));
  // Finding 4: the protocol wallet can't be the token itself.
  ok('protocol wallet can\'t be the token contract', reverts(await call(DEV, 'setProtocolWallet', tok), 'BadAddress'));
}

// =================================================================== randomized model check
{
  const { c, tok, call, view, bal, newPair, buy, today, reward, imdBal } = await setup();
  const MIN = 300_000n * E18;
  let seed = 0x5eed1234;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const holders = [DEV, TEAM, W(1), W(2), W(3), W(4), W(5), W(6)];
  const pairs = [await newPair(), await newPair()];
  const late = await newPair();             // a pool that holds RUNNER for days before it is excluded
  const weighted = [...holders, late];      // every wallet whose balance can count toward a day's shares
  const m = { bal: new Map(), dayMin: new Map(), rewards: new Map(), paid: new Map(), claimed: new Set(), excluded: new Set([tok, HOOK, PM, DEAD].map((x) => x.toLowerCase())), day: await today(), held: 0n, imd: new Map(), frozen: new Map() };
  const B = (a) => m.bal.get(a.toLowerCase()) || 0n;
  const setB = (a, v) => {
    a = a.toLowerCase(); m.bal.set(a, v);
    const dm = m.dayMin.get(m.day); if (dm.has(a)) dm.set(a, v < dm.get(a) ? v : dm.get(a)); else dm.set(a, v);
  };
  const enterDay = (d) => {
    while (m.day < d) { m.day++; m.dayMin.set(m.day, new Map([...m.bal].map(([k, v]) => [k, v]))); }
  };
  const addImd = (a, v) => { a = a.toLowerCase(); m.imd.set(a, (m.imd.get(a) || 0n) + v); };
  m.dayMin.set(m.day, new Map());
  for (const a of [tok, DEV, TEAM, HOOK, late, ...pairs, ...holders]) m.bal.set(a.toLowerCase(), await bal(a));
  for (const [k, v] of m.bal) m.dayMin.get(m.day).set(k, v); // opening balances count as held all deploy day
  const elig = (a, d) => {
    a = a.toLowerCase();
    if (m.excluded.has(a)) return 0n;
    const v = m.dayMin.get(d)?.get(a) ?? 0n;
    return v >= MIN ? v : 0n;
  };
  const move = (from, to, amt) => { if (from.toLowerCase() === to.toLowerCase()) return; setB(from, B(from) - amt); setB(to, B(to) + amt); };
  // liquidity: pools are funded from the hook's allocation and excluded
  for (const p of pairs) { await call(HOOK, 'transfer', p, 20_000_000n * E18); move(HOOK, p, 20_000_000n * E18); await call(DEV, 'excludePool', p); m.excluded.add(p.toLowerCase()); }
  for (const h of holders.slice(2)) { const a = BigInt(Math.floor(rnd() * 1_500_000)) * E18; await call(TEAM, 'transfer', h, a); move(TEAM, h, a); }
  await call(HOOK, 'transfer', late, 5_000_000n * E18); move(HOOK, late, 5_000_000n * E18);

  let steps = 0, checks = 0, claims = 0, sweeps = 0, trades = 0, deliveries = 0;
  const check = async (label) => {
    const d = await today();
    let sumB = 0n;
    for (const a of new Set([tok, HOOK, late, ...pairs, ...holders])) {
      const cb = await bal(a);
      if (cb !== B(a)) throw new Error(`${label}: balance ${a} ${cb} != model ${B(a)}`);
      sumB += cb;
    }
    if (sumB !== u(await view('totalSupply'))) throw new Error(`${label}: supply mismatch`);
    for (const dd of [d, d - 1, d - 3].filter((x) => m.dayMin.has(x))) {
      let s = 0n;
      for (const h of weighted) {
        const ce = u(await view('eligibleBalanceOn', h, dd));
        if (ce !== elig(h, dd)) throw new Error(`${label}: eligible ${h} day ${dd} ${ce} != ${elig(h, dd)}`);
        s += ce;
      }
      s += m.frozen.get(dd) || 0n;
      const info = await view('dayInfo', dd);
      if (u(info, 0) !== s && (u(info, 0) > 0n || (m.rewards.get(dd) || 0n) > 0n)) throw new Error(`${label}: shares day ${dd} ${u(info, 0)} != ${s}`);
      if (u(info, 1) !== (m.rewards.get(dd) || 0n)) throw new Error(`${label}: rewards day ${dd}`);
    }
    if (u(await view('holderRewardsHeld')) !== m.held) throw new Error(`${label}: held ${u(await view('holderRewardsHeld'))} != ${m.held}`);
    if (await imdBal(tok) !== m.held) throw new Error(`${label}: IMD in contract ${await imdBal(tok)} != ${m.held}`);
    for (const h of holders) if (await imdBal(h) !== (m.imd.get(h.toLowerCase()) || 0n)) throw new Error(`${label}: IMD of ${h}`);
    if (u(await view('rewardsRemaining')) !== B(tok)) throw new Error(`${label}: pool`);
    checks++;
  };
  const expectedClaim = (h) => {
    let t = 0n; const list = [];
    for (let dd = Math.max(0, m.day - 7); dd < m.day; dd++) {
      const r = m.rewards.get(dd) || 0n; if (!r || m.claimed.has(`${h}:${dd}`)) continue;
      let s = m.frozen.get(dd) || 0n; for (const x of weighted) s += elig(x, dd);
      const e = elig(h, dd); if (!e || !s) continue;
      t += r * e / s; list.push([dd, r * e / s]);
    }
    return { t, list };
  };

  for (; steps < 600; steps++) {
    if (steps === 300) {                    // exclude the late pool mid-run (audit finding 2)
      for (let dd = Math.max(0, m.day - 7); dd < m.day; dd++) {
        if ((m.paid.get(dd) || 0n) > 0n) m.frozen.set(dd, (m.frozen.get(dd) || 0n) + elig(late, dd)); // second audit, finding 1
      }
      const r = await call(DEV, 'excludePool', late); if (!r.ok) throw new Error('excludePool failed');
      m.excluded.add(late.toLowerCase());
    }
    const roll = rnd();
    if (roll < 0.12) {                     // time passes
      c.addTime(Math.floor(rnd() * 30 * 3600));
      enterDay(await today());
    } else if (roll < 0.32) {               // buy: a pool pays out RUNNER (no tax)
      const p = pick(pairs), h = pick(holders);
      const amt = BigInt(Math.floor(rnd() * 900_000)) * E18 + BigInt(Math.floor(rnd() * 1e6));
      if (amt > B(p)) continue;
      const r = await buy(p, h, amt); if (!r.ok) throw new Error('buy failed');
      move(p, h, amt); trades++;
    } else if (roll < 0.47) {               // sell: RUNNER into a pool (no tax)
      const p = pick(pairs), h = pick(holders);
      const amt = B(h) * BigInt(Math.floor(rnd() * 100)) / 100n; if (!amt) continue;
      const r = await call(h, 'transfer', p, amt); if (!r.ok) throw new Error('sell failed');
      move(h, p, amt); trades++;
    } else if (roll < 0.59) {               // the hook delivers holder IMD
      const amt = BigInt(Math.floor(rnd() * 40_000)) * E18 + BigInt(Math.floor(rnd() * 1e6));
      const r = await reward(amt); if (!r.ok) throw new Error('sync failed');
      m.held += amt; m.rewards.set(m.day, (m.rewards.get(m.day) || 0n) + amt); deliveries++;
    } else if (roll < 0.72) {               // wallet transfer
      const a = pick(holders), b = pick(holders);
      const amt = B(a) * BigInt(Math.floor(rnd() * 100)) / 100n;
      const r = await call(a, 'transfer', b, amt); if (!r.ok) throw new Error('transfer failed');
      move(a, b, amt);
    } else if (roll < 0.88) {               // claim holder rewards (paid in IMD)
      const h = pick(holders);
      const { t, list } = expectedClaim(h);
      const view0 = u(await view('holderClaimable', h));
      if (view0 !== t) throw new Error(`claimable ${h} ${view0} != ${t}`);
      const r = await call(h, 'claimHolderRewards');
      if (!t) { if (r.ok) throw new Error('claim of 0 succeeded'); continue; }
      if (!r.ok) throw new Error('claim failed');
      for (const [dd, a] of list) { m.claimed.add(`${h}:${dd}`); m.paid.set(dd, (m.paid.get(dd) || 0n) + a); }
      addImd(h, t); m.held -= t; claims++;
    } else if (roll < 0.95) {               // sweep (IMD to the protocol wallet)
      const next = Number(u(await view('nextSweepDay')));
      const max = 1 + Math.floor(rnd() * 5);
      let t = 0n, d = next;
      while (d + 7 < m.day && d < next + max) { const left = (m.rewards.get(d) || 0n) - (m.paid.get(d) || 0n); if (left > 0n) { t += left; m.paid.set(d, m.rewards.get(d)); } d++; }
      const r = await call(W(9), 'sweepExpired', max); if (!r.ok) throw new Error('sweep failed');
      if (t) { addImd(DEV, t); m.held -= t; sweeps++; }
    } else {                                 // burn
      const h = pick(holders); const amt = B(h) / 10n;
      const r = await call(h, 'burn', amt); if (!r.ok) throw new Error('burn failed');
      setB(h, B(h) - amt);
    }
    if (steps % 5 === 0) await check(`step ${steps}`);
  }
  await check('final');
  console.log(`randomized: ${steps} steps over ${m.dayMin.size} days, ${trades} untaxed trades, ${deliveries} IMD deliveries, ${claims} holder claims, ${sweeps} sweeps, ${checks} full bookkeeping checks — all matched`);
  ok('randomized model check', true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
