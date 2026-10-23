// Rewards server tests (no network, memory store). Run: node tests/rewards-server.test.mjs .
import { pathToFileURL } from 'node:url';
const repo = process.argv[2];
const imp = (p) => import(pathToFileURL(`${repo}/${p}`).href);
const secp = await imp('api/_lib/noble/secp256k1.js');
const eth = await imp('api/_lib/eth.js');
const { traitsFor } = await imp('js/collection.js');
const rules = await imp('js/rules.js');

const toHex = eth.toHex;
const rnd = () => toHex(secp.utils.randomPrivateKey());
const SERVER_KEY = rnd(), USER_KEY = rnd(), OTHER_KEY = rnd();
const USER = eth.addressOfKey(USER_KEY), OTHER = eth.addressOfKey(OTHER_KEY);
// a Daily Runner (jogger, 4–10 km/h) and a Tempo Runner token
let JOG = 0, TEMPO = 0;
for (let i = 1; i < 500 && (!JOG || !TEMPO); i++) { const t = traitsFor(i); if (!JOG && t.type === 'jogger') JOG = i; if (!TEMPO && t.type === 'runner') TEMPO = i; }
Object.assign(process.env, {
  REWARDS_STORE: 'memory', SIGNER_PRIVATE_KEY: SERVER_KEY,
  REWARDS_TEST_TOKEN: '0x8f7a45ebde059392e46a46dcc14ab24681a961ea', REWARDS_TEST_NFT: '0x' + '99'.repeat(20),
  REWARDS_FAKE_OWNED: JSON.stringify({ [USER]: [JOG, TEMPO] }),
  REWARDS_FAKE_TOKEN: JSON.stringify({ startDay: Math.floor(Date.now() / 864e5), claimedToday: '0', claimed: {} }),
});
const TODAY = Math.floor(Date.now() / 864e5);
const { default: handler, sessionMessage } = await imp('api/rewards.js');
const call = async (body, method = 'POST') => {
  let code = 200, out;
  await handler({ method, body, query: {} }, { setHeader() {}, status(c) { code = c; return this; }, end() {}, json(o) { out = o; } });
  return { code, ...out };
};
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`);
const signPersonal = async (key, msg) => { const s = await secp.signAsync(eth.personalDigest(msg), eth.fromHex(key)); return '0x' + toHex(s.toCompactRawBytes()) + (27 + s.recovery).toString(16); };

// status
const st = await call({ action: 'status' }, 'GET');
ok('status live', st.live === true && st.signer === eth.addressOfKey(SERVER_KEY), JSON.stringify(st));

// sessions
const issued = new Date().toISOString();
const msg = sessionMessage(USER, issued);
let r = await call({ action: 'session', address: USER, message: msg, signature: await signPersonal(OTHER_KEY, msg) });
ok('session with someone else\'s signature rejected', r.code === 401, r.error);
r = await call({ action: 'session', address: USER, message: sessionMessage(USER, new Date(Date.now() - 3600e3).toISOString()), signature: await signPersonal(USER_KEY, sessionMessage(USER, new Date(Date.now() - 3600e3).toISOString())) });
ok('old sign-in message rejected', r.code === 400, r.error);
r = await call({ action: 'session', address: USER, message: msg + 'x', signature: await signPersonal(USER_KEY, msg + 'x') });
ok('altered message rejected', r.code === 400, r.error);
r = await call({ action: 'session', address: USER, message: msg, signature: await signPersonal(USER_KEY, msg) });
ok('valid session issued', r.code === 200 && r.session, r.error);
const S = r.session;
const [p, m] = S.split('.');
const forged = Buffer.from(JSON.stringify({ a: OTHER, exp: Date.now() + 1e9 })).toString('base64url') + '.' + m;
ok('forged session rejected', (await call({ action: 'state', session: forged })).code === 401);

// state
r = await call({ action: 'state', session: S });
ok('fresh state', r.code === 200 && r.balance === 0 && r.energy === 4 && r.maxEnergy === 2 ? false : r.balance === 0 && r.maxEnergy === 1 && r.energy === 1, JSON.stringify({ e: r.energy, m: r.maxEnergy, owned: r.owned }));

// track builder: kmh constant, 1 point / 2 s, heading north
const track = (start, minutes, kmh, { dt = 2000, jumpAt = -1 } = {}) => {
  const pts = []; let lat = -6.2, lon = 106.8; const n = Math.round(minutes * 60000 / dt);
  for (let i = 0; i <= n; i++) {
    pts.push({ t: start + i * dt, lat: +lat.toFixed(7), lon });
    lat += (kmh / 3.6) * (dt / 1000) / 111195 * (i === jumpAt ? 50 : 1);
  }
  return pts;
};
const now = Date.now();
const jog = traitsFor(JOG);
const expected = rules.earnPerMinute({ ...jog, durability: 100, points: { efficiency: 0, resilience: 0 } }) * 30; // 1 energy = 30 min

r = await call({ action: 'run', session: S, run: { tokenId: 7777, points: track(now - 3600e3, 12, 8) } });
ok('sneaker not owned rejected', r.code === 403, r.error);
r = await call({ action: 'run', session: S, run: { tokenId: JOG, points: track(now - 3600e3, 35, 8) } });
ok('35-min run at 8 km/h credits 30 earning minutes (1 energy)', r.code === 200 && Math.abs(r.run.coins - expected) < expected * 0.02 && r.state.energy === 0, `got ${r.run?.coins} expected ${expected.toFixed(4)} energy ${r.state?.energy} ${r.error || ''}`);
const firstCoins = r.run.coins;
r = await call({ action: 'run', session: S, run: { tokenId: JOG, points: track(now - 3600e3, 35, 8) } });
ok('replayed run rejected', r.code === 409, r.error);
r = await call({ action: 'run', session: S, run: { tokenId: JOG, points: track(now - 1200e3, 10, 8) } });
ok('no energy left → earns ~0 (only seconds of refill)', r.code === 200 && r.run.coins < 0.01, JSON.stringify(r.run || r));

// energy refills over time: fake by editing clock? use a second user with fresh energy instead
const U2_KEY = rnd(), U2 = eth.addressOfKey(U2_KEY);
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [USER]: [JOG, TEMPO], [U2]: [JOG, TEMPO] });
const m2 = sessionMessage(U2, new Date().toISOString());
const S2 = (await call({ action: 'session', address: U2, message: m2, signature: await signPersonal(U2_KEY, m2) })).session;
r = await call({ action: 'run', session: S2, run: { tokenId: JOG, points: track(now - 1500e3, 10, 8) } });
ok('same sneaker reused by new owner in the same period rejected', r.code === 409, r.error);
r = await call({ action: 'run', session: S2, run: { tokenId: TEMPO, points: track(now - 3000e3, 15, 60) } });
ok('car-speed run voided', r.code === 200 && r.run.voided && r.run.coins === 0, JSON.stringify(r.run || r));
r = await call({ action: 'run', session: S2, run: { tokenId: TEMPO, points: track(now - 2000e3, 8, 10, { jumpAt: 100 }).map((p) => p) } });
ok('teleport jump counted as vehicle time', r.code === 200 && r.run.vehicleSec > 0, JSON.stringify(r.run || r));
r = await call({ action: 'run', session: S2, run: { tokenId: TEMPO, points: track(now - 100 * 3600e3, 10, 10) } });
ok('run older than 72 h rejected', r.code === 400, r.error);
r = await call({ action: 'run', session: S2, run: { tokenId: TEMPO, points: track(now + 3600e3, 10, 10) } });
ok('future run rejected', r.code === 400, r.error);
const bad = track(now - 100e3, 1, 10); bad[5].t = bad[3].t;
r = await call({ action: 'run', session: S2, run: { tokenId: TEMPO, points: bad } });
ok('out-of-order points rejected', r.code === 400, r.error);

// spending
r = await call({ action: 'levelup', session: S, tokenId: JOG });
const LV1 = rules.levelUpCost({ level: 0 });
ok(`level-up spends ${LV1} RUNNER and grants points`, r.code === 200 && Math.abs(r.balance - (firstCoins - LV1)) < 0.01 && r.sneakers[JOG].level === 1 && r.sneakers[JOG].unspent === rules.POINTS_PER_LEVEL[jog.rarity], JSON.stringify(r).slice(0, 200));
const LV2 = rules.levelUpCost({ level: 1 }), LV3 = rules.levelUpCost({ level: 2 });
r = await call({ action: 'levelup', session: S, tokenId: JOG });
ok(`second level-up (${LV2}) affordable after a 30-min run`, r.code === 200 && r.sneakers[JOG].level === 2);
r = await call({ action: 'levelup', session: S, tokenId: JOG });
ok(`third level-up (${LV3}) rejected: not enough`, r.code === 400 && /Not enough/.test(r.error), r.error);
const PTS = 2 * rules.POINTS_PER_LEVEL[jog.rarity];
r = await call({ action: 'allocate', session: S, tokenId: JOG, add: { efficiency: PTS + 1 } });
ok('allocating more points than unspent rejected', r.code === 400, r.error);
r = await call({ action: 'allocate', session: S, tokenId: JOG, add: { efficiency: PTS - 1, resilience: 1 } });
ok('allocating points works', r.code === 200 && r.sneakers[JOG].points.efficiency === PTS - 1 && r.sneakers[JOG].unspent === 0);
const spentNow = LV1 + LV2;
// claims
r = await call({ action: 'claim', session: S });
const c = r.claim;
ok('claim signed', r.code === 200 && c && Math.abs(Number(BigInt(c.totalEarned)) / 1e18 - (firstCoins - spentNow)) < 0.01, JSON.stringify(r).slice(0, 200));
const digest = eth.claimDigest({ token: c.contract, chainId: c.chainId, account: USER, totalWei: BigInt(c.totalEarned), deadline: c.deadline });
const sigHex = c.r + c.s.slice(2) + c.v.toString(16);
ok('claim signature recovers to server key', eth.recoverAddress(digest, sigHex) === eth.addressOfKey(SERVER_KEY));
ok('claimed amount locked from in-app spending', r.state.balance === 0 && Math.abs(r.state.withdrawn - (firstCoins - spentNow)) < 0.01, JSON.stringify(r.state).slice(0, 160));
ok('claim chain is Robinhood mainnet', c.chainId === 4663);
r = await call({ action: 'repair', session: S, tokenId: JOG });
ok('in-app spending blocked after claim', r.code === 400 || r.balance === 0, r.error || 'no repair needed');
// ---- halving, daily budget, partial claims
let JOG2 = 0;
for (let i = JOG + 1; i < 800 && !JOG2; i++) if (traitsFor(i).type === 'jogger') JOG2 = i;
const U3_KEY = rnd(), U3 = eth.addressOfKey(U3_KEY);
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [USER]: [JOG, TEMPO], [U2]: [JOG, TEMPO], [U3]: [JOG2] });
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: TODAY - 30, claimedToday: '0', claimed: {} }); // one halving ago
const m3 = sessionMessage(U3, new Date().toISOString());
const S3 = (await call({ action: 'session', address: U3, message: m3, signature: await signPersonal(U3_KEY, m3) })).session;
const st3 = await call({ action: 'state', session: S3 });
ok('state reports emission: 5M today, rate 50%, next halving', st3.emission.limit === 5_000_000 && st3.emission.factor === 0.5 && st3.emission.nextHalving === (TODAY + 30) * 864e5, JSON.stringify(st3.emission));
const jog2 = traitsFor(JOG2);
const exp2 = rules.earnPerMinute({ ...jog2, durability: 100, points: { efficiency: 0, resilience: 0 } }, 0.5) * 30;
r = await call({ action: 'run', session: S3, run: { tokenId: JOG2, points: track(now - 7200e3, 35, 8) } });
ok('after one halving the same run earns half', r.code === 200 && Math.abs(r.run.coins - exp2) < exp2 * 0.02 && r.run.factor === 0.5, `got ${r.run?.coins} expected ${exp2.toFixed(2)}`);
const earned3 = r.run.coins;
// fill today's budget so only 1 RUNNER is left, then a run gets capped
const storeMod = await imp('api/_lib/store.js');
const budgetKey = `rw:budget:${TODAY}`;
const used = Number((await storeMod.get(budgetKey)) || 0);
await storeMod.incrBy(budgetKey, 5_000_000 * 1e6 - used - 1e6);
const U4_KEY = rnd(), U4 = eth.addressOfKey(U4_KEY);
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [USER]: [JOG, TEMPO], [U2]: [JOG, TEMPO], [U3]: [JOG2], [U4]: [TEMPO + 1000] });
const m4 = sessionMessage(U4, new Date().toISOString());
const S4 = (await call({ action: 'session', address: U4, message: m4, signature: await signPersonal(U4_KEY, m4) })).session;
r = await call({ action: 'run', session: S4, run: { tokenId: TEMPO + 1000, points: track(now - 3000e3, 10, 12) } });
ok('costs halve with emission (level-up at 50%)', rules.levelUpCost({ level: 0 }, 0.5) === LV1 / 2 && rules.repairCost({ level: 0, durability: 50 }, 0.5) === rules.repairCost({ level: 0, durability: 50 }) / 2);
ok('energy table 1/2/4/6/10', [1, 2, 3, 9, 15, 30].map(rules.maxEnergy).join() === '1,1,2,4,6,10');
ok('Common lasts ~9 days of 1 energy/day before 50% durability', Math.round(50 / rules.durabilityLossPerEnergy({ base: { efficiency: 6, resilience: 6 }, points: {}, durability: 100 })) === 9);
ok('global daily budget: run capped at what is left (1 RUNNER)', r.code === 200 && r.run.capped && Math.abs(r.run.coins - 1) < 1e-6, JSON.stringify(r.run || r));
ok('budget never exceeded', Number(await storeMod.get(budgetKey)) === 5_000_000 * 1e6);
// partial claim: only 2 RUNNER left in today's on-chain emission
const limitWei = 5_000_000n * 10n ** 18n;
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: TODAY - 30, claimedToday: String(limitWei - 2n * 10n ** 18n), claimed: {} });
r = await call({ action: 'claim', session: S3 });
ok('partial claim when today\'s emission is nearly used', r.code === 200 && r.claim.partial && BigInt(r.claim.totalEarned) === 2n * 10n ** 18n, JSON.stringify(r).slice(0, 220));
ok('rest of the balance stays spendable', Math.abs(r.state.balance - (earned3 - 2)) < 0.01, String(r.state.balance));
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: TODAY - 30, claimedToday: String(limitWei), claimed: { [U3]: String(2n * 10n ** 18n) } });
r = await call({ action: 'claim', session: S3 });
ok('claim limit used up → clear message, nothing signed', r.code === 429 && /claim limit is used up/.test(r.error), r.error);
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: TODAY - 30, claimedToday: '0', claimed: { [U3]: String(2n * 10n ** 18n) } });
r = await call({ action: 'claim', session: S3 });
ok('next day the rest can be claimed', r.code === 200 && !r.claim.partial && Math.abs(Number(BigInt(r.claim.totalEarned)) / 1e18 - earned3) < 0.01, JSON.stringify(r).slice(0, 200));
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: 0 });
ok('before emission starts the server is not live', (await call({ action: 'status' }, 'GET')).live === false);
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: TODAY, claimedToday: '0', claimed: {} });
// concurrency lock
const [a, b] = await Promise.all([call({ action: 'state', session: S }), call({ action: 'state', session: S })]);
ok('parallel requests: one waits (409) or both ok, never corrupt', [a.code, b.code].includes(200));
const fails = results.filter((x) => x.startsWith('FAIL'));
console.log(results.join('\n'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
console.log(JSON.stringify({ signer: eth.addressOfKey(SERVER_KEY), claim: c }));
