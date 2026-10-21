// "Earn" tab: wallet, energy, sneakers, attribute points, minting, mystery
// boxes, marketplace, history.
import { units, fmtPace } from './stats.js';
import { auth, shortAddress, explorerUrl, CHAIN_NAME } from './auth.js';
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

// ---------------------------------------------------------------- sneaker art
// Original RUNNER sneaker design (no real brand's marks or silhouettes):
// thick rocker foam midsole, engineered-mesh upper, padded collar, heel tab
// and the RUNNER "bolt" side mark. Class sets the silhouette, rarity adds
// effects, and the serial picks the colourway so every sneaker looks unique.
const ART_STYLE = {
  walker:  { stack: 10, plate: false, lugs: false },  // Recovery: max cushion
  jogger:  { stack: 4, plate: false, lugs: false },   // Daily: balanced trainer
  runner:  { stack: 12, plate: true, lugs: false },   // Tempo: tall stack + carbon plate
  trainer: { stack: 5, plate: false, lugs: true },    // Hybrid: grippy lugs
};
let artSeq = 0; // unique gradient ids when many sneakers share a page

export function sneakerSvg(s, cls = 'sneaker-art') {
  const id = `sn${++artSeq}`;
  const st = ART_STYLE[s.type] || ART_STYLE.jogger;
  const rar = s.rarity || 'common';
  const fancy = rar !== 'common';
  const shiny = rar === 'rare' || rar === 'epic';
  const seed = Number(s.serial) || Math.round(s.hue * 7.3) || 1;
  const h = s.hue, h2 = (h + 140 + (seed % 80)) % 360;

  const upper = `hsl(${h} 72% 52%)`, upper2 = `hsl(${(h + 32) % 360} 82% 60%)`;
  const dark = `hsl(${h} 55% 22%)`, light = `hsl(${h} 85% 84%)`;
  const midTone = seed % 3; // 0 white foam, 1 contrast foam, 2 tonal foam
  const mid = midTone === 0 ? '#f7f7f3' : midTone === 1 ? `hsl(${h2} 88% 62%)` : `hsl(${h} 75% 88%)`;
  const mid2 = shiny ? `hsl(${h2} 92% 55%)` : midTone === 0 ? '#deded7' : midTone === 1 ? `hsl(${h2} 80% 50%)` : `hsl(${h} 60% 74%)`;
  const mark = midTone === 1 ? '#ffffff' : `hsl(${h2} 92% 58%)`;
  const lace = seed % 2 ? '#ffffff' : dark;
  const plate = rar === 'epic' ? '#f5c518' : '#1a1a1a';

  // Stack height: full at the heel, tapering towards the toe (heel-to-toe drop).
  const S = st.stack;
  const off = (x) => S * (1 - 0.6 * x / 240);
  const o = (x, y) => `${x} ${(y - off(x)).toFixed(1)}`;
  const pts = (list) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${o(x, y)}`).join('') + 'Z';

  const topEdge = `C${o(200, 76)} ${o(120, 68)} ${o(50, 61)}C${o(30, 59)} ${o(18, 58)} ${o(10, 58)}`;
  const midPath = `M${o(10, 58)}C${o(4, 70)} 4 92 16 100C50 106 140 107 190 102C212 99 228 90 238 78C240 74 236 72 ${o(230, 73)}${topEdge}Z`;
  const upperPath = `M${o(12, 60)}C${o(8, 44)} ${o(10, 30)} ${o(18, 22)}C${o(22, 16)} ${o(32, 14)} ${o(38, 18)}C${o(48, 26)} ${o(60, 30)} ${o(74, 28)}C${o(84, 26)} ${o(90, 18)} ${o(96, 12)}C${o(100, 7)} ${o(110, 8)} ${o(112, 14)}C${o(120, 30)} ${o(150, 44)} ${o(186, 54)}C${o(212, 60)} ${o(232, 66)} ${o(230, 73)}${topEdge}Z`;
  const outsole = 'M16 100C50 106 140 107 190 102C212 99 228 90 238 78L240 82C232 95 214 104 190 106.5C140 112 50 111 14 104Z';
  const laces = Array.from({ length: 5 }, (_, i) => {
    const x = 116 + i * 13.5, y = 24 + i * 6.4;
    return `M${o(x, y)}L${o(x - 12, y + 8)}`;
  }).join('');
  const lugs = st.lugs ? Array.from({ length: 11 }, (_, i) => {
    const x = 26 + i * 17, y = 103 + 6 * (1 - ((x - 110) / 100) ** 2);
    return `<rect x="${x}" y="${y.toFixed(1)}" width="9" height="4.5" rx="1.5"/>`;
  }).join('') : '';
  const line = (pairs) => pairs.map(([x, y], i) => `${i === 0 ? 'M' : i % 3 === 1 ? 'C' : ''}${x} ${(y - off(x) * 0.5).toFixed(1)}`).join(' ');
  const sparkles = rar === 'epic' ? [[26, 10, 1], [216, 28, 0.8], [196, 8, 0.6]].map(([x, y, k]) =>
    `<path class="sparkle" transform="translate(${x} ${y}) scale(${k})" d="M0-7L1.8-1.8L7 0L1.8 1.8L0 7L-1.8 1.8L-7 0L-1.8-1.8Z"/>`).join('') : '';

  return `<svg class="${cls} rarity-${rar}" viewBox="0 0 244 120" aria-hidden="true">
    <defs>
      <linearGradient id="${id}u" x1="0" x2="1" y1="0" y2="0.4"><stop offset="0" stop-color="${upper}"/><stop offset="1" stop-color="${fancy ? upper2 : upper}"/></linearGradient>
      <linearGradient id="${id}d" x1="0" x2="0" y1="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
      <linearGradient id="${id}m" x1="0" x2="0" y1="0" y2="1"><stop offset=".1" stop-color="${mid}"/><stop offset="1" stop-color="${mid2}"/></linearGradient>
      <linearGradient id="${id}s" x1="0" x2="1" y1="0" y2="0" gradientTransform="rotate(28)">
        <stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity=".55"/>
        <stop offset=".5" stop-color="#b9f6ff" stop-opacity=".25"/><stop offset=".62" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <pattern id="${id}k" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r=".9" fill="#fff" opacity=".22"/></pattern>
      <filter id="${id}g" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>
    <ellipse cx="124" cy="111" rx="108" ry="5" fill="#000" opacity=".16"/>
    ${rar === 'epic' ? `<path d="${midPath}" fill="${mid2}" filter="url(#${id}g)" opacity=".9"/>` : ''}
    <path d="${upperPath}" fill="url(#${id}u)"/>
    <path d="${upperPath}" fill="url(#${id}k)"/>
    <path d="${upperPath}" fill="url(#${id}d)"/>
    <path d="M${o(12, 60)}C${o(8, 44)} ${o(10, 30)} ${o(18, 22)}C${o(22, 16)} ${o(32, 14)} ${o(38, 18)}L${o(42, 22)}C${o(36, 36)} ${o(36, 50)} ${o(42, 62)}C${o(28, 61)} ${o(18, 60)} ${o(12, 60)}Z" fill="${dark}" opacity=".55"/>
    <path d="M${o(180, 53)}C${o(210, 59)} ${o(232, 66)} ${o(230, 73)}C${o(214, 75)} ${o(196, 74)} ${o(176, 71)}C${o(180, 66)} ${o(181, 60)} ${o(180, 53)}Z" fill="${dark}" opacity=".35"/>
    <path d="M${o(90, 18)}C${o(95, 8)} ${o(104, 4)} ${o(112, 9)}L${o(114, 18)}Z" fill="${light}"/>
    <path d="M${o(20, 24)}C${o(28, 20)} ${o(34, 20)} ${o(40, 24)}C${o(50, 31)} ${o(62, 34)} ${o(76, 32)}C${o(86, 30)} ${o(92, 22)} ${o(96, 16)}" fill="none" stroke="${dark}" stroke-width="5" stroke-linecap="round"/>
    <path d="M${o(104, 24)}C${o(122, 38)} ${o(150, 50)} ${o(182, 58)}" fill="none" stroke="${dark}" stroke-width="9" stroke-linecap="round" opacity=".28"/>
    <path d="${pts([[60, 50], [98, 38], [94, 46], [132, 34], [92, 58], [97, 49]])}" fill="${mark}"/>
    <path d="${laces}" stroke="${lace}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M${o(20, 22)}C${o(15, 12)} ${o(20, 4)} ${o(28, 8)}" fill="none" stroke="${light}" stroke-width="4" stroke-linecap="round"/>
    <path d="M${o(15, 34)}L${o(14, 48)}" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".75"/>
    ${shiny ? `<path d="${upperPath}" fill="url(#${id}s)"/>` : ''}
    <path d="${midPath}" fill="url(#${id}m)"/>
    <path d="M${(18).toFixed(0)} ${(82 - off(18) * 0.5).toFixed(1)}C26 ${(74 - off(26) * 0.5).toFixed(1)} 66 ${(76 - off(66) * 0.5).toFixed(1)} 98 ${(84 - off(98) * 0.5).toFixed(1)}C68 ${(90 - off(68) * 0.5).toFixed(1)} 30 ${(90 - off(30) * 0.5).toFixed(1)} 18 ${(82 - off(18) * 0.5).toFixed(1)}Z" fill="${shiny ? mark : '#000'}" opacity="${shiny ? 0.85 : 0.09}"/>
    <path d="${line([[22, 84], [70, 92], [160, 93], [222, 82]])}" fill="none" stroke="#000" stroke-opacity=".1" stroke-width="3" stroke-linecap="round"/>
    <path d="${line([[20, 92], [70, 99], [160, 99], [226, 86]])}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
    ${st.plate ? `<path d="${line([[26, 78], [90, 86], [170, 86], [234, 76]])}" fill="none" stroke="${plate}" stroke-width="3.2" stroke-linecap="round"/>` : ''}
    <path d="${outsole}" fill="#1d1d1f"/>
    ${lugs ? `<g fill="#1d1d1f">${lugs}</g>` : ''}
    ${sparkles}
  </svg>`;
}

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
