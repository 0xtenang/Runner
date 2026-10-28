// "Earn" tab: wallet, RUNNER balance, energy, owned sneaker NFTs (levels,
// attribute points, repair) and the RUNNER Genesis shop (buy NFTs with ETH).
import { units, fmtPace } from './stats.js';
import { auth, shortAddress, explorerUrl, CHAIN_NAME, SIGN_IN_METHODS } from './auth.js';
import { COLLECTION, MODELS, EDITIONS, traitsFor, collectionStats, rarityOf, priceOf, PRICE_ETH } from './collection.js';
import { getBalance, getEthUsd, toUsd, getTransfers, estimateFee, parseEth, formatEth, isAddress, txUrl } from './wallet.js';
import { nftLive, ownedTokens, mintedStatus, totalMinted, salesPaused, mintData, nativeBalance, mintFeeEstimate, waitForReceipt, nftExplorerTx } from './nft.js';
import { NFT_CHAIN, NFT_CONTRACT, TOKEN_CONTRACT } from './config.js';
import {
  game, COIN, SNEAKER_TYPES, RARITIES, MAX_LEVEL, MINUTES_PER_ENERGY, ATTRS, POINTS_PER_LEVEL,
  attrs, earnPerEnergy, levelUpCost, repairCost, durabilityLossPerEnergy,
} from './game.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtCoins = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ATTR_LABEL = { efficiency: 'Efficiency', resilience: 'Resilience' };
const ATTR_HINT = { efficiency: `more ${COIN} per run`, resilience: 'less wear' };

// Sneaker illustrations live in sneaker-art.js (four lines + editions).
export { sneakerSvg } from './sneaker-art.js';
import { sneakerSvg, colorwayName } from './sneaker-art.js';
import { rewardsActive, rewardsConnected, connectRewards, syncRewards, checkRewardsStatus, upgrade, claimRewards, tokenBalance, burnForUpgrades, addDeposit, claimedOnChain, tokenExplorerTx, holderClaimable, claimHolderRewards, MIN_HOLDING, lockInfo, fmtUsd as usdOf, runnerUsdNow, loadRunnerUsd, releaseRewards, releaseEarly, INSTANT_BURN, LOCK_DAYS } from './rewards.js';

const coinIcon = '<svg class="coin-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9"/><path d="M10 5v10M7.5 7.5h4a2 2 0 0 1 0 4h-3"/></svg>';
export const coinTag = (n, sign = false) => `<span class="coin-amt">${coinIcon}${sign && n > 0 ? '+' : ''}${fmtCoins(n)}</span>`;

/** Sneaker speed zone as a pace range, e.g. "6:00–15:00 /km". */
export function paceRange(t) {
  const fast = fmtPace(t.max / 3.6, 1, false), slow = fmtPace(t.min / 3.6, 1, false);
  return slow === '–' ? `${fast} /${units.label()} or slower` : `${fast}–${slow} /${units.label()}`;
}

const sneakerTitle = (s) => `${SNEAKER_TYPES[s.type].label} <span class="muted">#${esc(s.serial)}</span>`;

function energyBar(energy, max) {
  return `<div class="energy-bar" role="meter" aria-valuenow="${energy.toFixed(1)}" aria-valuemax="${max}">
    ${Array.from({ length: max }, (_, i) => `<i style="--f:${Math.max(0, Math.min(1, energy - i))}"></i>`).join('')}
  </div>`;
}

/** Full-screen reveal for a new sneaker. Resolves with the id of the button pressed. */
export function showReveal({ kicker, title, sneaker, coins, note, buttons = [{ id: 'ok', label: 'Nice!', primary: true }] }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'reveal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="reveal-card">
        ${kicker ? `<span class="reveal-kicker">${esc(kicker)}</span>` : ''}
        ${sneaker ? `<div class="reveal-art">${sneakerSvg(sneaker)}</div>` : ''}
        ${coins ? `<div class="reveal-coins">${coinTag(coins, true)} <small>${COIN}</small></div>` : ''}
        <h2>${title}</h2>
        ${sneaker ? `<div class="row" style="justify-content:center;gap:6px"><span class="badge r-${sneaker.rarity}">${RARITIES[sneaker.rarity].label}</span><span class="badge neutral">${paceRange(SNEAKER_TYPES[sneaker.type])}</span></div>
          <div class="reveal-stats">${ATTRS.map((k) => `<div><span class="lbl">${ATTR_LABEL[k]}</span><b>${sneaker.base[k].toFixed(1)}</b></div>`).join('')}</div>` : ''}
        ${note ? `<p class="muted small">${note}</p>` : ''}
        <div class="actions-row" style="justify-content:center">
          ${buttons.map((b) => `<button class="btn ${b.primary ? 'primary' : ''}" data-id="${b.id}">${esc(b.label)}</button>`).join('')}
        </div>
      </div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (!b) return;
      el.classList.add('out');
      setTimeout(() => el.remove(), 180);
      resolve(b.dataset.id);
    });
    document.body.appendChild(el);
    el.querySelector('button.primary, button')?.focus();
  });
}

/** Small colour blob derived from the address, so people can recognise their wallet at a glance. */
export function addressAvatar(addr, size = 36) {
  const h1 = parseInt(addr.slice(2, 6), 16) % 360, h2 = parseInt(addr.slice(-4), 16) % 360;
  return `<span class="addr-avatar" style="width:${size}px;height:${size}px;background:linear-gradient(135deg,hsl(${h1} 80% 60%),hsl(${h2} 80% 45%))" aria-hidden="true"></span>`;
}

// ---------------------------------------------------------------- on-chain wallet
// Cached chain data for the signed-in wallet (refreshed every 30 s or on demand).
let chain = { address: null, balance: null, usd: null, txs: null, error: null, loading: false, at: 0 };

async function refreshChain(force = false) {
  const addr = auth.state.address;
  if (!addr || chain.loading) return;
  if (!force && chain.address === addr && Date.now() - chain.at < 30000) return;
  if (chain.address !== addr) chain = { address: addr, balance: null, usd: null, txs: null, error: null, loading: false, at: 0 };
  chain.loading = true;
  try {
    const [balance, usd] = await Promise.all([getBalance(addr), getEthUsd()]);
    Object.assign(chain, { balance, usd, error: null });
    chain.txs = await getTransfers(addr).catch(() => chain.txs || []);
  } catch (e) {
    chain.error = e.message;
  }
  chain.loading = false;
  chain.at = Date.now();
  auth.dispatchEvent(new Event('change')); // redraw anything showing the wallet
}

const fmtUsd = (n) => (n == null ? '' : `≈ $${n < 0.01 && n > 0 ? '<0.01' : n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`);
const ago = (t) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

