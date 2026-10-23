// "Earn" tab: wallet, energy, sneakers, attribute points, minting, mystery
// boxes, marketplace, history.
import { units, fmtPace } from './stats.js';
import { auth, shortAddress, explorerUrl, CHAIN_NAME } from './auth.js';
import { COLLECTION, MODELS, EDITIONS, traitsFor, collectionStats } from './collection.js';
import { getBalance, getEthUsd, toUsd, getTransfers, estimateFee, parseEth, formatEth, isAddress, txUrl } from './wallet.js';
import {
  game, COIN, SNEAKER_TYPES, RARITIES, MAX_LEVEL, MINUTES_PER_ENERGY, ATTRS, POINTS_PER_LEVEL, MINT_LEVEL, MAX_MINTS,
  attrs, earnPerEnergy, levelUpCost, repairCost, durabilityLossPerEnergy, boxChancePerEnergy, dailyListings,
  canMint, mintCost, mintOdds,
} from './game.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtCoins = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ATTR_LABEL = { efficiency: 'Efficiency', luck: 'Luck', resilience: 'Resilience' };
const ATTR_HINT = { efficiency: 'more coins', luck: 'more boxes', resilience: 'less wear' };

// Sneaker illustrations live in sneaker-art.js (four lines + editions).
export { sneakerSvg } from './sneaker-art.js';
import { sneakerSvg } from './sneaker-art.js';

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

/**
 * Full-screen reveal for a new sneaker or coins (mint, mystery box).
 * Resolves with the id of the button pressed.
 */
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
          <button data-act="export-key">Export private key</button>
        </div>
        <span class="muted small">Signed in with ${esc(st.user?.method || 'Privy')}${st.user?.email ? ` · ${esc(st.user.email)}` : ''}</span>
      </div>`;
  }
  return `
    <div class="card wallet-id guest">
      <b>Get your own wallet</b>
      <p class="muted small">Sign in with Google, Apple or email and a ${CHAIN_NAME} wallet is created for you — no seed phrase or private key to import. Your coins and sneakers get linked to it.</p>
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
    <div class="w-meta" id="w-meta"></div>
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
      meta.innerHTML = `Available: <b>${formatEth(balance, 6)} ETH</b> · Network fee ≈ ${feeTxt}`;
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

