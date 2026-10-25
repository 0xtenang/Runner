// Rewards tab: holder rewards for RUNNER holders, paid in IMD.
//
// Every trade in the RUNNER/IMD pool pays 2% (in IMD) to holders. Each UTC day's
// IMD is shared by wallets that held at least 300,000 RUNNER for that whole day,
// by their lowest balance that day, and can be claimed for 7 days. Everything here
// is read straight from the token contract; claiming sends claimHolderRewards()
// from the holder's own wallet (the in-app wallet, or a browser wallet such as
// MetaMask that holds RUNNER).
import { auth, shortAddress, explorerUrl } from './auth.js';
import { TOKEN_CHAIN, TOKEN_CONTRACT, HOOK_CONTRACT, IMD_TOKEN } from './config.js';
import { waitForReceipt } from './nft.js';
import { COIN } from './game.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || '').trim());
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const E18 = 10n ** 18n;
const MIN_HOLDING = 300_000n * E18;
const CLAIM_WINDOW_DAYS = 7;
const LOOKUP_KEY = 'runner.rewards.lookup';

/** wei → number of whole tokens (display only). */
const toNum = (wei) => Number(wei / 10n ** 12n) / 1e6;
const fmtImd = (wei) => { const n = toNum(wei); return n.toLocaleString(undefined, { maximumFractionDigits: n && n < 1 ? 6 : 4 }); };
const fmtRunner = (wei) => Math.floor(toNum(wei)).toLocaleString();
const dayLabel = (d) => new Date(d * 864e5).toLocaleDateString([], { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

async function call(to, data) {
  let last;
  for (const url of TOKEN_CHAIN.rpcUrls.default.http) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return (j.result || '0x').replace(/^0x/, '');
    } catch (e) { last = e; }
  }
  throw last || new Error('Network error');
}
const w = (hex, i = 0) => BigInt(`0x${hex.slice(i * 64, (i + 1) * 64) || '0'}`);
const uint = async (to, data) => w(await call(to, data));

/** Everything the tab shows for `address`, straight from the chain. */
async function load(address) {
  const t = TOKEN_CONTRACT;
  const today = Number(await uint(t, '0x5c9302c9')); // currentDay()
  const days = [];
  for (let d = today - 1; d >= Math.max(0, today - CLAIM_WINDOW_DAYS); d--) days.push(d);
  const [balance, excluded, todayBal, claimable, eligibleSupply, totalRewards, todayInfo, pending, imdBalance, perDay] = await Promise.all([
    uint(t, `0x70a08231${addrWord(address)}`),                    // balanceOf
    uint(t, `0x57a94d2a${addrWord(address)}`),                    // excludedFromHolderRewards
    uint(t, `0x59d3cabd${addrWord(address)}${word(today)}`),      // eligibleBalanceOn(today)
    uint(t, `0x7a8afcc2${addrWord(address)}`),                    // holderClaimable
    uint(t, '0x6ade07b0'),                                        // eligibleSupply()
    uint(t, '0xca0c8045'),                                        // totalHolderRewards()
    call(t, `0x335d4c37${word(today)}`),                          // dayInfo(today)
    isAddr(HOOK_CONTRACT) ? uint(HOOK_CONTRACT, `0x2f22b8a2${addrWord(t)}`).catch(() => 0n) : 0n, // pendingHolderFees(token)
    uint(IMD_TOKEN, `0x70a08231${addrWord(address)}`).catch(() => null),
    Promise.all(days.map(async (d) => {
      const [info, bal, claimed] = await Promise.all([
        call(t, `0x335d4c37${word(d)}`),                          // dayInfo(d): shares, rewards, paidOut
        uint(t, `0x59d3cabd${addrWord(address)}${word(d)}`),      // eligibleBalanceOn(d)
        uint(t, `0x1c066478${addrWord(address)}${word(d)}`),      // holderClaimedDay(d)
      ]);
      const shares = w(info, 0), rewards = w(info, 1);
      const share = shares && rewards && bal ? (rewards * bal) / shares : 0n; // same as the contract
      return { day: d, rewards, bal, share, claimed: claimed !== 0n };
    })),
  ]);
  return { address, today, balance, excluded: excluded !== 0n, todayBal, claimable, eligibleSupply, totalRewards, todayRewards: w(todayInfo, 1), pending, imdBalance, perDay };
}