function walletCard() {
  const st = auth.state;
  if (!st.configured) return '';
  if (auth.signedIn) {
    refreshChain();
    const bal = chain.address === st.address ? chain.balance : null;
    const txs = chain.address === st.address ? chain.txs : null;
    return `
      <div class="card wallet-id">
        <div class="row between"><span class="lbl">Wallet · ${CHAIN_NAME}</span><span class="badge">Connected</span></div>
        <div class="addr-row">
          ${addressAvatar(st.address)}
          <b class="addr" title="${st.address}">${shortAddress(st.address)}</b>
          <button class="btn sm" data-act="copy-addr">Copy</button>
        </div>
        <div class="eth-bal">
          <div>
            <span class="lbl">ETH balance</span>
            <b>${bal == null ? (chain.error ? '–' : '…') : formatEth(bal)} <small>ETH</small></b>
            <span class="muted small">${bal == null ? (chain.error ? esc(chain.error) : 'Loading…') : fmtUsd(toUsd(bal, chain.usd))}</span>
          </div>
          <button class="icon-round" data-act="refresh-bal" aria-label="Refresh balance" ${chain.loading ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>
          </button>
        </div>
        <div class="wallet-actions">
          <button class="btn primary pill" data-act="deposit">
            <svg viewBox="0 0 24 24"><path d="M12 4v13M6 11l6 6 6-6M5 20h14"/></svg>Deposit
          </button>
          <button class="btn pill" data-act="withdraw" ${!bal ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24"><path d="M12 20V7M6 13l6-6 6 6M5 4h14"/></svg>Withdraw
          </button>
        </div>
        ${txs?.length ? `
          <div class="tx-list">
            <span class="lbl">Recent activity</span>
            ${txs.map((t) => `
              <a class="tx-row" href="${txUrl(t.hash)}" target="_blank" rel="noopener">
                <span class="tx-ico ${t.incoming ? 'in' : 'out'}">${t.incoming ? '↓' : '↑'}</span>
                <span class="tx-main"><b>${t.ok ? (t.incoming ? 'Received' : 'Sent') : 'Failed'}</b><span class="muted small">${t.incoming ? 'from' : 'to'} ${shortAddress(t.counterparty || '')} · ${ago(t.time)}</span></span>
                <b class="tx-amt ${t.incoming ? 'pos' : ''}">${t.incoming ? '+' : '−'}${t.value < 10n ** 14n ? '<0.0001' : formatEth(t.value, 4)}</b>
              </a>`).join('')}
          </div>` : ''}
        <div class="wallet-links">
          <a href="${explorerUrl(st.address)}" target="_blank" rel="noopener">View on explorer</a>
          ${st.walletKind === 'external' ? '' : '<button data-act="export-key">Export private key</button>'}
        </div>
        <span class="muted small">Signed in with ${esc(st.walletKind === 'external' ? st.walletName || 'your wallet' : st.user?.method || 'Privy')}${st.user?.email ? ` · ${esc(st.user.email)}` : ''}</span>
      </div>`;
  }
  return `
    <div class="card wallet-id guest">
      <b>Get your own wallet</b>
      <p class="muted small">Sign in with ${SIGN_IN_METHODS} and a ${CHAIN_NAME} wallet is created for you — no seed phrase or private key to import. You need it to own sneaker NFTs and earn ${COIN}.</p>
      ${st.error ? `<p class="small" style="color:var(--bad);margin:0">${esc(st.error)}</p>` : ''}
      <button class="btn primary pill" data-act="signin" ${st.loading && !st.ready ? 'disabled' : ''}>${st.loading && !st.ready ? 'Loading sign-in…' : 'Sign in'}</button>
    </div>`;
}

/** Bottom sheet used by Deposit / Withdraw. Returns a close() function. */
function openSheet(html, onMount) {
  const el = document.createElement('div');
  el.className = 'sheet-overlay';
  el.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true"><div class="sheet-grab"></div>${html}</div>`;
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  const close = () => { el.classList.add('out'); document.body.classList.remove('no-scroll'); setTimeout(() => el.remove(), 180); };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  onMount?.(el, close);
  return close;
}