/** Line / edition / token chips for a sneaker. */
function traitRow(s) {
  const model = MODELS[s.model] || MODELS.stride;
  const ed = s.edition && s.edition !== 'standard' ? EDITIONS[s.edition] : null;
  return `<div class="trait-row">
    <span class="badge neutral">${model.label}</span>
    ${ed ? `<span class="badge ed-${s.edition}">${ed.label} edition</span>` : ''}
    <span class="muted small">${s.tokenId ? `Genesis #${s.tokenId} / ${nf(COLLECTION.supply)}` : 'Original sneaker'}</span>
  </div>`;
}

function collectionCard(st) {
  const owned = st.sneakers.filter((x) => x.tokenId).length;
  const { models, editions } = collectionStats();
  return `
    <div class="card collection-card">
      <div class="row between"><h4 style="margin:0">${COLLECTION.name}</h4><span class="badge neutral">${nf(COLLECTION.supply)} sneakers</span></div>
      <div class="collection-strip">${[1, 2, 3].map((n) => sneakerSvg({ ...traitsFor([88, 4021, 7777][n - 1]), rarity: 'common' }, 'sneaker-art xs')).join('')}</div>
      <p class="muted small" style="margin:0">Every sneaker is one of ${nf(COLLECTION.supply)} unique designs across four lines —
        ${Object.entries(MODELS).map(([k, m]) => `${m.label} (${nf(models[k] || 0)})`).join(', ')} — with rare
        Neon (${editions.neon || 0}), Ghost (${editions.ghost || 0}) and Gold (${editions.gold || 0}) editions. You own ${owned}.</p>
      <button class="btn pill" data-act="collection">Explore the collection</button>
    </div>`;
}

function openCollection() {
  const ownedIds = new Set(game.state.sneakers.map((x) => x.tokenId).filter(Boolean));
  const PER = 12;
  let page = 0;
  let filter = 'all'; // all | model key | edition key
  const matches = () => {
    if (filter === 'all') return null;
    const ids = [];
    for (let i = 1; i <= COLLECTION.supply; i++) {
      const t = traitsFor(i);
      if (t.model === filter || t.edition === filter) ids.push(i);
    }
    return ids;
  };
  let list = null;
  openSheet(`
    <h2 class="sheet-title">${COLLECTION.name}</h2>
    <p class="muted">${nf(COLLECTION.supply)} original sneaker designs. The number decides the look — line, colours, foam, pattern and edition.</p>
    <div class="chips coll-filters">
      ${[['all', 'All'], ...Object.entries(MODELS).map(([k, m]) => [k, m.label]), ['neon', 'Neon'], ['ghost', 'Ghost'], ['gold', 'Gold']]
        .map(([k, l]) => `<button class="chip ${k === 'all' ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </div>
    <div class="coll-grid" id="coll-grid"></div>
    <div class="coll-nav">
      <button class="btn sm" data-nav="prev">← Prev</button>
      <span class="muted small" id="coll-page"></span>
      <button class="btn sm" data-nav="next">Next →</button>
    </div>
    <div class="coll-jump"><input id="coll-id" inputmode="numeric" placeholder="Find # (1–${COLLECTION.supply})"><button class="btn sm" data-nav="go">Show</button><button class="btn sm" data-nav="random">Random</button></div>
    <button class="btn pill block" data-close>Close</button>`, (el) => {
    const grid = el.querySelector('#coll-grid');
    const total = () => (list ? list.length : COLLECTION.supply);
    const idAt = (i) => (list ? list[i] : i + 1);
    const draw = () => {
      const pages = Math.max(1, Math.ceil(total() / PER));
      page = Math.min(Math.max(0, page), pages - 1);
      const ids = Array.from({ length: Math.min(PER, total() - page * PER) }, (_, k) => idAt(page * PER + k));
      grid.innerHTML = ids.length ? ids.map((id) => {
        const t = traitsFor(id);
        return `<div class="coll-tile ${ownedIds.has(id) ? 'owned' : ''}">
          ${sneakerSvg({ ...t, rarity: 'common' }, 'sneaker-art sm')}
          <b>#${id}</b>
          <span class="muted small">${MODELS[t.model].label}${t.edition !== 'standard' ? ` · <span class="ed-text ed-${t.edition}">${EDITIONS[t.edition].label}</span>` : ''}</span>
          ${ownedIds.has(id) ? '<span class="badge">Owned</span>' : ''}
        </div>`;
      }).join('') : '<p class="muted">No sneakers match.</p>';
      el.querySelector('#coll-page').textContent = `${nf(page * PER + 1)}–${nf(Math.min(total(), (page + 1) * PER))} of ${nf(total())}`;
    };
    el.addEventListener('click', (e) => {
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

export function renderEarn(view, { toast, onCleanup }) {
  // UI-only state that survives redraws.
  let staged = null;               // { id, efficiency, luck, resilience } points not yet saved
  const mintSel = { a: null, b: null };

  const stagedFor = (s) => (staged?.id === s.id ? staged : { id: s.id, efficiency: 0, luck: 0, resilience: 0 });
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
        ${s.parents ? `<span class="muted small" style="margin-top:-8px">Minted from #${esc(s.parents[0])} × #${esc(s.parents[1])}</span>` : ''}
        <div class="sneaker-facts">
          <div><span class="lbl">Pace zone</span><b>${paceRange(SNEAKER_TYPES[s.type])}</b></div>
          <div><span class="lbl">Per energy</span><b>${coinTag(earnPerEnergy(preview))}</b></div>
          <div><span class="lbl">Box chance</span><b>${Math.round(boxChancePerEnergy(preview) * 100)}%</b></div>
        </div>
        ${s.unspent > 0 ? `
          <div class="points-banner">
            <span><b>${left}</b> attribute point${left === 1 ? '' : 's'} to assign</span>
            <span class="muted small">Efficiency → ${ATTR_HINT.efficiency} · Luck → ${ATTR_HINT.luck} · Resilience → ${ATTR_HINT.resilience}</span>
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
        ${s.durability < 50 ? '<div class="note warn">Durability below 50 is reducing your efficiency and blocks minting. Repair to earn at full rate.</div>' : ''}
        <div class="actions-row">
          <button class="btn ${stagedTotal(st) ? '' : 'primary'}" data-act="level" data-id="${s.id}" ${s.level >= MAX_LEVEL || coins < levelUpCost(s) ? 'disabled' : ''}>
            ${s.level >= MAX_LEVEL ? 'Max level' : `Level up · ${coinTag(levelUpCost(s))}`}
          </button>
          <button class="btn" data-act="repair" data-id="${s.id}" ${!repairCost(s) || coins < repairCost(s) ? 'disabled' : ''}>
            Repair${repairCost(s) ? ` · ${coinTag(repairCost(s))}` : ''}
          </button>
        </div>
        <p class="muted small" style="margin:0">Each level gives ${POINTS_PER_LEVEL[s.rarity]} attribute points (${RARITIES[s.rarity].label}). Each energy wears ~${durabilityLossPerEnergy(s).toFixed(1)} durability. Mints: ${s.mints}/${MAX_MINTS}.</p>
      </div>`;
  }

  function mintCard(st) {
    const eligible = st.sneakers.filter(canMint);
    if (eligible.length < 2) {
      const ready = st.sneakers.filter((x) => x.level >= MINT_LEVEL).length;
      return `
        <div class="card">
          <h4>Mint a sneaker</h4>
          <p class="muted small" style="margin:0">Combine two Lv ${MINT_LEVEL}+ sneakers to mint a brand-new one — two parents of a higher rarity can produce a rarer child.
          You have <b>${eligible.length}</b> of 2 sneakers ready${ready > eligible.length ? ' (some need repair or have used all their mints)' : ''}.
          ${st.sneakers.length < 2 ? 'Buy a second sneaker in the Marketplace to get started.' : `Level up your sneakers to Lv ${MINT_LEVEL}.`}</p>
        </div>`;
    }
    if (!eligible.some((x) => x.id === mintSel.a)) mintSel.a = eligible[0].id;
    if (!eligible.some((x) => x.id === mintSel.b) || mintSel.b === mintSel.a) mintSel.b = eligible.find((x) => x.id !== mintSel.a).id;
    const a = game.sneaker(mintSel.a), b = game.sneaker(mintSel.b);
    const cost = mintCost(a, b);
    const options = (sel, other) => eligible.filter((x) => x.id !== other)
      .map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>#${esc(x.serial)} ${SNEAKER_TYPES[x.type].label} · ${x.mints}/${MAX_MINTS}</option>`).join('');
    return `
      <div class="card">
        <h4>Mint a sneaker</h4>
        <div class="mint-pair">
          <label class="mint-slot">${sneakerSvg(a, 'sneaker-art sm')}<select data-slot="a" aria-label="First parent">${options(a.id, b.id)}</select></label>
          <span class="mint-plus" aria-hidden="true">+</span>
          <label class="mint-slot">${sneakerSvg(b, 'sneaker-art sm')}<select data-slot="b" aria-label="Second parent">${options(b.id, a.id)}</select></label>
        </div>
        <div class="mint-odds">
          <span class="lbl">Child rarity odds</span>
          <div class="row" style="flex-wrap:wrap;gap:6px">${Object.entries(mintOdds(a, b)).map(([r, p]) => `<span class="badge r-${r}">${RARITIES[r].label} ${Math.round(p * 100)}%</span>`).join('')}</div>
          <span class="muted small">Type: 45% ${SNEAKER_TYPES[a.type].label} · 45% ${SNEAKER_TYPES[b.type].label} · 10% random</span>
        </div>
        <button class="btn primary" data-act="mint" ${st.coins < cost ? 'disabled' : ''}>Mint · ${coinTag(cost)}</button>
        <p class="muted small" style="margin:8px 0 0">Each parent can mint ${MAX_MINTS} times, and the price rises with every mint. Minting adds a sneaker, which can raise your max energy.</p>
      </div>`;
  }

  const draw = () => {
    const st = game.state;
    const s = game.active;
    const energy = game.energy;
    const max = game.maxEnergy;
    const mins = game.minutesToFull();
    const listings = dailyListings();
    const y = window.scrollY;

    view.innerHTML = `
      <section class="page">
        ${walletCard()}
        <div class="card wallet">
          <div>
            <span class="lbl">In-app balance</span>
            <div class="wallet-amt">${coinTag(st.coins)} <small>${COIN}</small></div>
            <span class="muted small">${COIN} points from your runs — spend them on sneakers below. Withdrawing ${COIN} isn't available yet.</span>
          </div>
          <div>
            <div class="row between"><span class="lbl">Energy</span><b class="energy-num">⚡ ${energy.toFixed(1)} / ${max}</b></div>
            ${energyBar(energy, max)}
            <span class="muted small">${mins ? `Full in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} m` : `${mins} m`}` : 'Energy full — go move!'} · 1 energy = ${MINUTES_PER_ENERGY} min of earning</span>
          </div>
        </div>

        ${s ? heroCard(s, st.coins) : ''}

        ${st.sneakers.length > 1 ? `
        <div class="card">
          <h4>My sneakers (${st.sneakers.length})</h4>
          <div class="sneaker-list">
            ${st.sneakers.map((x) => `
              <button class="sneaker-tile ${x.id === s?.id ? 'on' : ''}" data-act="select" data-id="${x.id}">
                ${x.unspent ? `<i class="pt-dot" title="Unassigned points">${x.unspent}</i>` : ''}
                ${sneakerSvg(x, 'sneaker-art sm')}
                <b>${sneakerTitle(x)}</b>
                <span class="muted small">${RARITIES[x.rarity].label} · Lv ${x.level} · ${Math.round(x.durability)}% · Mint ${x.mints}/${MAX_MINTS}</span>
              </button>`).join('')}
          </div>
        </div>` : ''}

        ${mintCard(st)}

        ${collectionCard(st)}

        <div class="card">
          <h4>Mystery boxes (${st.boxes.length})</h4>
          ${st.boxes.length ? `<div class="boxes">${st.boxes.map((b) => `
            <button class="box q${b.quality}" data-act="box" data-id="${b.id}">
              <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="14" width="30" height="22" rx="3"/><rect x="3" y="9" width="34" height="8" rx="2"/><path d="M20 9v27"/></svg>
              <span>Lv ${b.quality}</span><small>Open</small>
            </button>`).join('')}</div>`
          : '<p class="muted small" style="margin:0">Boxes drop while you earn — higher Luck means more and better boxes. They contain coins and sometimes a new sneaker.</p>'}
        </div>

        <div class="card">
          <div class="row between"><h4 style="margin:0">Marketplace</h4><span class="muted small">New listings daily</span></div>
          <p class="muted small" style="margin:6px 0 12px">More sneakers = more max energy (3 sneakers → 4 energy, 9 → 9, 15 → 12, 30 → 20).</p>
          <div class="listings">
            ${listings.map((l) => {
              const sold = st.bought.includes(l.id);
              const a = attrs({ ...l, durability: 100 });
              return `<div class="listing">
                ${sneakerSvg(l, 'sneaker-art sm')}
                <div class="row between"><b>${SNEAKER_TYPES[l.type].label}</b><span class="badge r-${l.rarity}">${RARITIES[l.rarity].label}</span></div>
                <span class="muted small">${paceRange(SNEAKER_TYPES[l.type])} · Eff ${a.efficiency.toFixed(0)} · Luck ${a.luck.toFixed(0)} · Res ${a.resilience.toFixed(0)}</span>
                <button class="btn sm ${sold ? '' : 'primary'}" data-act="buy" data-id="${l.id}" ${sold || st.coins < l.price ? 'disabled' : ''}>
                  ${sold ? 'Sold' : `Buy ${coinTag(l.price)}`}
                </button>
              </div>`;
            }).join('')}
          </div>
        </div>

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

        <p class="muted small" style="text-align:center">${COIN} coins are in-app points with no cash value. Only runs recorded live with GPS earn.</p>
      </section>`;
    window.scrollTo(0, y); // redraws shouldn't jump the page
  };

  async function revealSneaker(sneaker, kicker, title, extra = {}) {
    const pick = await showReveal({
      kicker, title, sneaker, ...extra,
      buttons: [{ id: 'equip', label: 'Equip it', primary: true }, { id: 'ok', label: 'Keep current' }],
    });
    if (pick === 'equip') await game.select(sneaker.id);
  }

  view.onchange = (e) => {
    const sel = e.target.closest('select[data-slot]');
    if (!sel) return;
    mintSel[sel.dataset.slot] = sel.value;
    draw();
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
        case 'collection': openCollection(); break;
        case 'withdraw': openWithdraw(toast); break;
        case 'copy-addr':
          await navigator.clipboard.writeText(auth.state.address);
          toast('Wallet address copied');
          break;
        case 'export-key':
          if (confirm('Your private key gives full control of this wallet. Never share it with anyone. Continue?')) await auth.exportWallet();
          break;
        case 'select': staged = null; await game.select(id); toast('Sneaker equipped'); break;
        case 'level': {
          await game.levelUp(id);
          const s = game.sneaker(id);
          toast(`Lv ${s.level}! +${POINTS_PER_LEVEL[s.rarity]} attribute points to assign`);
          break;
        }
        case 'repair': await game.repair(id); toast('Sneaker repaired'); break;
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
          await game.allocate(add.id, add);
          toast('Points assigned');
          break;
        }
        case 'mint': {
          const a = game.sneaker(mintSel.a), c = game.sneaker(mintSel.b);
          if (!confirm(`Mint a new sneaker from #${a.serial} and #${c.serial} for ${mintCost(a, c)} ${COIN}?`)) break;
          const child = await game.mint(a.id, c.id);
          await revealSneaker(child, 'Minted!', sneakerTitle(child));
          break;
        }
        case 'buy': {
          const s = await game.buy(dailyListings().find((l) => l.id === id));
          await revealSneaker(s, 'New sneaker', sneakerTitle(s));
          break;
        }
        case 'box': {
          const r = await game.openBox(id);
          if (r.sneaker) await revealSneaker(r.sneaker, 'Mystery box', `Jackpot! ${sneakerTitle(r.sneaker)}`, { coins: r.coins });
          else await showReveal({ kicker: 'Mystery box', title: 'Coins found', coins: r.coins });
          break;
        }
      }
    } catch (err) {
      toast(err.message);
    }
  };
  game.addEventListener('change', draw);
  auth.addEventListener('change', draw);
  onCleanup(() => { game.removeEventListener('change', draw); auth.removeEventListener('change', draw); view.onclick = null; view.onchange = null; });
  draw();
}