// ---------------------------------------------------------------- wallets
/** A browser wallet (MetaMask etc.) the user connected on this page, if any. */
let injected = null;

async function connectInjected() {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found. Open this page in a browser with MetaMask (or similar) installed.');
  const [from] = await eth.request({ method: 'eth_requestAccounts' });
  if (!from) throw new Error('The wallet didn\'t share an address.');
  injected = from;
  return from;
}

async function sendInjected(to, data) {
  const eth = window.ethereum;
  const chainId = `0x${TOKEN_CHAIN.id.toString(16)}`;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e) {
    if (e?.code !== 4902) throw e; // 4902: the wallet doesn't know Robinhood Chain yet
    await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: TOKEN_CHAIN.name, nativeCurrency: TOKEN_CHAIN.nativeCurrency, rpcUrls: TOKEN_CHAIN.rpcUrls.default.http, blockExplorerUrls: [TOKEN_CHAIN.blockExplorers.default.url] }] });
  }
  return eth.request({ method: 'eth_sendTransaction', params: [{ from: injected, to, data }] });
}

/** Which wallet can send transactions for `address` here (null = view only). */
function signerFor(address) {
  if (!address) return null;
  const a = address.toLowerCase();
  if (injected && injected.toLowerCase() === a) return 'injected';
  if (auth.signedIn && auth.state.address.toLowerCase() === a) return 'app';
  return null;
}
const anySigner = () => (injected ? 'injected' : auth.signedIn ? 'app' : null);

function send(kind, to, data) {
  return kind === 'injected' ? sendInjected(to, data) : auth.sendTx({ to, data, chainId: TOKEN_CHAIN.id });
}

