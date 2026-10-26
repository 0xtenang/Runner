// Rewards server tests (no network, memory store). Run: node tests/rewards-server.test.mjs .
import { pathToFileURL } from 'node:url';
const repo = process.argv[2];
const imp = (p) => import(pathToFileURL(`${repo}/${p}`).href);
const secp = await imp('api/_lib/noble/secp256k1.js');
const eth = await imp('api/_lib/eth.js');
const { traitsFor } = await imp('js/collection.js');
const rules = await imp('js/rules.js');

// Test clock: the server reads Date.now(), so the 24-hour hold can be fast-forwarded.
const realNow = Date.now.bind(Date);
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;
const iso = () => new Date(Date.now()).toISOString();

const toHex = eth.toHex;
const rnd = () => toHex(secp.utils.randomPrivateKey());
const SERVER_KEY = rnd(), USER_KEY = rnd(), OTHER_KEY = rnd(), ADMIN_KEY = rnd();
const USER = eth.addressOfKey(USER_KEY), OTHER = eth.addressOfKey(OTHER_KEY);
// a Daily Runner (jogger, 4–10 km/h) and a Tempo Runner token
let JOG = 0, TEMPO = 0;
for (let i = 1; i < 500 && (!JOG || !TEMPO); i++) { const t = traitsFor(i); if (!JOG && t.type === 'jogger') JOG = i; if (!TEMPO && t.type === 'runner') TEMPO = i; }
Object.assign(process.env, {
  REWARDS_STORE: 'memory', SIGNER_PRIVATE_KEY: SERVER_KEY, ADMIN_WALLETS: eth.addressOfKey(ADMIN_KEY),
  REWARDS_TEST_TOKEN: '0x8f7a45ebde059392e46a46dcc14ab24681a961ea', REWARDS_TEST_NFT: '0x' + '99'.repeat(20),
  REWARDS_FAKE_OWNED: JSON.stringify({ [USER]: [JOG, TEMPO] }),
  REWARDS_FAKE_TOKEN: JSON.stringify({ startDay: Math.floor(Date.now() / 864e5), claimedToday: '0', claimed: {} }),
});
const TODAY = Math.floor(Date.now() / 864e5);
const { default: handler, sessionMessage, settingsMessage, adminMessage } = await imp('api/rewards.js');
let ipCounter = 0;
const call = async (body, method = 'POST', ip = `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`) => {
  let code = 200, out;
  await handler({ method, body, query: method === 'GET' ? { ...body } : {}, headers: { 'x-forwarded-for': ip } }, { setHeader() {}, status(c) { code = c; return this; }, end() {}, json(o) { out = o; } });
  return { code, ...out };
};
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`);
const signPersonal = async (key, msg) => { const s = await secp.signAsync(eth.personalDigest(msg), eth.fromHex(key)); return '0x' + toHex(s.toCompactRawBytes()) + (27 + s.recovery).toString(16); };

// status
const st = await call({ action: 'status' }, 'GET');
ok('status live', st.live === true && st.signer === eth.addressOfKey(SERVER_KEY), JSON.stringify(st));

// sessions
const issued = iso();
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

// Track builder. Default: realistic — fixes ~every 2 s with jitter, speed ±10%, a
// wandering heading and varying accuracy. perfect: a scripted track (exact timing,
// constant speed, straight line, no accuracy) like a cheater's generator.
let seed = 12345;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const track = (start, minutes, kmh, { dt = 2000, jumpAt = -1, perfect = false } = {}) => {
  const pts = [];
  let lat = -6.2 + rand() * 0.05, lon = 106.8 + rand() * 0.05, t = start, heading = rand() * Math.PI * 2;
  const n = Math.round(minutes * 60000 / dt);
  for (let i = 0; i <= n; i++) {
    const p = { t: Math.round(t), lat: +lat.toFixed(7), lon: +lon.toFixed(7) };
    if (!perfect) p.acc = 3 + Math.floor(rand() * 9);
    pts.push(p);
    const step = perfect ? dt : dt + (rand() - 0.5) * 600;
    const v = (kmh / 3.6) * (perfect ? 1 : 0.9 + rand() * 0.2);
    if (!perfect) heading += (rand() - 0.5) * 0.3;
    const d = (v * step) / 1000 * (i === jumpAt ? 50 : 1);
    const h = perfect ? 0 : heading;
    lat += (d * Math.cos(h)) / 111195;
    lon += (d * Math.sin(h)) / (111195 * Math.cos((lat * Math.PI) / 180));
    t += step;
  }
  return pts;
};
let now = Date.now();
const advance = (ms) => { clockOffset += ms; now = Date.now(); };
const jog = traitsFor(JOG);
const expected = rules.earnPerMinute({ ...jog, durability: 100, points: { efficiency: 0, resilience: 0 } }) * 30; // 1 energy = 30 min

r = await call({ action: 'run', session: S, run: { tokenId: 7777, points: track(now - 3600e3, 12, 8) } });
ok('sneaker not owned rejected', r.code === 403, r.error);
r = await call({ action: 'run', session: S, run: { tokenId: JOG, points: track(now - 3600e3, 35, 8) } });
ok('35-min run at 8 km/h credits 30 earning minutes (1 energy)', r.code === 200 && Math.abs(r.run.coins - expected) < expected * 0.02 && r.state.energy === 0, `got ${r.run?.coins} expected ${expected.toFixed(4)} energy ${r.state?.energy} ${r.error || ''}`);
const firstCoins = r.run.coins;
ok('realistic run: trust ≥ 70, earnings held 24 h (not spendable yet)', r.run.trust >= 70 && r.run.status === 'held' && r.state.balance === 0 && Math.abs(r.state.pending - firstCoins) < 1e-6, JSON.stringify({ trust: r.run.trust, reasons: r.run.reasons, status: r.run.status, bal: r.state.balance }));
r = await call({ action: 'run', session: S, run: { tokenId: JOG, points: track(now - 3600e3, 35, 8) } });
ok('replayed run rejected', r.code === 409, r.error);
r = await call({ action: 'run', session: S, run: { tokenId: JOG, points: track(now - 1200e3, 10, 8) } });
ok('no energy left → earns ~0 (only seconds of refill)', r.code === 200 && r.run.coins < 0.01, JSON.stringify(r.run || r));

// energy refills over time: fake by editing clock? use a second user with fresh energy instead
const U2_KEY = rnd(), U2 = eth.addressOfKey(U2_KEY);
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [USER]: [JOG, TEMPO], [U2]: [JOG, TEMPO] });
const m2 = sessionMessage(U2, iso());
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

// 24 hours later the held earnings become usable
advance(24 * 3600e3 + 60e3);
r = await call({ action: 'state', session: S });
ok('after 24 h the earnings are released', Math.abs(r.balance - firstCoins) < 0.01 && r.pending === 0, JSON.stringify({ bal: r.balance, pending: r.pending }));
// spending: level up until the balance runs out
let levels = 0, spentNow = 0;
for (;;) {
  const cost = rules.levelUpCost({ level: levels });
  r = await call({ action: 'levelup', session: S, tokenId: JOG });
  if (r.code !== 200) { ok(`level ${levels + 1} (${cost}) rejected only when unaffordable`, /Not enough/.test(r.error) && firstCoins - spentNow < cost, r.error); break; }
  levels++; spentNow += cost;
}
ok(`a 30-min Common run pays for ${levels} level-ups (default prices)`, levels >= 4 && levels <= 6, String(levels));
const PTS = levels * rules.POINTS_PER_LEVEL[jog.rarity];
r = await call({ action: 'allocate', session: S, tokenId: JOG, add: { efficiency: PTS + 1 } });
ok('allocating more points than unspent rejected', r.code === 400, r.error);
r = await call({ action: 'allocate', session: S, tokenId: JOG, add: { efficiency: PTS - 1, resilience: 1 } });
ok('allocating points works', r.code === 200 && r.sneakers[JOG].points.efficiency === PTS - 1 && r.sneakers[JOG].unspent === 0);
// claims
r = await call({ action: 'claim', session: S });
const c = r.claim;
ok('claim signed', r.code === 200 && c && Math.abs(Number(BigInt(c.totalEarned)) / 1e18 - (firstCoins - spentNow)) < 0.01, JSON.stringify(r).slice(0, 200));
const digest = eth.claimDigest({ token: c.contract, chainId: c.chainId, account: USER, totalWei: BigInt(c.totalEarned), deadline: c.deadline });
const sigHex = c.r + c.s.slice(2) + c.v.toString(16);
ok('claim signature recovers to server key', eth.recoverAddress(digest, sigHex) === eth.addressOfKey(SERVER_KEY));
ok('lock claim is signed as a lock (instant = false)', c.instant === false && eth.recoverAddress(eth.claimDigest({ token: c.contract, chainId: c.chainId, account: USER, totalWei: BigInt(c.totalEarned), deadline: c.deadline, instant: true }), sigHex) !== eth.addressOfKey(SERVER_KEY));
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
const m3 = sessionMessage(U3, iso());
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
const budgetKey = `rw:budget:${rules.utcDay(now - 3000e3 + 10 * 60e3)}`;
const used = Number((await storeMod.get(budgetKey)) || 0);
await storeMod.incrBy(budgetKey, 5_000_000 * 1e6 - used - 1e6);
const U4_KEY = rnd(), U4 = eth.addressOfKey(U4_KEY);
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [USER]: [JOG, TEMPO], [U2]: [JOG, TEMPO], [U3]: [JOG2], [U4]: [TEMPO + 1000] });
const m4 = sessionMessage(U4, iso());
const S4 = (await call({ action: 'session', address: U4, message: m4, signature: await signPersonal(U4_KEY, m4) })).session;
r = await call({ action: 'run', session: S4, run: { tokenId: TEMPO + 1000, points: track(now - 3000e3, 10, 12) } });
ok('costs halve with emission (level-up at 50%)', rules.levelUpCost({ level: 0 }, 0.5) === rules.levelUpCost({ level: 0 }) / 2 && rules.repairCost({ level: 0, durability: 50 }, 0.5) === rules.repairCost({ level: 0, durability: 50 }) / 2);
ok('default level costs 1,100 × level^1.5', rules.levelUpCost({ level: 0 }) === 1100 && rules.levelUpCost({ level: 9 }) === 34785 && rules.levelUpCost({ level: 29 }) === 180748);
ok('points per level 1/1/2/2', JSON.stringify(rules.POINTS_PER_LEVEL) === JSON.stringify({ common: 1, uncommon: 1, rare: 2, epic: 2 }));
ok('energy table 1/2/4/6/10', [1, 2, 3, 9, 15, 30].map(rules.maxEnergy).join() === '1,1,2,4,6,10');
ok('Common lasts ~9 days of 1 energy/day before 50% durability', Math.round(50 / rules.durabilityLossPerEnergy({ base: { efficiency: 6, resilience: 6 }, points: {}, durability: 100 })) === 9);
ok('global daily budget: run capped at what is left (1 RUNNER)', r.code === 200 && r.run.capped && Math.abs(r.run.coins - 1) < 1e-6, JSON.stringify(r.run || r));
ok('budget never exceeded', Number(await storeMod.get(budgetKey)) === 5_000_000 * 1e6);
advance(24 * 3600e3 + 60e3); // U3's earnings released
// partial claim: only 2 RUNNER left in today's on-chain emission
const limitWei = 5_000_000n * 10n ** 18n;
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: TODAY - 30, claimedToday: String(limitWei - 2n * 10n ** 18n), claimed: {} });
r = await call({ action: 'claim', session: S3, instant: true });
{
  const k = r.claim, sh = k.r + k.s.slice(2) + k.v.toString(16);
  ok('instant claim is signed as instant', k.instant === true && eth.recoverAddress(eth.claimDigest({ token: k.contract, chainId: k.chainId, account: k.account, totalWei: BigInt(k.totalEarned), deadline: k.deadline, instant: true }), sh) === eth.addressOfKey(SERVER_KEY));
}
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
// ---- game settings (admin), boosts, per-runner cap, schedule changes
const settingsCall = async (key, settings, issued = iso()) => {
  const message = settingsMessage(JSON.stringify(settings), issued);
  return call({ action: 'settings-set', settings, message, signature: await signPersonal(key, message) });
};
const BOOST = '0x' + '77'.repeat(20);
const newSettings = { levelCostBase: 2000, levelCostExp: 2, perRunnerDailyMax: 0, boosts: [{ contract: BOOST, label: 'Season 2', boostBps: 1000 }] };
ok('settings: non-admin signature rejected', (await settingsCall(USER_KEY, newSettings)).code === 403);
ok('settings: old message rejected', (await settingsCall(ADMIN_KEY, newSettings, new Date(Date.now() - 3600e3).toISOString())).code === 400);
ok('settings: invalid values rejected', (await settingsCall(ADMIN_KEY, { ...newSettings, levelCostExp: 9 })).code === 400);
r = await settingsCall(ADMIN_KEY, newSettings);
ok('settings: admin saves level prices and boosts', r.code === 200 && r.settings.levelCostBase === 2000 && r.settings.boosts[0].boostBps === 1000, JSON.stringify(r));
ok('status reports the settings', (await call({ action: 'status' }, 'GET')).settings.levelCostExp === 2);
// boost: U5 holds a Season 2 NFT → +10%
let JOG3 = 0;
for (let i = JOG2 + 1; i < 900 && !JOG3; i++) if (traitsFor(i).type === 'jogger') JOG3 = i;
const U5_KEY = rnd(), U5 = eth.addressOfKey(U5_KEY);
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: TODAY, claimedToday: '0', claimed: {} });
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [U5]: [JOG3] });
process.env.REWARDS_FAKE_HELD = JSON.stringify({ [U5]: [BOOST] });
const m5 = sessionMessage(U5, iso());
const S5 = (await call({ action: 'session', address: U5, message: m5, signature: await signPersonal(U5_KEY, m5) })).session;
const st5 = await call({ action: 'state', session: S5 });
ok('state reports the boost (×1.1)', Math.abs(st5.boost - 1.1) < 1e-9);
const jog3 = traitsFor(JOG3);
const exp3 = rules.earnPerMinute({ ...jog3, durability: 100, points: { efficiency: 0, resilience: 0 } }) * 30 * 1.1;
r = await call({ action: 'run', session: S5, run: { tokenId: JOG3, points: track(now - 9000e3, 35, 8) } });
ok('NFT boost adds 10% to the run', r.code === 200 && Math.abs(r.run.coins - exp3) < exp3 * 0.02 && Math.abs(r.run.boost - 1.1) < 1e-9, `got ${r.run?.coins} expected ${exp3.toFixed(1)}`);
advance(24 * 3600e3 + 60e3); // U5's earnings released
r = await call({ action: 'levelup', session: S5, tokenId: JOG3 });
ok('new level price applies right away (2,000 for level 1)', r.code === 200 && Math.abs(r.spent - 2000) < 1e-6, JSON.stringify(r).slice(0, 120));
// per-runner daily max: 500 RUNNER at a 10M day
await settingsCall(ADMIN_KEY, { ...newSettings, perRunnerDailyMax: 500, boosts: [] });
const U6_KEY = rnd(), U6 = eth.addressOfKey(U6_KEY);
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [U6]: [JOG3 + 2] });
const m6 = sessionMessage(U6, iso());
const S6 = (await call({ action: 'session', address: U6, message: m6, signature: await signPersonal(U6_KEY, m6) })).session;
r = await call({ action: 'run', session: S6, run: { tokenId: JOG3 + 2, points: track(now - 9000e3, 35, 8) } });
ok('per-runner daily max caps a runner at 500', r.code === 200 && r.run.capped && Math.abs(r.run.coins - 500) < 1e-6, JSON.stringify(r.run || r));
// a changed on-chain schedule (20M/day today) doubles the earn rate
const D = rules.utcDay();
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: D - 40, current: { dailyStart: 20_000_000, floor: 100_000, halvingDays: 30, fromDay: D }, next: null, claimedToday: '0', claimed: {} });
const st6 = await call({ action: 'state', session: S6 });
ok('schedule change: 20M today → earn rate 200%', st6.emission.limit === 20_000_000 && st6.emission.factor === 2);
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: D - 40, current: { dailyStart: 10_000_000, floor: 100_000, halvingDays: 30, fromDay: D - 40 }, next: { dailyStart: 2_000_000, floor: 0, halvingDays: 60, fromDay: D + 1 }, claimedToday: '0', claimed: {} });
const st7 = await call({ action: 'state', session: S6 });
ok('a pending schedule is reported for the app', st7.emission.change?.dailyStart === 2_000_000 && st7.emission.change.fromDay === D + 1 && st7.emission.limit === 5_000_000);
await settingsCall(ADMIN_KEY, rules.DEFAULT_SETTINGS);
process.env.REWARDS_FAKE_TOKEN = JSON.stringify({ startDay: rules.utcDay() - 1, claimedToday: '0', claimed: {} });

// ---- fair play: trust score, automatic rules, strikes, suspensions, rate limits
const trust = await imp('api/_lib/trust.js');
const tReal = trust.trustScore(track(now - 4000e3, 30, 8));
const tFake = trust.trustScore(track(now - 4000e3, 30, 8, { perfect: true }));
ok('trust: realistic track scores high', tReal.score >= 90, JSON.stringify(tReal));
ok('trust: scripted track (exact timing, constant speed, straight line) scores low', tFake.score < 40 && tFake.reasons.length >= 3, JSON.stringify(tFake));
const J = []; // five Daily Runner sneakers for these tests
for (let i = 1200; i < 3000 && J.length < 5; i++) if (traitsFor(i).type === 'jogger') J.push(i);
const FT = J[0];
const C_KEY = rnd(), CH = eth.addressOfKey(C_KEY), H_KEY = rnd(), HO = eth.addressOfKey(H_KEY);
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [CH]: [J[0], J[1], J[2]], [HO]: [J[3], J[4]], [USER]: [JOG, TEMPO] });
const sess = async (key, addr) => { const m = sessionMessage(addr, iso()); return (await call({ action: 'session', address: addr, message: m, signature: await signPersonal(key, m) })).session; };
const SC = await sess(C_KEY, CH), SH = await sess(H_KEY, HO);
// Automatic rules: trust ≥ 70 paid · 40–69 half paid · < 40 / fake GPS / copied route → not paid + strike;
// 3 strikes in 30 days → suspended 7 days (then 30, then permanent), earnings on hold forfeited.
const base = now - 20 * 3600e3;
r = await call({ action: 'run', session: SC, run: { tokenId: J[2], points: track(base, 35, 8) } });
const cheaterHeld = r.run?.coins;
ok('rules: honest run → paid in full, held 24 h', r.code === 200 && r.run.decision === 'paid' && r.run.status === 'held' && cheaterHeld > 0, JSON.stringify({ d: r.run?.decision, t: r.run?.trust }));
r = await call({ action: 'run', session: SC, run: { tokenId: J[0], points: track(base + 3600e3, 35, 8, { perfect: true }) } });
ok('rules: scripted run (trust < 40) → not paid + strike 1/3', r.code === 200 && r.run.decision === 'voided' && r.run.coins === 0 && r.run.strike && r.state.strikes === 1 && r.run.status === 'voided', JSON.stringify({ d: r.run?.decision, t: r.run?.trust, s: r.state?.strikes }));
const honest = track(base + 2 * 3600e3, 35, 8);
r = await call({ action: 'run', session: SH, run: { tokenId: J[3], points: honest } });
ok('rules: someone else\'s honest run is paid', r.code === 200 && r.run.decision === 'paid');
r = await call({ action: 'run', session: SC, run: { tokenId: J[1], points: honest.map((p) => ({ ...p, t: p.t + 3600e3 })) } });
ok('rules: copied route → not paid + strike 2/3 (whatever the score)', r.code === 200 && r.run.decision === 'voided' && r.run.reasons.some((x) => /Same route/.test(x)) && r.state.strikes === 2, JSON.stringify(r.run?.reasons));
// a run whose GPS timing is too regular but otherwise real → trust ~65 → half paid, no strike
const odd = track(base + 4 * 3600e3, 35, 8).map((p, i, arr) => ({ ...p, t: arr[0].t + i * 2000 }));
const B_KEY = rnd(), BW = eth.addressOfKey(B_KEY);
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [CH]: [J[0], J[1], J[2]], [HO]: [J[3]], [BW]: [J[4]], [USER]: [JOG, TEMPO] });
const SB = await sess(B_KEY, BW);
r = await call({ action: 'run', session: SB, run: { tokenId: J[4], points: odd } });
const fullOdd = rules.earnPerMinute({ ...traitsFor(J[4]), durability: 100, points: { efficiency: 0, resilience: 0 } }) * 30;
ok('rules: borderline run (trust 40–69) → 50% paid, no strike', r.code === 200 && r.run.decision === 'partial' && r.run.payPct === 50 && Math.abs(r.run.coins - fullOdd / 2) < fullOdd * 0.03 && !r.run.strike && r.state.strikes === 0, JSON.stringify({ d: r.run?.decision, t: r.run?.trust, c: r.run?.coins, full: fullOdd }));
r = await call({ action: 'run', session: SC, run: { tokenId: J[2], points: track(base + 5 * 3600e3, 35, 8, { perfect: true }) } });
ok('rules: 3rd strike → suspended 7 days automatically, held earnings forfeited', r.code === 200 && r.run.status === 'suspended' && r.run.suspendedUntil > Date.now() + 6.9 * 864e5 && r.run.suspendedUntil < Date.now() + 7.1 * 864e5 && r.state.pending === 0, JSON.stringify({ st: r.run?.status, u: r.run?.suspendedUntil, p: r.state?.pending }));
ok('suspended wallet can\'t upload runs (message says until when)', await (async () => { const x = await call({ action: 'run', session: SC, run: { tokenId: J[1], points: track(base + 6 * 3600e3, 20, 8) } }); return x.code === 403 && /until/.test(x.error); })());
ok('suspended wallet can\'t claim', (await call({ action: 'claim', session: SC })).code === 403);
ok('suspended wallet can\'t spend', (await call({ action: 'levelup', session: SC, tokenId: FT })).code === 403);
// admin: read-only log + manual bans
const adminSess = async (key) => { const a = eth.addressOfKey(key); const m = adminMessage(a, iso()); return call({ action: 'admin-session', address: a, message: m, signature: await signPersonal(key, m) }); };
ok('only the dev wallet can open the fair-play admin', (await adminSess(USER_KEY)).code === 403);
const AS = (await adminSess(ADMIN_KEY)).session;
ok('a normal session can\'t use admin actions', (await call({ action: 'admin', session: SC, op: 'log' })).code === 403);
r = await call({ action: 'admin', session: AS, op: 'log' });
ok('fair-play log shows partial, voided and suspended decisions', r.code === 200 && ['partial', 'voided', 'suspended'].every((o) => r.log.some((x) => x.outcome === o)) && r.bans.some((b) => b.address === CH && b.auto && b.until), JSON.stringify(r).slice(0, 240));
ok('no approve/void work for admins any more', (await call({ action: 'admin', session: AS, op: 'approve', address: CH, id: 'x' })).code === 400);
advance(7 * 864e5 + 60e3);
ok('suspension ends by itself after 7 days', (await call({ action: 'levelup', session: SC, tokenId: FT })).code !== 403);
ok('admin sessions expire after 12 h', (await call({ action: 'admin', session: AS, op: 'log' })).code === 401);
const AS2 = (await adminSess(ADMIN_KEY)).session;
r = await call({ action: 'admin', session: AS2, op: 'ban', address: CH, reason: 'Manual', days: 1 });
const afterBan = await call({ action: 'claim', session: SC });
ok('manual ban (1 day) blocks the wallet', r.code === 200 && afterBan.code === 403, JSON.stringify({ ban: r, claim: afterBan }));
await call({ action: 'admin', session: AS2, op: 'unban', address: CH });
ok('unban restores access', (await call({ action: 'claim', session: SC })).code !== 403);
ok('fair-play rules are settings with validation', (await settingsCall(ADMIN_KEY, { ...rules.DEFAULT_SETTINGS, fairPlay: { ...rules.DEFAULT_SETTINGS.fairPlay, voidBelowTrust: 90 } })).code === 400);
// rate limits
let limited = false;
for (let i = 0; i < 25 && !limited; i++) {
  const m = sessionMessage(HO, iso());
  const rr = await call({ action: 'session', address: HO, message: m, signature: await signPersonal(H_KEY, m) }, 'POST', '192.168.9.9');
  if (rr.code === 429) limited = i >= 20;
}
ok('rate limit: more than 20 sign-ins an hour from one IP → 429', limited);
let runLimited = false;
for (let i = 0; i < 35 && !runLimited; i++) {
  const rr = await call({ action: 'run', session: SH, run: { tokenId: J[4], points: [{ t: now - 1000, lat: 1, lon: 1 }, { t: now - 900, lat: 1, lon: 1.00001 }] } });
  if (rr.code === 429) runLimited = i >= 29;
}
ok('rate limit: more than 30 run uploads an hour per wallet → 429', runLimited);
// ---- step cadence + device attestation (Play Integrity / App Attest)
const { runDigest } = await imp('api/_lib/attest.js');
// steps: cumulative samples every ~5 s at `spm` steps/min over a track's time span
const stepsFor = (pts, spm) => {
  const out = [];
  for (let t = pts[0].t, n = 0; t <= pts[pts.length - 1].t; t += 5000, n += spm / 12) out.push([t, Math.round(n)]);
  out.push([pts[pts.length - 1].t, Math.round(((pts[pts.length - 1].t - pts[0].t) / 60e3) * spm)]);
  return { samples: out };
};
const runTrack = track(now - 4000e3, 30, 8);
const tRun = trust.trustScore(runTrack, { steps: stepsFor(runTrack, 165), fromApp: true });
ok('cadence: 165 steps/min at 8 km/h → no penalty', tRun.score >= 90 && Math.abs(tRun.cadence - 165) <= 3, JSON.stringify(tRun));
const tBike = trust.trustScore(runTrack, { steps: stepsFor(runTrack, 4), fromApp: true });
ok('cadence: moving with ~0 steps (bike/scooter/car) → under review threshold', tBike.score < 70 && tBike.reasons.some((x) => /Steps don't match/.test(x)), JSON.stringify(tBike));
const fastTrack = track(now - 4000e3, 30, 11);
const tShuffle = trust.trustScore(fastTrack, { steps: stepsFor(fastTrack, 100), fromApp: true });
ok('cadence: walking cadence (100/min) at 11 km/h running pace → flagged', tShuffle.score < 70, JSON.stringify(tShuffle));
const tHalf = (() => { const s = stepsFor(runTrack, 165).samples; const mid = s[Math.floor(s.length * 0.6)][1]; return trust.trustScore(runTrack, { steps: { samples: s.map(([t, n], i) => [t, Math.min(n, mid)]) }, fromApp: true }); })();
ok('cadence: steps stop for the last 40% → partial penalty', tHalf.score >= 70 && tHalf.score < 90 && tHalf.reasons.some((x) => /part of the run/.test(x)), JSON.stringify(tHalf));
ok('cadence: app run without step data → small penalty, not reviewed', trust.trustScore(runTrack, { fromApp: true }).score === 85 && trust.trustScore(runTrack, { steps: { denied: true }, fromApp: true }).score === 85);
ok('cadence: website run without step data → no penalty', trust.trustScore(runTrack).score === tReal.score || trust.trustScore(runTrack).score >= 90);
ok('mock-location fixes → low trust', trust.trustScore(runTrack, { steps: stepsFor(runTrack, 165), mockFixes: 3, fromApp: true }).score < 70);
ok('step data: decreasing counts rejected as lost', trust.cleanSteps({ samples: [[1, 5], [2, 3]] }, 0, 10).lost === true);

const K = []; // fresh Daily Runner sneakers for these tests
for (let i = 3000; i < 6000 && K.length < 6; i++) if (traitsFor(i).type === 'jogger') K.push(i);
const D_KEY = rnd(), DW = eth.addressOfKey(D_KEY), A_KEY = rnd(), AW = eth.addressOfKey(A_KEY), I_KEY = rnd(), IW = eth.addressOfKey(I_KEY);
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [DW]: [K[0]], [AW]: [K[1], K[2]], [IW]: [K[3], K[4]] });
const SD = await sess(D_KEY, DW), SA = await sess(A_KEY, AW), SI = await sess(I_KEY, IW);
// a bike ride from the app (steps ≈ 0) is half paid, not voided
const bikePts = track(now - 9000e3, 35, 8);
r = await call({ action: 'run', session: SD, run: { tokenId: K[0], points: bikePts, steps: stepsFor(bikePts, 2), attestation: { platform: 'android', error: 'not set up' } } });
ok('server: app run with ~0 steps → half paid with a cadence reason (no strike)', r.code === 200 && r.run.decision === 'partial' && !r.run.strike && r.run.coins > 0 && r.run.reasons.some((x) => /Steps don't match/.test(x)) && r.run.device === 'android', JSON.stringify(r.run || r));

// requireAttestation
ok('requireAttestation can\'t be switched on before Google/Apple are set up', (await settingsCall(ADMIN_KEY, { ...rules.DEFAULT_SETTINGS, requireAttestation: true })).code === 400);
const TEAM = 'ABCDE12345';
process.env.APPLE_TEAM_ID = TEAM;
process.env.REWARDS_FAKE_INTEGRITY = JSON.stringify({});
r = await settingsCall(ADMIN_KEY, { ...rules.DEFAULT_SETTINGS, requireAttestation: true });
ok('settings: requireAttestation switched on', r.code === 200 && r.settings.requireAttestation === true, JSON.stringify(r));
const st8 = await call({ action: 'status' }, 'GET');
ok('status reports the setting and which phones can be verified', st8.settings.requireAttestation && st8.attestation.android && st8.attestation.ios);
const energyBefore = (await call({ action: 'state', session: SA })).energy;
const webRun = { tokenId: K[1], points: track(now - 8000e3, 20, 8) };
r = await call({ action: 'run', session: SA, run: webRun });
ok('website run (no device proof) → no RUNNER, clear message', r.code === 403 && /phone app/.test(r.error), r.error);
ok('rejected run uses no energy', (await call({ action: 'state', session: SA })).energy === energyBefore);

// Android: Play Integrity (Google's decoded verdict is faked via REWARDS_FAKE_INTEGRITY)
const verdict = (run, { app = 'PLAY_RECOGNIZED', device = ['MEETS_DEVICE_INTEGRITY'], pkg = 'fun.runearn.app', age = 0, nonce } = {}) => ({
  requestDetails: { requestPackageName: pkg, nonce: nonce ?? runDigest(rules.runPayload(run)), timestampMillis: String(Date.now() - age) },
  appIntegrity: { appRecognitionVerdict: app, packageName: pkg }, deviceIntegrity: { deviceRecognitionVerdict: device },
});
const fakes = {};
const androidRun = (pts, opts, token = `tok${Object.keys(fakes).length}`) => {
  const run = { tokenId: K[1], points: pts, steps: stepsFor(pts, 165), mockFixes: 0 };
  fakes[token] = verdict(run, opts);
  process.env.REWARDS_FAKE_INTEGRITY = JSON.stringify(fakes);
  return { ...run, attestation: { platform: 'android', token } };
};
const aPts = track(now - 7000e3, 35, 8);
r = await call({ action: 'run', session: SA, run: androidRun(aPts, { app: 'UNRECOGNIZED_VERSION' }) });
ok('Android: sideloaded / modified app → rejected', r.code === 403 && /Google Play/.test(r.error), r.error);
r = await call({ action: 'run', session: SA, run: androidRun(aPts, { device: [] }) });
ok('Android: rooted phone or emulator (no MEETS_DEVICE_INTEGRITY) → rejected', r.code === 403 && /integrity/.test(r.error), r.error);
r = await call({ action: 'run', session: SA, run: androidRun(aPts, { age: 3600e3 }) });
ok('Android: old token → rejected', r.code === 403 && /too old/.test(r.error), r.error);
r = await call({ action: 'run', session: SA, run: androidRun(aPts, { nonce: runDigest('another run') }) });
ok('Android: token made for a different run → rejected', r.code === 403 && /belong/.test(r.error), r.error);
const tampered = androidRun(aPts);
r = await call({ action: 'run', session: SA, run: { ...tampered, points: tampered.points.map((p) => ({ ...p, lat: p.lat + 0.0001 })) } });
ok('Android: run edited after the token was made → rejected', r.code === 403 && /belong/.test(r.error), r.error);
r = await call({ action: 'run', session: SA, run: { ...webRun, attestation: { platform: 'android', token: 'not-a-real-token' } } });
ok('Android: invalid token → rejected', r.code === 403 && /Invalid/.test(r.error), r.error);
r = await call({ action: 'run', session: SA, run: androidRun(aPts) });
ok('Android: genuine app on a genuine phone → credited, marked attested', r.code === 200 && r.run.coins > 0 && r.run.attested === true && r.run.device === 'android' && r.run.cadence > 150 && r.run.status === 'held', JSON.stringify(r.run || r));

// iPhone: App Attest, with a test certificate chain standing in for Apple's
const { execFileSync } = await import('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const nodeCrypto = await import('node:crypto');
const dir = mkdtempSync(`${tmpdir()}/runner-aa-`);
const ossl = (...a) => execFileSync('openssl', a, { cwd: dir, stdio: 'pipe' });
ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key');
ossl('req', '-x509', '-new', '-key', 'root.key', '-subj', '/CN=Test App Attestation Root', '-days', '30', '-out', 'root.pem');
ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'ca.key');
ossl('req', '-new', '-key', 'ca.key', '-subj', '/CN=Test App Attestation CA', '-out', 'ca.csr');
ossl('x509', '-req', '-in', 'ca.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-set_serial', '2', '-days', '30', '-out', 'ca.pem');
process.env.REWARDS_TEST_APPLE_ROOT = readFileSync(`${dir}/root.pem`, 'utf8');
const sha = (...p) => { const h = nodeCrypto.createHash('sha256'); p.forEach((x) => h.update(x)); return h.digest(); };
const cb = (v) => { // tiny CBOR encoder
  const head = (mj, n) => (n < 24 ? Buffer.from([mj << 5 | n]) : n < 256 ? Buffer.from([mj << 5 | 24, n]) : Buffer.from([mj << 5 | 25, n >> 8, n & 255]));
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cb)]);
  if (typeof v === 'number') return head(0, v);
  const ks = Object.keys(v); return Buffer.concat([head(5, ks.length), ...ks.flatMap((k) => [cb(k), cb(v[k])])]);
};
const rpId = (team = TEAM) => sha(`${team}.fun.runearn.app`);
// A new iPhone key + its attestation over `clientDataHash` (what DCAppAttestService.attestKey returns).
const newIosKey = (clientDataHash, { team = TEAM, aaguid = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]) } = {}) => {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const point = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  const id = sha(point);
  const authData = Buffer.concat([rpId(team), Buffer.from([0x40]), Buffer.alloc(4), aaguid, Buffer.from([0, 32]), id, Buffer.from('a50102032620012158', 'hex')]);
  const nonce = sha(authData, clientDataHash);
  writeFileSync(`${dir}/leaf.key`, privateKey.export({ type: 'sec1', format: 'pem' }));
  writeFileSync(`${dir}/ext.cnf`, `[v]\n1.2.840.113635.100.8.2 = DER:${['30', '24', 'a1', '22', '04', '20', ...nonce.toString('hex').match(/../g)].join(':')}\n`);
  ossl('req', '-new', '-key', 'leaf.key', '-subj', '/CN=leaf', '-out', 'leaf.csr');
  ossl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', '3', '-days', '30', '-extfile', 'ext.cnf', '-extensions', 'v', '-out', 'leaf.pem');
  const der = (f) => new nodeCrypto.X509Certificate(readFileSync(`${dir}/${f}`)).raw;
  const attestation = cb({ fmt: 'apple-appattest', attStmt: { x5c: [der('leaf.pem'), der('ca.pem')], receipt: Buffer.alloc(0) }, authData }).toString('base64');
  return { keyId: id.toString('base64'), privateKey, attestation, counter: 0 };
};
const assertion = (key, clientDataHash, counter = ++key.counter, team = TEAM) => {
  const authData = Buffer.concat([rpId(team), Buffer.from([0x40]), Buffer.from([counter >>> 24, (counter >> 16) & 255, (counter >> 8) & 255, counter & 255])]);
  return cb({ signature: nodeCrypto.sign('sha256', Buffer.concat([authData, clientDataHash]), key.privateKey), authenticatorData: authData }).toString('base64');
};
const iosRun = (tokenId, pts) => { const run = { tokenId, points: pts, steps: stepsFor(pts, 165), mockFixes: 0 }; return { run, cdh: sha(runDigest(rules.runPayload(run))) }; };
let x = iosRun(K[3], track(now - 7000e3, 30, 8));
const devKey = newIosKey(x.cdh, { aaguid: Buffer.from('appattestdevelop') });
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: devKey.keyId, attestation: devKey.attestation } } });
ok('iPhone: development (Xcode) build key → rejected', r.code === 403 && /development build/.test(r.error), r.error);
const wrongTeam = newIosKey(x.cdh, { team: 'ZZZZZ99999' });
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: wrongTeam.keyId, attestation: wrongTeam.attestation } } });
ok('iPhone: key made for another developer\'s app → rejected', r.code === 403 && /different app/.test(r.error), r.error);
const otherRun = iosRun(K[3], track(now - 7000e3, 30, 8));
const misbound = newIosKey(otherRun.cdh);
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: misbound.keyId, attestation: misbound.attestation } } });
ok('iPhone: attestation for a different run → rejected', r.code === 403 && /belong/.test(r.error), r.error);
const savedRoot = process.env.REWARDS_TEST_APPLE_ROOT;
process.env.REWARDS_TEST_APPLE_ROOT = readFileSync(`${dir}/ca.pem`, 'utf8'); // chain no longer ends at the trusted root
const ik = newIosKey(x.cdh);
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: ik.keyId, attestation: ik.attestation } } });
ok('iPhone: certificate chain not from Apple → rejected', r.code === 403 && /not from Apple/.test(r.error), r.error);
process.env.REWARDS_TEST_APPLE_ROOT = savedRoot;
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: ik.keyId, attestation: ik.attestation } } });
ok('iPhone: first run from a genuine install (attestation) → credited, key registered', r.code === 200 && r.run.attested === true && r.run.device === 'ios' && r.run.coins > 0, JSON.stringify(r.run || r));
x = iosRun(K[4], track(now - 3000e3, 20, 8));
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: ik.keyId, attestation: ik.attestation } } });
ok('iPhone: attestation can\'t be reused', r.code === 403, r.error);
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: ik.keyId, assertion: assertion(ik, sha('something else')) } } });
ok('iPhone: assertion signed over a different run → rejected', r.code === 403 && /belong/.test(r.error), r.error);
const unknown = nodeCrypto.randomBytes(32).toString('base64');
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: unknown, assertion: assertion(ik, x.cdh) } } });
ok('iPhone: unknown key → 412 so the app makes a new key', r.code === 412, r.error);
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: ik.keyId, assertion: assertion(ik, x.cdh) } } });
ok('iPhone: later run signed with the registered key (assertion) → credited', r.code === 200 && r.run.attested === true, JSON.stringify(r.run || r));
r = await call({ action: 'run', session: SI, run: { ...x.run, attestation: { platform: 'ios', keyId: ik.keyId, assertion: assertion(ik, x.cdh, ik.counter) } } });
ok('iPhone: replayed assertion counter → rejected', r.code === 403 && /already used/.test(r.error), r.error);
r = await settingsCall(ADMIN_KEY, rules.DEFAULT_SETTINGS);
r = await call({ action: 'run', session: SA, run: { tokenId: K[2], points: track(now - 1500e3, 15, 8) } });
ok('requireAttestation off → website runs earn again (unverified)', r.code === 200 && r.run.attested === null && r.run.device === null, JSON.stringify(r.run || r));
delete process.env.APPLE_TEAM_ID; delete process.env.REWARDS_FAKE_INTEGRITY; delete process.env.REWARDS_TEST_APPLE_ROOT;
process.env.REWARDS_FAKE_OWNED = JSON.stringify({ [USER]: [JOG, TEMPO] });
// public stats for the front page
{
  process.env.REWARDS_FAKE_HOLDER_IMD = '24.85';
  const sv = await call({ action: 'stats' }, 'GET');
  const fake = JSON.parse(process.env.REWARDS_FAKE_TOKEN);
  const keys = []; for (let d = fake.startDay; d <= rules.utcDay(); d++) keys.push(`rw:budget:${d}`);
  const expected = (await storeMod.mget(keys)).reduce((t, v) => t + (Number(v) || 0), 0) / 1e6;
  const owned = Object.values(JSON.parse(process.env.REWARDS_FAKE_OWNED));
  ok('stats: runners = wallets holding a Genesis sneaker; RUNNER credited = the daily emission counters', sv.code === 200 && sv.runners === owned.filter((ids) => ids.length).length && sv.sneakers === owned.reduce((n, ids) => n + ids.length, 0) && sv.earned > 0 && Math.abs(sv.earned - expected) < 1e-6 && sv.since === fake.startDay, JSON.stringify(sv));
  ok('stats: IMD paid to holders and its value (IMD → ETH → USD)', sv.holderImd === 24.85 && Math.abs(sv.imdUsd - 6) < 1e-9 && Math.abs(sv.holderUsd - 24.85 * 6) < 1e-9, JSON.stringify(sv));
  ok('stats: a wallet that earned counts once however many runs it makes', sv.earners >= 2 && sv.runs > sv.earners, `${sv.earners} earners, ${sv.runs} runs`);
}
// leaderboards: verified earnings this week and all time, top first, with your own place
{
  const wk = await call({ action: 'leaderboard', period: 'week' }, 'GET');
  const all = await call({ action: 'leaderboard', period: 'all' }, 'GET');
  const sorted = (rows) => rows.every((r, i) => i === 0 || rows[i - 1].earned >= r.earned);
  ok('leaderboard: this week, highest RUNNER first, every earner listed with km', wk.code === 200 && wk.top.length >= 2 && sorted(wk.top) && wk.top[0].rank === 1 && wk.top.every((r) => r.km > 0 && /^0x[0-9a-f]{40}$/.test(r.address)), JSON.stringify(wk.top.slice(0, 3)));
  const allOf = new Map(all.top.map((r) => [r.address, r]));
  ok('leaderboard: all time includes every weekly runner with at least as much', all.code === 200 && sorted(all.top) && wk.top.every((r) => allOf.get(r.address)?.earned >= r.earned - 1e-6 && allOf.get(r.address).km >= r.km), `${wk.top.length} weekly, ${all.top.length} all-time`);
  const pick = all.top[1].address;
  const mine = await call({ action: 'leaderboard', period: 'all', address: pick }, 'GET');
  ok('leaderboard: your own place is returned', mine.me?.rank === 2 && mine.me.address === pick && mine.me.earned === all.top[1].earned, JSON.stringify(mine.me));
  ok('leaderboard: a bad period falls back to this week', (await call({ action: 'leaderboard', period: 'x' }, 'GET')).period === 'week');
}
// concurrency lock
const [a, b] = await Promise.all([call({ action: 'state', session: S }), call({ action: 'state', session: S })]);
ok('parallel requests: one waits (409) or both ok, never corrupt', [a.code, b.code].includes(200));
// in-app account deletion (App Store 5.1.1(v)): Privy access token checked, Privy user + server record deleted
{
  const { generateKeyPairSync, createSign } = await import('node:crypto');
  const { PRIVY_APP_ID } = await imp('js/config.js');
  r = await call({ action: 'delete-account', accessToken: 'x', session: S });
  ok('delete-account: refused until Privy keys are set on the server', r.code === 503, r.error);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.PRIVY_VERIFICATION_KEY = publicKey.export({ type: 'spki', format: 'pem' });
  process.env.PRIVY_APP_SECRET = 'test-secret';
  process.env.REWARDS_FAKE_PRIVY_DELETE = '1';
  const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
  const jwt = (claims, key = privateKey) => {
    const head = b64u({ alg: 'ES256', typ: 'JWT' }), body = b64u(claims);
    const sig = createSign('SHA256').update(`${head}.${body}`).sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${head}.${body}.${sig}`;
  };
  const good = { iss: 'privy.io', aud: PRIVY_APP_ID, sub: 'did:privy:test-user', exp: Math.floor(Date.now() / 1000) + 600 };
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  r = await call({ action: 'delete-account', accessToken: jwt(good, other), session: S });
  ok('delete-account: a token not signed by Privy is refused', r.code === 401, r.error);
  r = await call({ action: 'delete-account', accessToken: jwt({ ...good, aud: 'another-app' }), session: S });
  ok('delete-account: a token for another app is refused', r.code === 401, r.error);
  r = await call({ action: 'delete-account', accessToken: jwt({ ...good, exp: Math.floor(Date.now() / 1000) - 5 }), session: S });
  ok('delete-account: an expired token is refused', r.code === 401, r.error);
  const before = await storeMod.get(`rw:u:${USER.toLowerCase()}`);
  r = await call({ action: 'delete-account', accessToken: jwt(good), session: S });
  const after = await storeMod.get(`rw:u:${USER.toLowerCase()}`);
  ok('delete-account: a valid token deletes the account and the wallet\'s server record', r.code === 200 && r.deleted && r.serverRecord && before && !after, JSON.stringify(r));
  const lbAfter = await storeMod.zRank('rw:lb:all', USER.toLowerCase());
  ok('delete-account: the wallet leaves the leaderboards', lbAfter === null, JSON.stringify(lbAfter));
  delete process.env.PRIVY_VERIFICATION_KEY; delete process.env.PRIVY_APP_SECRET; delete process.env.REWARDS_FAKE_PRIVY_DELETE;
}
const fails = results.filter((x) => x.startsWith('FAIL'));
console.log(results.join('\n'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
console.log(JSON.stringify({ signer: eth.addressOfKey(SERVER_KEY), claim: c }));