/** Summary rows for a transaction sheet: [label, value, className?]. */
const txRows = (rows) => rows.map(([k, v, cls = '']) => `<div class="${cls}"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
const shortDate = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
const cancelled = (e) => /reject|denied|cancel/i.test(String(e?.message || e));

/** Claim sheet: lock for 100% or take it now with the burn, with the numbers side by side. */
function openClaimSheet(amount, onDone) {
  let mode = 'lock';
  openSheet(`
    <h2 class="sheet-title">Claim ${COIN}</h2>
    <p class="muted">Move your verified earnings into your wallet as real tokens.</p>
    <div class="tx-choice" role="radiogroup" aria-label="How to claim">
      <button class="tx-opt on" data-mode="lock" role="radio" aria-checked="true"><b>Lock ${LOCK_DAYS} days</b><span>You get 100%</span></button>
      <button class="tx-opt" data-mode="now" role="radio" aria-checked="false"><b>Take it now</b><span>${INSTANT_BURN * 100}% is burned</span></button>
    </div>
    <dl class="tx-sum" id="c-sum"></dl>
    <p class="muted small" style="margin:0">If today's claim limit is nearly used up, you get part of it now and the rest stays in your balance for tomorrow. The network fee is paid in ETH.</p>
    <div class="buy-status small" id="c-status" role="status"></div>
    <button class="btn primary pill block" id="c-go"></button>
    <button class="btn pill block" data-close>Cancel</button>`, (el, close) => {
    const $ = (q) => el.querySelector(q);
    const go = $('#c-go'), status = $('#c-status');
    const say = (t, bad = false) => { status.innerHTML = t; status.classList.toggle('bad', bad); };
    const render = () => {
      const now = mode === 'now', burn = now ? amount * INSTANT_BURN : 0;
      el.querySelectorAll('.tx-opt').forEach((o) => { const on = o.dataset.mode === mode; o.classList.toggle('on', on); o.setAttribute('aria-checked', on); });
      $('#c-sum').innerHTML = txRows([
        ['Claiming', `${fmtCoins(amount)} ${COIN}`],
        ['Burned', now ? `−${fmtCoins(burn)} ${COIN}` : 'Nothing', now ? 'burn' : ''],
        [now ? 'In your wallet' : 'Unlocks', now ? 'Right away' : `${shortDate(Date.now() + LOCK_DAYS * 864e5)} · or early for ${100 - INSTANT_BURN * 100}%`],
        ['You get', `${fmtCoins(amount - burn)} ${COIN}`, 'total'],
      ]);
      go.textContent = now ? `Claim ${fmtCoins(amount - burn)} now` : `Lock & claim ${fmtCoins(amount)}`;
    };
    el.querySelector('.tx-choice').onclick = (e) => { const o = e.target.closest('.tx-opt'); if (o && !go.disabled) { mode = o.dataset.mode; render(); } };
    go.onclick = async () => {
      const instant = mode === 'now';
      go.disabled = true;
      try {
        const { hash, amount: got, partial } = await claimRewards((t) => say(t), instant);
        say('Sent — waiting for the network…');
        await waitForReceipt(hash);
        close();
        onDone?.();
        showReveal({ kicker: instant ? 'Claimed' : 'Locked', title: instant ? `${fmtCoins(got * (1 - INSTANT_BURN))} ${COIN} is in your wallet` : `${fmtCoins(got)} ${COIN} unlocks in ${LOCK_DAYS} days`, coins: instant ? got * (1 - INSTANT_BURN) : got, note: `${instant ? `${fmtCoins(got * INSTANT_BURN)} ${COIN} was burned. ` : `Release it from the Earn tab after ${LOCK_DAYS} days — or take it early for ${100 - INSTANT_BURN * 100}%. `}${partial ? "Today's claim limit is nearly used up, so this was a partial claim — the rest stays in your balance for tomorrow. " : ''}<a href="${tokenExplorerTx(hash)}" target="_blank" rel="noopener">View transaction</a>` });
      } catch (e) {
        say(cancelled(e) ? 'Cancelled — you can claim any time.' : esc(String(e?.message || e)), !cancelled(e));
        go.disabled = false;
      }
    };
    render();
  });
}

/** Wallet RUNNER → in-app balance: burned on-chain, then credited by the server for level-ups and repairs. */
function openDepositSheet(max, onDone) {
  openSheet(`
    <h2 class="sheet-title">Use wallet ${COIN} for upgrades</h2>
    <p class="muted">Add ${COIN} from your wallet to your in-app balance to level up and repair sneakers.</p>
    <label class="small">Amount <span class="muted">· you have ${fmtCoins(max)} ${COIN}</span>
      <div class="row" style="gap:8px"><input id="d-amt" class="input mono" inputmode="decimal" autocomplete="off" value="${Math.floor(max)}"><button class="btn pill sm" id="d-max">Max</button></div></label>
    <dl class="tx-sum" id="d-sum"></dl>
    <p class="muted small" style="margin:0">These ${COIN} are <b>burned</b> on-chain (removed from the supply) and added to your in-app balance. They can be spent on level-ups and repairs, but not claimed back to your wallet. The network fee is paid in ETH.</p>
    <div class="buy-status small" id="d-status" role="status"></div>
    <button class="btn primary pill block" id="d-go">Burn &amp; add</button>
    <button class="btn pill block" data-close>Cancel</button>`, (el, close) => {
    const $ = (q) => el.querySelector(q);
    const go = $('#d-go'), status = $('#d-status'), input = $('#d-amt');
    const say = (t, bad = false) => { status.innerHTML = t; status.classList.toggle('bad', bad); };
    const amount = () => { const v = Number(String(input.value).replace(/,/g, '')); return Number.isFinite(v) && v > 0 ? Math.min(v, max) : 0; };
    const render = () => {
      const a = amount();
      $('#d-sum').innerHTML = txRows([['Burned from your wallet', `${fmtCoins(a)} ${COIN}`, 'burn'], ['Added to your balance', `${fmtCoins(a)} ${COIN}`, 'total']]);
      go.disabled = !a; go.textContent = a ? `Burn & add ${fmtCoins(a)} ${COIN}` : 'Enter an amount';
    };
    input.oninput = render;
    $('#d-max').onclick = () => { input.value = String(max); render(); };
    go.onclick = async () => {
      const a = amount();
      if (!a) return;
      go.disabled = true;
      try {
        const wei = a >= max ? BigInt(Math.floor(max * 1e6)) * 10n ** 12n : BigInt(Math.round(a * 1e6)) * 10n ** 12n;
        say('Confirm the burn in your wallet…');
        const hash = await burnForUpgrades(wei);
        say('Sent — waiting for the network…');
        await waitForReceipt(hash);
        say('Adding to your balance…');
        await addDeposit(hash);
        close();
        onDone?.();
        showReveal({ kicker: 'Added', title: `${fmtCoins(a)} ${COIN} added for upgrades`, coins: a, note: `Level up or repair your sneakers from the Earn tab. <a href="${tokenExplorerTx(hash)}" target="_blank" rel="noopener">View transaction</a>` });
      } catch (e) {
        say(cancelled(e) ? 'Cancelled — nothing was burned.' : `${esc(String(e?.message || e))}${/confirmed/.test(String(e?.message)) ? ' It will be added automatically on your next visit.' : ''}`, !cancelled(e));
        go.disabled = false;
      }
    };
    render();
  });
}

/** Take every lock now: finished ones pay 100%, unfinished ones lose the burn. */
function openEarlySheet(l, toast, onDone) {
  const burn = l.locked * INSTANT_BURN;
  openSheet(`
    <h2 class="sheet-title">Take locked rewards now</h2>
    <p class="muted">Finished locks pay 100%. Locks that haven't finished pay ${100 - INSTANT_BURN * 100}% — the rest is burned forever.</p>
    <dl class="tx-sum">${txRows([
      ...(l.unlocked ? [['Ready', `${fmtCoins(l.unlocked)} ${COIN}`]] : []),
      ['Still locked', `${fmtCoins(l.locked)} ${COIN}`],
      ['Burned', `−${fmtCoins(burn)} ${COIN}`, 'burn'],
      ['You get', `${fmtCoins(l.unlocked + l.locked - burn)} ${COIN}`, 'total'],
    ])}</dl>
    <div class="buy-status small" id="e-status" role="status"></div>
    <button class="btn primary pill block" id="e-go">Take ${fmtCoins(l.unlocked + l.locked - burn)} now</button>
    <button class="btn pill block" data-close>Keep them locked</button>`, (el, close) => {
    const go = el.querySelector('#e-go'), status = el.querySelector('#e-status');
    go.onclick = async () => {
      go.disabled = true;
      try {
        const hash = await releaseEarly();
        status.textContent = 'Sent — waiting for the network…';
        await waitForReceipt(hash);
        close();
        toast('Locked rewards taken');
        onDone?.();
      } catch (e) {
        status.textContent = cancelled(e) ? 'Cancelled.' : String(e?.message || e);
        status.classList.toggle('bad', !cancelled(e));
        go.disabled = false;
      }
    };
  });
}

function loadQrLib() {
  if (window.QRCode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    sc.onload = resolve; sc.onerror = reject;
    document.head.appendChild(sc);
  });
}

function openDeposit(toast) {
  const addr = auth.state.address;
  openSheet(`
    <h2 class="sheet-title">Deposit ETH</h2>
    <p class="muted">Send ETH on <b>${CHAIN_NAME}</b> to your RUNNER wallet.</p>
    <div class="qr-box" id="dep-qr" role="img" aria-label="QR code of your wallet address"></div>
    <div class="addr-full">${addr}</div>
    <button class="btn primary pill block" data-dep="copy">Copy address</button>
    <div class="note warn"><b>Only send on ${CHAIN_NAME} (network ID 4663).</b> ETH sent on Ethereum, Arbitrum, Base or any other network won't arrive here and may be lost.</div>
    <ul class="dep-tips">
      <li><b>Robinhood app:</b> send ETH and choose the ${CHAIN_NAME} network.</li>
      <li><b>Another wallet or exchange:</b> only if it lets you withdraw to ${CHAIN_NAME}.</li>
      <li>Deposits usually show up within a minute — tap refresh on your balance.</li>
    </ul>
    <button class="btn pill block" data-close>Done</button>`, async (el) => {
    el.querySelector('[data-dep="copy"]').onclick = async () => {
      await navigator.clipboard.writeText(addr);
      toast('Wallet address copied');
    };
    try {
      await loadQrLib();
      new window.QRCode(el.querySelector('#dep-qr'), { text: addr, width: 200, height: 200, colorDark: '#111111', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
    } catch { el.querySelector('#dep-qr').textContent = 'QR code unavailable — copy the address instead.'; }
  });
}

function openWithdraw(toast) {
  const from = auth.state.address;
  let balance = chain.balance ?? 0n;
  let fee = null, feeTimer;
  openSheet(`
    <h2 class="sheet-title">Withdraw ETH</h2>
    <p class="muted">Send ETH from your RUNNER wallet to another address on <b>${CHAIN_NAME}</b>.</p>
    <label class="field"><span class="lbl">To address</span>
      <input id="w-to" placeholder="0x…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span class="lbl">Amount</span>
      <span class="amt-row"><input id="w-amt" inputmode="decimal" placeholder="0.00" autocomplete="off"><span class="amt-unit">ETH</span><button type="button" class="btn sm" id="w-max">Max</button></span></label>
    <dl class="tx-sum" id="w-meta"></dl>
    <div class="w-err" id="w-err" role="alert"></div>
    <div class="note">Make sure the address is on <b>${CHAIN_NAME}</b>. Transfers can't be reversed.</div>
    <button class="btn primary pill block" id="w-send" disabled>Review & send</button>
    <button class="btn pill block" data-close>Cancel</button>`, (el, close) => {
    const $ = (q) => el.querySelector(q);
    const to = $('#w-to'), amt = $('#w-amt'), send = $('#w-send'), meta = $('#w-meta'), err = $('#w-err');

    const update = () => {
      const value = parseEth(amt.value);
      const toOk = isAddress(to.value);
      const feeTxt = fee == null ? 'estimating…' : `${formatEth(fee, 7)} ETH`;
      meta.innerHTML = txRows([
        ['Available', `${formatEth(balance, 6)} ETH`],
        ['To', toOk ? shortAddress(to.value.trim()) : '—'],
        ['Amount', value != null && value > 0n ? `${formatEth(value, 6)} ETH` : '—'],
        ['Network fee', fee == null ? feeTxt : `≈ ${feeTxt}`],
        ['Total', value != null && value > 0n && fee != null ? `${formatEth(value + fee, 6)} ETH` : '—', 'total'],
      ]);
      let msg = '';
      if (to.value && !toOk) msg = 'That doesn\'t look like a wallet address (0x followed by 40 characters).';
      else if (toOk && to.value.trim().toLowerCase() === from.toLowerCase()) msg = 'That\'s your own RUNNER wallet.';
      else if (amt.value && value == null) msg = 'Enter an amount like 0.01';
      else if (value != null && value <= 0n && amt.value) msg = 'Amount must be more than 0.';
      else if (value != null && fee != null && value + fee > balance) msg = 'Not enough ETH to cover the amount plus the network fee.';
      err.textContent = msg;
      const ready = toOk && value != null && value > 0n && fee != null && !msg;
      send.disabled = !ready;
      send.textContent = ready ? `Send ${formatEth(value, 6)} ETH` : 'Review & send';
    };

    const refreshFee = () => {
      clearTimeout(feeTimer);
      feeTimer = setTimeout(async () => {
        const target = isAddress(to.value) ? to.value.trim() : from;
        const value = parseEth(amt.value) || 0n;
        try { fee = await estimateFee(from, target, value > balance ? 0n : value); } catch { fee = null; err.textContent = 'Couldn\'t estimate the network fee — check your connection.'; }
        update();
      }, 350);
    };

    to.oninput = () => { update(); refreshFee(); };
    amt.oninput = () => { update(); refreshFee(); };
    $('#w-max').onclick = async () => {
      if (fee == null) { try { fee = await estimateFee(from, isAddress(to.value) ? to.value.trim() : from, 0n); } catch { /* shown below */ } }
      const max = fee == null ? 0n : balance - fee;
      amt.value = max > 0n ? formatEth(max, 18) : '0';
      update();
    };
    send.onclick = async () => {
      const value = parseEth(amt.value);
      const dest = to.value.trim();
      send.disabled = true;
      send.textContent = 'Confirm in the Privy window…';
      try {
        const hash = await auth.sendEth(dest, value);
        el.querySelector('.sheet-panel').innerHTML = `
          <div class="sheet-grab"></div>
          <div class="w-done">
            <span class="w-done-ico">✓</span>
            <h2 class="sheet-title">Sent ${formatEth(value, 6)} ETH</h2>
            <p class="muted">to ${shortAddress(dest)} on ${CHAIN_NAME}. It usually confirms within seconds.</p>
            <a class="btn pill block" href="${txUrl(hash)}" target="_blank" rel="noopener">View transaction</a>
            <button class="btn primary pill block" data-close>Done</button>
          </div>`;
        setTimeout(() => refreshChain(true), 4000);
      } catch (e) {
        const m = String(e?.message || e);
        update(); // restore the button first — update() also resets the message line
        err.textContent = /reject|denied|cancel/i.test(m) ? 'Cancelled — nothing was sent.' : `Couldn't send: ${m.slice(0, 140)}`;
      }
    };

    getBalance(from).then((b) => { balance = b; update(); }).catch(() => {});
    update();
    refreshFee();
    to.focus();
  });
}