// ---------------------------------------------------------------- view
export function renderRewards(view, { toast, onCleanup }) {
  let data = null, error = null, loadingFor = null, busy = false;
  let lookup = '';
  try { lookup = localStorage.getItem(LOOKUP_KEY) || ''; } catch {}
  let override = null; // an address looked up while signed in, shown until the tab is left

  /** The address being shown: a looked-up one, a connected browser wallet, the in-app wallet, or the last lookup. */
  const current = () => override || injected || (auth.signedIn ? auth.state.address : null) || (isAddr(lookup) ? lookup : null);
  let shown = current();

  async function refresh() {
    const a = current();
    shown = a;
    if (!TOKEN_CONTRACT || !a) { data = null; draw(); return; }
    loadingFor = a; error = null; draw();
    try {
      const d = await load(a);
      if (current() === a) data = d;
    } catch (e) { error = e.message || String(e); }
    if (loadingFor === a) loadingFor = null;
    draw();
  }

  function walletCard() {
    const a = current();
    const kind = signerFor(a);
    const who = !a ? 'No wallet chosen' : kind === 'injected' ? 'Browser wallet' : kind === 'app' ? 'Your RUNNER wallet' : 'Looking up';
    return `<div class="card rw-wallet">
      <div class="row between" style="gap:10px;flex-wrap:wrap">
        <div><span class="lbl">${who}</span>${a ? `<a class="mono small" href="${explorerUrl(a)}" target="_blank" rel="noopener">${shortAddress(a)}</a>` : '<span class="muted small">Sign in, connect a wallet, or look up an address.</span>'}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${!auth.signedIn && !injected ? `<button class="btn pill sm" data-act="signin">Sign in</button>` : ''}
          ${window.ethereum && !injected ? '<button class="btn pill sm" data-act="connect">Connect browser wallet</button>' : ''}
          ${injected || override ? `<button class="btn pill sm ghost" data-act="disconnect">${auth.signedIn ? 'Back to my wallet' : 'Clear'}</button>` : ''}
        </div>
      </div>
      <form class="rw-lookup" data-form="lookup">
        <input name="addr" placeholder="Check any address: 0x…" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(override || (!injected && !auth.signedIn ? lookup : ''))}">
        <button class="btn sm">Check</button>
      </form>
    </div>`;
  }

  function howCard() {
    return `<div class="card">
      <h4>How holder rewards work</h4>
      <ul class="rw-how">
        <li>Every trade in the RUNNER/IMD pool pays <b>4% in IMD</b>: <b>2% to holders</b>, 2% to the protocol.</li>
        <li>Hold at least <b>300,000 ${COIN}</b> for a <b>whole UTC day</b> (00:00–24:00 UTC). Your share of that day's IMD is your lowest balance that day ÷ all qualifying balances.</li>
        <li>Each day's reward can be claimed from the next day, for <b>7 days</b>. After that it goes to the protocol.</li>
        <li>Claiming sends the IMD to the wallet that holds the RUNNER (a little ETH pays the network fee).</li>
      </ul>
    </div>`;
  }

  function draw() {
    if (!TOKEN_CONTRACT) {
      view.innerHTML = `<section class="page">
        <div class="card rw-hero">
          <span class="lbl">Holder rewards</span>
          <h2 class="rw-big">Starts at launch</h2>
          <p class="muted small" style="margin:0">Holder rewards begin once the ${COIN} token and its RUNNER/IMD pool are live. This tab will show what you've earned each day and let you claim it.</p>
        </div>
        ${howCard()}
      </section>`;
      return;
    }
    const a = current();
    const kind = signerFor(a);
    const d = data && a && data.address.toLowerCase() === a.toLowerCase() ? data : null;
    const msToMidnight = 864e5 - (Date.now() % 864e5);
    const hrs = Math.floor(msToMidnight / 36e5), mins = Math.floor((msToMidnight % 36e5) / 6e4);

    let hero = '';
    if (!a) {
      hero = `<div class="card rw-hero"><span class="lbl">Holder rewards</span><h2 class="rw-big">—</h2><p class="muted small" style="margin:0">Sign in or connect the wallet that holds your ${COIN} to see your rewards.</p></div>`;
    } else if (error && !d) {
      hero = `<div class="card rw-hero"><span class="lbl">Holder rewards</span><p class="bad small">Couldn't load: ${esc(error)}</p><button class="btn pill sm" data-act="refresh">Try again</button></div>`;
    } else if (!d) {
      hero = `<div class="card rw-hero"><span class="lbl">Holder rewards</span><h2 class="rw-big muted">Loading…</h2></div>`;
    } else {
      hero = `<div class="card rw-hero">
        <span class="lbl">Ready to claim</span>
        <h2 class="rw-big">${fmtImd(d.claimable)} <small>IMD</small></h2>
        ${d.claimable > 0n
          ? (kind ? `<button class="btn primary pill" data-act="claim" ${busy ? 'disabled' : ''}>Claim ${fmtImd(d.claimable)} IMD</button>`
            : '<span class="muted small">To claim, sign in with this wallet or connect it as a browser wallet.</span>')
          : '<span class="muted small">Nothing to claim right now.</span>'}
        ${d.imdBalance != null ? `<span class="muted small">IMD in this wallet: ${fmtImd(d.imdBalance)}</span>` : ''}
      </div>`;
    }

    let holding = '', history = '', pool = '';
    if (d) {
      const pct = Number((d.balance * 1000n) / MIN_HOLDING) / 10;
      const status = d.excluded
        ? '<span class="small bad">This address is excluded from holder rewards (a pool or a system contract).</span>'
        : d.todayBal > 0n
          ? `<span class="small ok">Counting today with ${fmtRunner(d.todayBal)} ${COIN} (your lowest balance so far today). Keep at least 300,000 until 00:00 UTC — in ${hrs} h ${mins} m.</span>`
          : d.balance >= MIN_HOLDING
            ? `<span class="small">You hold enough, but not since the start of today (UTC). You'll count from tomorrow if you keep at least 300,000 — that starts in ${hrs} h ${mins} m.</span>`
            : `<span class="small">Hold at least 300,000 ${COIN} through a whole UTC day to share that day's rewards. ${d.balance > 0n ? `You need ${fmtRunner(MIN_HOLDING - d.balance)} more.` : ''}</span>`;
      const shareToday = d.todayBal > 0n && d.eligibleSupply > 0n ? Number((d.todayBal * 10000n) / d.eligibleSupply) / 100 : 0;
      holding = `<div class="card rw-holding">
        <h4>Your holding</h4>
        <div class="row between"><span>${COIN} balance</span><b>${fmtRunner(d.balance)}</b></div>
        <div class="rw-meter" aria-label="Progress to 300,000"><i style="width:${Math.min(100, pct)}%"></i></div>
        <span class="muted small">${pct >= 100 ? 'Above the 300,000 minimum' : `${pct.toFixed(1)}% of the 300,000 minimum`}</span>
        ${status}
        ${shareToday ? `<span class="muted small">Your share of today's holder rewards so far: about ${shareToday.toLocaleString()}%</span>` : ''}
      </div>`;

      const rows = d.perDay.map((x) => {
        const lastDay = x.day + CLAIM_WINDOW_DAYS; // claimable through this UTC day (claimHolderRewards covers today - 7 … today - 1)
        const state = x.claimed ? '<span class="ok">Claimed</span>'
          : x.share > 0n ? `<span>Claimable through ${dayLabel(lastDay)}</span>`
            : x.bal > 0n ? '<span class="muted">No trades that day</span>' : '<span class="muted">Didn\'t qualify</span>';
        return `<tr><td>${dayLabel(x.day)}</td><td class="num">${fmtImd(x.rewards)}</td><td class="num"><b>${x.share > 0n ? fmtImd(x.share) : '—'}</b></td><td>${state}</td></tr>`;
      }).join('');
      history = `<div class="card">
        <h4>Last 7 days (IMD)</h4>
        <div class="rw-table"><table>
          <tr><th>Day (UTC)</th><th class="num">All holders</th><th class="num">Yours</th><th></th></tr>
          ${rows || '<tr><td colspan="4" class="muted">No days yet.</td></tr>'}
        </table></div>
      </div>`;

      pool = `<div class="card">
        <h4>Today so far</h4>
        <div class="row between"><span>Booked for holders today</span><b>${fmtImd(d.todayRewards)} IMD</b></div>
        ${d.pending > 0n ? `<div class="row between"><span>Waiting in the pool</span><b>${fmtImd(d.pending)} IMD</b></div>
          <span class="muted small">Fees from trades through other apps wait in the pool until someone sends them to holders. Anyone can.</span>
          ${anySigner() ? `<button class="btn pill sm" data-act="flush" ${busy ? 'disabled' : ''}>Send to holders</button>` : ''}` : ''}
        <div class="row between"><span>All holder rewards so far</span><b>${fmtImd(d.totalRewards)} IMD</b></div>
        <span class="muted small">Today's rewards can be claimed from tomorrow (00:00 UTC).</span>
      </div>`;
    }

    view.innerHTML = `<section class="page">
      ${hero}
      ${walletCard()}
      ${holding}
      ${history}
      ${pool}
      ${howCard()}
    </section>`;
  }

  async function tx(label, to, data, done) {
    const kind = label === 'claim' ? signerFor(current()) : anySigner();
    if (!kind) return;
    busy = true; draw();
    try {
      const hash = await send(kind, to, data);
      toast('Sent — waiting for the network…');
      const r = await waitForReceipt(hash);
      if (r && r.status && r.status !== '0x1') throw new Error('The transaction failed on-chain.');
      toast(done);
    } catch (err) {
      toast(/reject|denied|cancel/i.test(String(err?.message)) ? 'Cancelled.' : String(err?.message || err).slice(0, 200), 4000);
    } finally { busy = false; refresh(); }
  }

  view.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'signin': try { await auth.login(); } catch (err) { toast(err.message, 4000); } break;
      case 'connect': try { await connectInjected(); override = null; refresh(); } catch (err) { toast(/reject|denied|cancel/i.test(String(err.message)) ? 'Cancelled.' : err.message, 4000); } break;
      case 'disconnect': injected = null; override = null; refresh(); break;
      case 'refresh': refresh(); break;
      case 'claim': tx('claim', TOKEN_CONTRACT, '0x1979f81e', 'Holder rewards claimed'); break; // claimHolderRewards()
      case 'flush': tx('flush', HOOK_CONTRACT, `0x79c76e1a${addrWord(TOKEN_CONTRACT)}`, 'Sent to holders'); break; // flush(token)
    }
  };
  view.onsubmit = (e) => {
    const f = e.target.closest('[data-form="lookup"]');
    if (!f) return;
    e.preventDefault();
    const v = f.addr.value.trim();
    if (!isAddr(v)) { toast('That isn\'t an address (0x… with 40 characters).'); return; }
    lookup = v;
    try { localStorage.setItem(LOOKUP_KEY, v); } catch {}
    override = v;
    refresh();
  };

  // Reload only when sign-in changes which address is shown (Privy fires many change events).
  const onAuth = () => { if (current() !== shown) refresh(); else draw(); };
  auth.addEventListener('change', onAuth);
  const timer = setInterval(refresh, 60_000);
  onCleanup(() => { auth.removeEventListener('change', onAuth); clearInterval(timer); view.onclick = null; view.onsubmit = null; });
  refresh();
}