const nf = (n) => n.toLocaleString();
const TESTNET = Boolean(NFT_CHAIN.testnet);
const ETH = TESTNET ? 'test ETH' : 'ETH';

/** Line / edition / token chips for a sneaker. */
function traitRow(s) {
  const model = MODELS[s.model] || MODELS.stride;
  const ed = s.edition && s.edition !== 'standard' ? EDITIONS[s.edition] : null;
  return `<div class="trait-row">
    <span class="badge neutral">${model.label}</span>
    <span class="badge neutral">${colorwayName(s)}</span>
    ${ed ? `<span class="badge ed-${s.edition}">${ed.label} edition</span>` : ''}
    <span class="muted small">Genesis #${s.tokenId} / ${nf(COLLECTION.supply)}</span>
  </div>`;
}

// ---------------------------------------------------------------- ownership
let syncing = null;
/** Reads which Genesis tokens the signed-in wallet owns and updates the game. */
export function syncOwnedSneakers() {
  if (!auth.signedIn) return game.syncOwned([]);
  if (!nftLive()) return Promise.resolve([]);
  syncing ??= ownedTokens(auth.state.address)
    .then((ids) => game.syncOwned(ids))
    .finally(() => { syncing = null; });
  return syncing;
}

// ---------------------------------------------------------------- shop
const PRICE_LIST = `Common ${PRICE_ETH.common} · Uncommon ${PRICE_ETH.uncommon} · Rare ${PRICE_ETH.rare} · Epic ${PRICE_ETH.epic} ${ETH}`;

function firstSneakerCard() {
  const picks = [3, 146, 42].map((id) => sneakerSvg(traitsFor(id), 'sneaker-art xs')).join('');
  return `
    <div class="card first-sneaker">
      <div class="collection-strip">${picks}</div>
      <h2>Get your first sneaker</h2>
      <p class="muted" style="margin:0">To earn ${COIN} you need a <b>${COLLECTION.name}</b> sneaker NFT. Prices start at <b>${PRICE_ETH.common} ${ETH}</b> — rarer sneakers earn more:</p>
      <div class="price-grid">${Object.entries(PRICE_ETH).map(([r, p]) => `<div><span class="badge r-${r}">${RARITIES[r].label}</span><b>${p}</b><span class="muted small">${ETH}</span></div>`).join('')}</div>
      ${TESTNET ? '<span class="note small">Beta on Robinhood Chain Testnet — purchases use free test ETH, not real money.</span>' : ''}
      ${nftLive() ? '' : '<span class="note small">Sales open soon.</span>'}
      <button class="btn primary pill block" data-act="shop">Browse sneakers</button>
      ${auth.signedIn ? '' : `<span class="muted small" style="text-align:center">You'll need to sign in to buy — your sneaker lives in your own wallet.</span>`}
    </div>`;
}

function shopCard(st) {
  const { rarities } = collectionStats();
  return `
    <div class="card collection-card">
      <div class="row between"><h4 style="margin:0">${COLLECTION.name} shop</h4><span class="badge neutral" id="minted-count">${nftLive() ? '…' : nf(COLLECTION.supply)} ${nftLive() ? 'minted' : 'sneakers'}</span></div>
      <div class="collection-strip">${[88, 4021, 7777].map((id) => sneakerSvg(traitsFor(id), 'sneaker-art xs')).join('')}</div>
      <p class="muted small" style="margin:0">${nf(COLLECTION.supply)} unique sneaker NFTs on ${NFT_CHAIN.name}: ${nf(rarities.common)} Common, ${nf(rarities.uncommon)} Uncommon,
        ${nf(rarities.rare)} Rare and ${nf(rarities.epic)} Epic. More sneakers = more energy per day. You own ${st.sneakers.length}.</p>
      <p class="small" style="margin:0"><b>Prices:</b> ${PRICE_LIST}</p>
      <button class="btn pill" data-act="shop">Browse &amp; buy</button>
    </div>`;
}

function statusBadge(id, owned, minted) {
  if (owned.has(id)) return '<span class="badge">Owned</span>';
  if (minted === true) return '<span class="badge neutral">Sold</span>';
  return '';
}

function openShop(toast) {
  const owned = new Set(game.ownedTokenIds);
  const PER = 12;
  let page = 0, filter = 'all', list = null;
  const mintedCache = new Map();
  const FILTERS = [['all', 'All'], ['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'], ['epic', 'Epic'],
    ...Object.entries(MODELS).map(([k, m]) => [k, m.label]), ['neon', 'Neon'], ['ghost', 'Ghost'], ['gold', 'Gold']];
  const matches = () => {
    if (filter === 'all') return null;
    const ids = [];
    for (let i = 1; i <= COLLECTION.supply; i++) {
      const t = traitsFor(i);
      if (t.rarity === filter || t.model === filter || t.edition === filter) ids.push(i);
    }
    return ids;
  };
  openSheet(`
    <h2 class="sheet-title">${COLLECTION.name}</h2>
    <p class="muted">Pick a sneaker to see its stats and buy it. ${PRICE_LIST}.</p>
    ${TESTNET ? '<div class="note small">Testnet beta — uses free test ETH, not real money.</div>' : ''}
    <div class="chips coll-filters">${FILTERS.map(([k, l]) => `<button class="chip ${k === 'all' ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
    <div class="coll-grid" id="coll-grid"></div>
    <div class="coll-nav">
      <button class="btn sm" data-nav="prev">← Prev</button>
      <span class="muted small" id="coll-page"></span>
      <button class="btn sm" data-nav="next">Next →</button>
    </div>
    <div class="coll-jump"><input id="coll-id" inputmode="numeric" placeholder="Find # (1–${COLLECTION.supply})"><button class="btn sm" data-nav="go">Show</button><button class="btn sm" data-nav="random">Random</button></div>
    <button class="btn pill block" data-close>Close</button>`, (el, close) => {
    const grid = el.querySelector('#coll-grid');
    const total = () => (list ? list.length : COLLECTION.supply);
    const idAt = (i) => (list ? list[i] : i + 1);
    const draw = () => {
      const pages = Math.max(1, Math.ceil(total() / PER));
      page = Math.min(Math.max(0, page), pages - 1);
      const ids = Array.from({ length: Math.min(PER, total() - page * PER) }, (_, k) => idAt(page * PER + k));
      grid.innerHTML = ids.length ? ids.map((id) => {
        const t = traitsFor(id);
        return `<button class="coll-tile ${owned.has(id) ? 'owned' : ''} ${mintedCache.get(id) && !owned.has(id) ? 'sold' : ''}" data-token="${id}">
          <span class="studio">${statusBadge(id, owned, mintedCache.get(id))}${sneakerSvg(t, 'sneaker-art sm')}</span>
          <span class="tile-meta">
            <span class="tile-head"><b>#${id}</b><span class="tile-price">${PRICE_ETH[t.rarity]} ${ETH}</span></span>
            <span class="muted small">${SNEAKER_TYPES[t.type].short} · ${MODELS[t.model].label}${t.edition !== 'standard' ? ` · <span class="ed-text ed-${t.edition}">${EDITIONS[t.edition].label}</span>` : ''}</span>
            <span class="badge r-${t.rarity}">${RARITIES[t.rarity].label}</span>
          </span>
        </button>`;
      }).join('') : '<p class="muted">No sneakers match.</p>';
      el.querySelector('#coll-page').textContent = `${nf(page * PER + 1)}–${nf(Math.min(total(), (page + 1) * PER))} of ${nf(total())}`;
      // Fill in sold / available from the chain for this page.
      const unknown = ids.filter((id) => !mintedCache.has(id));
      if (nftLive() && unknown.length) {
        mintedStatus(unknown).then((flags) => {
          unknown.forEach((id, i) => mintedCache.set(id, flags[i]));
          if (ids.every((id) => mintedCache.has(id)) && el.isConnected) draw();
        }).catch(() => {});
      }
    };
    el.addEventListener('click', (e) => {
      const tile = e.target.closest('[data-token]');
      if (tile) { openSneakerDetail(Number(tile.dataset.token), toast, () => { mintedCache.clear(); owned.clear(); game.ownedTokenIds.forEach((x) => owned.add(x)); draw(); }); return; }
      const f = e.target.closest('[data-filter]');
      if (f) {
        filter = f.dataset.filter;
        el.querySelectorAll('[data-filter]').forEach((c) => c.classList.toggle('on', c === f));
        list = matches();
        page = 0;
        draw();
        return;
      }
      const n = e.target.closest('[data-nav]');
      if (!n) return;
      if (n.dataset.nav === 'prev') page--;
      if (n.dataset.nav === 'next') page++;
      if (n.dataset.nav === 'random' || n.dataset.nav === 'go') {
        const want = n.dataset.nav === 'random' ? 1 + Math.floor(Math.random() * COLLECTION.supply) : parseInt(el.querySelector('#coll-id').value, 10);
        if (!(want >= 1 && want <= COLLECTION.supply)) return;
        filter = 'all'; list = null;
        el.querySelectorAll('[data-filter]').forEach((c) => c.classList.toggle('on', c.dataset.filter === 'all'));
        page = Math.floor((want - 1) / PER);
        el.querySelector('#coll-id').value = '';
      }
      draw();
    });
    draw();
  });
}

/** Detail sheet for one Genesis token, with Buy. */
function openSneakerDetail(id, toast, onBought) {
  const t = traitsFor(id);
  const zone = SNEAKER_TYPES[t.type];
  const preview = { ...t, level: 0, durability: 100, points: {} };
  const isOwned = game.ownedTokenIds.includes(id);
  openSheet(`
    <div class="detail-art">${sneakerSvg(t)}</div>
    <div class="row between"><h2 class="sheet-title">${zone.label} <span class="muted">#${id}</span></h2><span class="badge r-${t.rarity}">${RARITIES[t.rarity].label}</span></div>
    ${traitRow(t)}
    <div class="sneaker-facts">
      <div><span class="lbl">Pace zone</span><b>${paceRange(zone)}</b></div>
      <div><span class="lbl">Earns / energy</span><b>${coinTag(earnPerEnergy(preview, game.earnFactor))}</b></div>
      <div><span class="lbl">Level-up points</span><b>${POINTS_PER_LEVEL[t.rarity]} / level</b></div>
    </div>
    <div class="sneaker-facts">
      <div><span class="lbl">Efficiency</span><b>${t.base.efficiency.toFixed(1)}</b></div>
      <div><span class="lbl">Resilience</span><b>${t.base.resilience.toFixed(1)}</b></div>
      <div><span class="lbl">Price</span><b>${PRICE_ETH[t.rarity]} ${ETH}</b></div>
    </div>
    ${isOwned ? '' : `<dl class="tx-sum" id="b-sum">${txRows([
      ['Price', `${PRICE_ETH[t.rarity]} ${ETH}`],
      ['Network fee', nftLive() ? 'estimating…' : '—'],
      ['Resale royalty', '5%'],
      ['You get', `${zone.label} #${id} in your wallet`, 'total'],
    ])}</dl>`}
    <div class="buy-status small" id="buy-status" role="status"></div>
    ${isOwned ? '<button class="btn pill block" data-close>You own this sneaker</button>'
      : `<button class="btn primary pill block" id="b-buy" ${nftLive() ? '' : 'disabled'}>${nftLive() ? `Buy for ${PRICE_ETH[t.rarity]} ${ETH}` : 'Sales open soon'}</button>`}
    <button class="btn pill block" data-close>Close</button>`, (el, close) => {
    const status = el.querySelector('#buy-status');
    const btn = el.querySelector('#b-buy');
    const say = (html, bad = false) => { status.innerHTML = html; status.classList.toggle('bad', bad); };
    if (nftLive() && !isOwned) {
      mintFeeEstimate().then((fee) => {
        const row = el.querySelector('#b-sum div:nth-child(2) dd');
        if (row) row.textContent = `≈ ${formatEth(fee, 6)} ${ETH}`;
      }).catch(() => { const row = el.querySelector('#b-sum div:nth-child(2) dd'); if (row) row.textContent = 'a few cents'; });
      mintedStatus([id]).then(([sold]) => { if (sold && btn) { btn.disabled = true; btn.textContent = 'Already sold'; } }).catch(() => {});
    }
    if (!btn) return;
    btn.onclick = async () => {
      if (!auth.signedIn) {
        say('Sign in to buy — your sneaker will live in your own wallet.');
        try { await auth.login(); } catch (e) { say(esc(e.message), true); }
        return;
      }
      btn.disabled = true;
      try {
        say('Checking availability…');
        const price = priceOf(id);
        const [[sold], paused] = await Promise.all([mintedStatus([id]), salesPaused()]);
        if (sold) throw new Error('Someone just bought this sneaker — pick another.');
        if (paused) throw new Error('Sales are paused right now. Try again later.');
        const [bal, fee] = await Promise.all([nativeBalance(auth.state.address), mintFeeEstimate()]);
        if (bal < price + fee) {
          throw new Error(`Not enough ${ETH}: this costs ${formatEth(price, 4)} + about ${formatEth(fee, 6)} network fee, and you have ${formatEth(bal, 5)}. ${TESTNET ? 'Get free test ETH from the Robinhood Chain Testnet faucet' : 'Deposit ETH on Robinhood Chain first'} — your address: ${shortAddress(auth.state.address)}.`);
        }
        say('Confirm the purchase in the Privy window…');
        const hash = await auth.sendTx({ to: NFT_CONTRACT, value: price, data: mintData(id), chainId: NFT_CHAIN.id });
        say(`Payment sent — waiting for ${NFT_CHAIN.name} to confirm…`);
        const rcpt = await waitForReceipt(hash);
        if (rcpt.status !== '0x1') throw new Error(`The purchase failed on-chain — nothing was charged except the network fee. <a href="${nftExplorerTx(hash)}" target="_blank" rel="noopener">Details</a>`);
        await syncOwnedSneakers();
        const s = game.state.sneakers.find((x) => x.tokenId === id);
        if (s) await game.select(s.id);
        close();
        onBought?.();
        await showReveal({
          kicker: 'It\'s yours!', title: `${zone.label} <span class="muted">#${id}</span>`, sneaker: { ...t },
          note: `Equipped and ready. Run at ${paceRange(zone)} to earn ${COIN}.`,
          buttons: [{ id: 'ok', label: 'Let\'s run', primary: true }],
        });
      } catch (e) {
        const m = String(e?.message || e);
        say(/reject|denied|cancel/i.test(m) ? 'Cancelled — nothing was charged.' : m, true);
        btn.disabled = false;
      }
    };
  });
}

// ---------------------------------------------------------------- render
// ---------------------------------------------------------------- rewards (real RUNNER)
let claimInfo = null; // { wallet, claimed } read from the token contract

function rewardsCard(st) {
  if (!rewardsActive()) {
    return `<span class="muted small">Earned by running. Spend it on level-ups and repairs. Claiming ${COIN} to your wallet opens when the token launches.</span>${holderRewardsBlock()}`;
  }
  if (!rewardsConnected()) {
    return `<span class="muted small">Connect to the RUNNER server so your runs earn real ${COIN} you can claim to your wallet. Your wallet signs once — it's free.</span>
      <button class="btn primary pill sm" data-act="rw-connect">Connect rewards</button>${holderRewardsBlock()}`;
  }
  const srv = st.server || { earned: 0, spent: 0 };
  const claimable = claimInfo?.address === auth.state.address ? Math.max(0, srv.earned - srv.spent - claimInfo.claimed) : null;
  return `<span class="muted small">Verified by the RUNNER server. Spend it on level-ups and repairs, or claim it to your wallet as real ${COIN} tokens.</span>
    ${heldLine(st.server)}
    ${emissionLine(st.server?.emission)}
    <span class="small">In your wallet: <b>${claimInfo ? `${fmtCoins(claimInfo.wallet)} ${COIN}` : '…'}</b>${claimInfo && usdOf(claimInfo.wallet) ? ` <span class="muted">(${usdOf(claimInfo.wallet)})</span>` : ''}</span>
    ${claimInfo?.wallet > 0 ? `<div class="row"><button class="btn pill sm" data-act="rw-deposit" data-max="${claimInfo.wallet}">Use wallet ${COIN} for upgrades</button></div>` : ''}
    ${claimable ? `<span class="small">Ready to claim: <b>${fmtCoins(claimable)} ${COIN}</b>${usdOf(claimable) ? ` <span class="muted">(${usdOf(claimable)})</span>` : ''} — lock it ${LOCK_DAYS} days for 100%, or take it now with ${INSTANT_BURN * 100}% burned.</span>
    <div class="row"><button class="btn primary pill sm" data-act="rw-claim" data-amount="${claimable}">Claim ${fmtCoins(claimable)} ${COIN}</button></div>` : '<button class="btn pill sm" disabled>Nothing to claim yet</button>'}
    <span class="muted small" id="rw-status" role="status"></span>
    ${locksBlock()}
    ${holderRewardsBlock()}`;
}

function locksBlock() {
  const l = claimInfo?.locks;
  if (!l || (!l.locked && !l.unlocked)) return '';
  const when = l.nextUnlockAt ? new Date(l.nextUnlockAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  return `<div class="holder-rewards">
      <span class="lbl">Locked rewards</span>
      ${l.unlocked ? `<span class="small">Ready: <b>${fmtCoins(l.unlocked)} ${COIN}</b></span>` : ''}
      ${l.locked ? `<span class="small">Locked: <b>${fmtCoins(l.locked)} ${COIN}</b>${when ? ` · next unlock ${when}` : ''}</span>` : ''}
      <div class="row" style="gap:8px;flex-wrap:wrap">
        ${l.unlocked ? `<button class="btn primary pill sm" data-act="lock-release">Release ${fmtCoins(l.unlocked)}</button>` : ''}
        ${l.locked ? `<button class="btn pill sm" data-act="lock-early">Take all now…</button>` : ''}
      </div>
    </div>`;
}

/** Earnings still in their 24-hour hold, and any fair-play strikes. */
function heldLine(srv) {
  const strikes = srv?.strikes ? `<span class="small bad">Fair-play strikes: ${srv.strikes} / ${srv.strikeLimit} — runs that look fake earn nothing and add a strike; ${srv.strikeLimit} strikes in 30 days suspend the wallet. Strikes expire after 30 days.</span>` : '';
  if (!srv || (!srv.pending && !srv.underReview)) return strikes;
  const when = srv.nextRelease ? new Date(srv.nextRelease).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  return `<span class="small">${srv.pending ? `On hold: <b>${fmtCoins(srv.pending)} ${COIN}</b>${usdOf(srv.pending) ? ` <span class="muted">(${usdOf(srv.pending)})</span>` : ''}${when ? ` · usable from ${when}` : ''}` : ''}${srv.pending && srv.underReview ? ' · ' : ''}${srv.underReview ? `Under review: <b>${fmtCoins(srv.underReview)} ${COIN}</b>` : ''}</span>
    <span class="muted small">New earnings are usable 24 hours after a run.</span>${strikes}`;
}

/** "Emission today 10M · rate 100% · halves 22 Nov" */
function emissionLine(em) {
  if (!em?.startDay) return '';
  const fmtM = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}M` : `${Math.round(n / 1e3)}k`);
  const next = em.nextHalving ? ` · halves ${new Date(em.nextHalving).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ' · final rate';
  const boost = game.boost > 1 ? ` · NFT boost <b>+${Math.round((game.boost - 1) * 100)}%</b>` : '';
  const change = em.change ? `<br><span class="muted">From ${new Date(em.change.fromDay * 864e5).toLocaleDateString([], { day: 'numeric', month: 'short' })}: ${fmtM(em.change.dailyStart)}/day, halving every ${em.change.halvingDays} days</span>` : '';
  return `<span class="small">Emission today <b>${fmtM(em.limit)} ${COIN}</b> · earn rate <b>${Math.round(em.factor * 100)}%</b>${next}${boost}${change}</span>`;
}

/** IMD amounts: a few decimals, since one IMD is worth far more than one RUNNER. */
const fmtImd = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 4 });

function holderRewardsBlock() {
  if (claimInfo?.holder == null || claimInfo.address !== auth.state.address) return '';
  const h = claimInfo.holder;
  return `<div class="holder-rewards">
      <span class="lbl">Holder rewards</span>
      <span class="muted small">Hold at least ${MIN_HOLDING.toLocaleString()} ${COIN} for a whole day (UTC) to share 2% of that day's trading volume, paid in IMD. Each day's reward can be claimed for 7 days.</span>
      <button class="btn pill sm" data-act="holder-claim" ${h > 0 ? '' : 'disabled'}>${h > 0 ? `Claim ${fmtImd(h)} IMD holder rewards` : 'No holder rewards to claim'}</button>
      <a class="small" href="#/rewards">Day-by-day details in Rewards →</a>
    </div>`;
}

async function loadClaimInfo(onDone) {
  try {
    const [wallet, claimed, holder, locks] = await Promise.all([tokenBalance(), claimedOnChain(), holderClaimable(), lockInfo()]);
    claimInfo = { wallet, claimed, holder, locks, address: auth.state.address };
    onDone();
  } catch { /* chain unreachable: keep showing "…" */ }
}

export function renderEarn(view, { toast, onCleanup }) {
  // UI-only state that survives redraws.
  let staged = null; // { id, efficiency, resilience } points not yet saved

  const stagedFor = (s) => (staged?.id === s.id ? staged : { id: s.id, efficiency: 0, resilience: 0 });
  const stagedTotal = (st) => ATTRS.reduce((n, k) => n + (st[k] || 0), 0);

  function attrRow(s, k, st) {
    const now = attrs(s)[k], next = attrs(s, st)[k];
    const add = st[k] || 0;
    const canEdit = s.unspent > 0 || add > 0;
    return `<div class="attr ${canEdit ? 'has-ctl' : ''}">
      <span>${ATTR_LABEL[k]}</span>
      <div class="attr-bar"><i style="width:${Math.min(100, (now / 40) * 100).toFixed(0)}%"></i>${add ? `<i class="add" style="width:${Math.min(100, ((next - now) / 40) * 100).toFixed(0)}%"></i>` : ''}</div>
      <b>${next.toFixed(1)}${add ? `<em>+${add}</em>` : ''}</b>
      ${canEdit ? `<span class="pt-ctl">
        <button data-act="pt" data-k="${k}" data-d="-1" aria-label="Remove a point from ${ATTR_LABEL[k]}" ${add ? '' : 'disabled'}>−</button>
        <button data-act="pt" data-k="${k}" data-d="1" aria-label="Add a point to ${ATTR_LABEL[k]}" ${s.unspent - stagedTotal(st) > 0 ? '' : 'disabled'}>+</button>
      </span>` : ''}
    </div>`;
  }

  function heroCard(s, coins) {
    const st = stagedFor(s);
    const left = s.unspent - stagedTotal(st);
    const preview = { ...s, points: { ...s.points } };
    ATTRS.forEach((k) => { preview.points[k] += st[k] || 0; });
    return `
      <div class="card sneaker-hero">
        <div class="row between"><h4 style="margin:0">Equipped sneaker</h4><span class="badge r-${s.rarity}">${RARITIES[s.rarity].label}</span></div>
        ${sneakerSvg(s)}
        <div class="row between">
          <h2 class="sneaker-name">${sneakerTitle(s)}</h2>
          <span class="badge neutral">Lv ${s.level}</span>
        </div>
        ${traitRow(s)}
        <div class="sneaker-facts">
          <div><span class="lbl">Pace zone</span><b>${paceRange(SNEAKER_TYPES[s.type])}</b></div>
          <div><span class="lbl">Per energy</span><b>${coinTag(earnPerEnergy(preview, game.earnFactor))}</b></div>
          <div><span class="lbl">Wear / energy</span><b>${durabilityLossPerEnergy(preview).toFixed(1)}</b></div>
        </div>
        ${s.unspent > 0 ? `
          <div class="points-banner">
            <span><b>${left}</b> attribute point${left === 1 ? '' : 's'} to assign</span>
            <span class="muted small">Efficiency → ${ATTR_HINT.efficiency} · Resilience → ${ATTR_HINT.resilience}</span>
          </div>` : ''}
        <div class="attrs">
          ${ATTRS.map((k) => attrRow(s, k, st)).join('')}
          <div class="attr"><span>Durability</span><div class="attr-bar dur ${s.durability < 50 ? 'low' : ''}"><i style="width:${s.durability}%"></i></div><b>${Math.round(s.durability)}</b></div>
        </div>
        ${stagedTotal(st) ? `
          <div class="actions-row">
            <button class="btn primary" data-act="pt-save">Save ${stagedTotal(st)} point${stagedTotal(st) === 1 ? '' : 's'}</button>
            <button class="btn" data-act="pt-cancel">Cancel</button>
          </div>
          <p class="muted small" style="margin:0">Assigned points are permanent.</p>` : ''}
        ${s.durability < 50 ? `<div class="note warn">Durability below 50 is reducing your Efficiency. Repair to earn at full rate.</div>` : ''}
        <div class="actions-row">
          <button class="btn ${stagedTotal(st) ? '' : 'primary'}" data-act="level" data-id="${s.id}" ${s.level >= MAX_LEVEL || coins < levelUpCost(s, game.emissionFactor, game.settings) ? 'disabled' : ''}>
            ${s.level >= MAX_LEVEL ? 'Max level' : `Level up · ${coinTag(levelUpCost(s, game.emissionFactor, game.settings))}`}
          </button>
          <button class="btn" data-act="repair" data-id="${s.id}" ${!repairCost(s, game.emissionFactor) || coins < repairCost(s, game.emissionFactor) ? 'disabled' : ''}>
            Repair${repairCost(s, game.emissionFactor) ? ` · ${coinTag(repairCost(s, game.emissionFactor))}` : ''}
          </button>
        </div>
        ${s.level < MAX_LEVEL && coins < levelUpCost(s, game.emissionFactor, game.settings) && rewardsActive() && rewardsConnected()
          ? `<p class="small" style="margin:0">Your in-app balance pays for level-ups and repairs.${claimInfo?.wallet > 0 ? ` You have <b>${fmtCoins(claimInfo.wallet)} ${COIN}</b> in your wallet — <button class="link" data-act="rw-deposit" data-max="${claimInfo.wallet}">use it for upgrades</button>.` : ` Run to earn more, or add ${COIN} from your wallet below.`}</p>` : ''}
        <p class="muted small" style="margin:0">Each level gives ${POINTS_PER_LEVEL[s.rarity]} attribute point${POINTS_PER_LEVEL[s.rarity] === 1 ? '' : 's'} (${RARITIES[s.rarity].label}).</p>
      </div>`;
  }

  let usdAsked = false;
  const draw = () => {
    if (!usdAsked && !runnerUsdNow()) { usdAsked = true; loadRunnerUsd().then((p) => { if (p && view.isConnected) draw(); }).catch(() => {}); }
    const st = game.state;
    const s = game.active;
    const energy = game.energy;
    const max = game.maxEnergy;
    const mins = game.minutesToFull();
    const y = window.scrollY;

    view.innerHTML = `
      <section class="page">
        ${walletCard()}
        <div class="card wallet">
          <div>
            <span class="lbl">${COIN} balance</span>
            <div class="wallet-amt">${coinTag(st.coins)} <small>${COIN}</small></div>
            ${usdOf(st.coins) ? `<span class="muted small usd-est">${usdOf(st.coins)}</span>` : ''}
            ${rewardsCard(st)}
          </div>
          ${s ? `<div>
            <div class="row between"><span class="lbl">Energy</span><b class="energy-num">⚡ ${energy.toFixed(1)} / ${max}</b></div>
            ${energyBar(energy, max)}
            <span class="muted small">${mins ? `Full in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} m` : `${mins} m`}` : 'Energy full — go run!'} · 1 energy = ${MINUTES_PER_ENERGY} min of earning</span>
          </div>` : ''}
        </div>

        ${s ? heroCard(s, st.coins) : firstSneakerCard()}

        ${st.sneakers.length > 1 ? `
        <div class="card">
          <h4>My sneakers (${st.sneakers.length})</h4>
          <div class="sneaker-list">
            ${st.sneakers.map((x) => `
              <button class="sneaker-tile ${x.id === s?.id ? 'on' : ''}" data-act="select" data-id="${x.id}">
                <span class="studio">${x.unspent ? `<i class="pt-dot" title="Unassigned points">${x.unspent}</i>` : ''}${sneakerSvg(x, 'sneaker-art sm')}</span>
                <span class="tile-meta"><b>${sneakerTitle(x)}</b>
                <span class="muted small">${RARITIES[x.rarity].label} · Lv ${x.level} · ${Math.round(x.durability)}%</span></span>
              </button>`).join('')}
          </div>
        </div>` : ''}

        ${s ? shopCard(st) : ''}

        <div class="card">
          <h4>History</h4>
          <div class="ledger">
            ${st.ledger.length ? st.ledger.slice(0, 20).map((e) => `
              <div>
                <span>${esc(e.note)}<br><span class="muted small">${new Date(e.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></span>
                ${e.amount ? `<b class="${e.amount > 0 ? 'pos' : 'neg'}">${e.amount > 0 ? '+' : '−'}${fmtCoins(Math.abs(e.amount))}</b>` : ''}
                ${e.activityId ? `<a class="small" href="#/activity/${e.activityId}">View</a>` : ''}
              </div>`).join('') : '<p class="muted small" style="margin:0">Nothing yet.</p>'}
          </div>
        </div>

        <p class="muted small" style="text-align:center">${rewardsActive() ? `Every run is checked by the RUNNER server before it earns. Only runs recorded live with GPS count.` : `${COIN} is an in-app token with no cash value yet. Only runs recorded live with GPS earn.`}</p>
      </section>`;
    window.scrollTo(0, y); // redraws shouldn't jump the page
    if (auth.signedIn && TOKEN_CONTRACT && claimInfo?.address !== auth.state.address) { claimInfo = null; loadClaimInfo(draw); }
    if (nftLive() && view.querySelector('#minted-count')) {
      totalMinted().then((n) => { const el = view.querySelector('#minted-count'); if (el) el.textContent = `${nf(n)} / ${nf(COLLECTION.supply)} minted`; }).catch(() => {});
    }
  };

  view.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    try {
      switch (b.dataset.act) {
        case 'signin': await auth.login(); break;
        case 'refresh-bal': await refreshChain(true); break;
        case 'deposit': openDeposit(toast); break;
        case 'shop': openShop(toast); break;
        case 'withdraw': openWithdraw(toast); break;
        case 'copy-addr':
          await navigator.clipboard.writeText(auth.state.address);
          toast('Wallet address copied');
          break;
        case 'export-key':
          if (confirm('Your private key gives full control of this wallet. Never share it with anyone. Continue?')) await auth.exportWallet();
          break;
        case 'select': staged = null; await game.select(id); toast('Sneaker equipped'); break;
        case 'rw-connect':
          b.disabled = true;
          await connectRewards();
          toast('Connected — your runs now earn real RUNNER');
          break;
        case 'rw-claim': openClaimSheet(Number(b.dataset.amount), () => { claimInfo = null; draw(); }); break;
        case 'rw-deposit': openDepositSheet(Number(b.dataset.max), () => { claimInfo = null; draw(); }); break;
        case 'lock-early': if (claimInfo?.locks) openEarlySheet(claimInfo.locks, toast, () => { claimInfo = null; draw(); }); break;
        case 'lock-release': {
          b.disabled = true;
          try {
            const hash = await releaseRewards();
            toast('Sent — waiting for the network…');
            await waitForReceipt(hash);
            toast('Released to your wallet');
          } catch (err) {
            throw /reject|denied|cancel/i.test(String(err.message)) ? new Error('Cancelled.') : err;
          } finally { claimInfo = null; draw(); }
          break;
        }
        case 'holder-claim': {
          b.disabled = true;
          try {
            const hash = await claimHolderRewards();
            toast('Claim sent — waiting for the network…');
            await waitForReceipt(hash);
            toast('Holder rewards claimed');
          } catch (err) {
            throw /reject|denied|cancel/i.test(String(err.message)) ? new Error('Cancelled.') : err;
          } finally { claimInfo = null; draw(); }
          break;
        }
        case 'level': {
          await upgrade('levelup', id);
          const s = game.sneaker(id);
          toast(`Lv ${s.level}! +${POINTS_PER_LEVEL[s.rarity]} attribute point${POINTS_PER_LEVEL[s.rarity] === 1 ? '' : 's'} to assign`);
          break;
        }
        case 'repair': await upgrade('repair', id); toast('Sneaker repaired'); break;
        case 'pt': {
          const s = game.active;
          staged = stagedFor(s);
          const d = Number(b.dataset.d);
          if (d > 0 && s.unspent - stagedTotal(staged) <= 0) break;
          staged[b.dataset.k] = Math.max(0, staged[b.dataset.k] + d);
          draw();
          break;
        }
        case 'pt-cancel': staged = null; draw(); break;
        case 'pt-save': {
          const add = staged;
          staged = null;
          await upgrade('allocate', add.id, add);
          toast('Points assigned');
          break;
        }
      }
    } catch (err) {
      toast(err.message);
    }
  };
  game.addEventListener('change', draw);
  auth.addEventListener('change', draw);
  onCleanup(() => { game.removeEventListener('change', draw); auth.removeEventListener('change', draw); view.onclick = null; });
  syncOwnedSneakers().then(() => checkRewardsStatus()).then(() => { draw(); return syncRewards(); }).catch(() => {});
  draw();
}
