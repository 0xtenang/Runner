import { db } from './db.js';
import { HeartRateMonitor } from './ble.js';
import { Recorder } from './recorder.js';
import { isNative } from './geo.js';
import { annotate, computeSplits, downsample, speedSeries, units, fmtDist, fmtDur, fmtPace, fmtElev } from './stats.js';
import { game, EarnSession, SNEAKER_TYPES, earnPerEnergy, COIN } from './game.js';
import { renderEarn, sneakerSvg, coinTag, fmtCoins, paceRange, addressAvatar, syncOwnedSneakers } from './earn-view.js';
import { PRICE_ETH } from './collection.js';
import { auth, shortAddress, explorerUrl, SIGN_IN_METHODS } from './auth.js';
import { runOnboarding } from './onboarding.js';
import { settleRun, syncRewards, publicStats, deleteAccount } from './rewards.js';
import { renderRewards } from './rewards-view.js';
import { DEV_WALLET } from './config.js';

// RUNNER is run-only: every activity is a run, recorded or imported.

// ---------------------------------------------------------------- setup
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');

const VERSION = '1.0';
const FEEDBACK_URL = 'https://github.com/0xtenang/Runner/issues/new';
// The phone app is served from the device, so links to the website's own pages need the full address.
const SITE = isNative ? 'https://www.runearn.fun' : '';
const SOURCE_LABEL = { gps: 'RUNNER', fit: 'FIT file', gpx: 'GPX file', tcx: 'TCX file' };
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.2v15.6c0 .8.9 1.3 1.6.9l12-7.8a1 1 0 0 0 0-1.8l-12-7.8C7.9 2.9 7 3.4 7 4.2z" class="fill"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5h3v14H8zM13 5h3v14h-3z" class="fill"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" class="fill"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/><path d="M3.5 12.5h4l1.5-2.5 2.5 5 1.5-2.5h7.5"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.6 9.6h3.6a1.9 1.9 0 0 1 0 3.8H10.4"/></svg>',
  route: '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H13a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h4.8"/></svg>',
  ruler: '<svg viewBox="0 0 24 24"><path d="M4 15 15 4l5 5L9 20z"/><path d="M8 11l2 2M11 8l2 2M14 5l1 1"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 15.5h7M9 8.5h3"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="M2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2" class="fill"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  collapse: '<svg viewBox="0 0 24 24"><path d="M20 4l-6 6M14 5v5h5M4 20l6-6M10 19v-5H5"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1.4-3.7 4.3-5.6 7.5-5.6s6.1 1.9 7.5 5.6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};

const hrm = new HeartRateMonitor();
let earn = null; // EarnSession for the current recording
const rec = new Recorder({
  hr: () => hrm.current(),
  persist: (snap) => db.kvSet('inprogress', { ...snap, earn: earn?.toJSON() }).catch(() => {}),
});
rec.type = 'run';

// Earning runs alongside the recorder, one tick per second while moving.
rec.addEventListener('state', () => {
  if (rec.state === 'recording' && !earn) earn = new EarnSession(game.active, game.energy, game.earnFactor);
  if (rec.state === 'idle') earn = null;
});
// In the phone app, timers can slow down while the screen is locked even though
// GPS keeps recording, so count the real time since the last tick.
let lastEarnTick = 0;
rec.addEventListener('tick', () => {
  const now = Date.now();
  const dt = isNative && lastEarnTick ? Math.min(Math.max((now - lastEarnTick) / 1000, 0), 30) : 1;
  lastEarnTick = now;
  if (rec.state === 'recording' && earn) earn.tick(rec.currentSpeed(), !!hrm.current(), dt);
});

let cleanup = [];
const onCleanup = (fn) => cleanup.push(fn);

function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const MAP_ROUTE = '#E8483B'; // brand vermilion; map tiles are light in both themes, and a white casing keeps it crisp

/** Route line with a white casing so it stands out on any map. */
function routeLine(latlngs, weight = 4) {
  const casing = L.polyline(latlngs, { color: '#fff', weight: weight + 4, opacity: 0.9 });
  const line = L.polyline(latlngs, { color: MAP_ROUTE, weight });
  return L.featureGroup([casing, line]);
}
const runnerName = () => game.state?.profile?.name || 'Runner';
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'R';
const avatar = (cls = '') => `<div class="avatar ${cls}" aria-hidden="true">${esc(initials(runnerName()))}</div>`;

function defaultName(t) {
  const h = new Date(t).getHours();
  const part = h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 14 ? 'Lunch' : h < 18 ? 'Afternoon' : h < 22 ? 'Evening' : 'Night';
  return `${part} Run`;
}

/** "6 October 2026 at 07:17" (or Today / Yesterday). */
function fmtDate(t) {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `Today at ${time}`;
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })} at ${time}`;
}

/** Compact duration: "38m 57s", "1h 05m". */
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

async function listRuns() {
  return (await db.listActivities()).filter((a) => (a.type || 'run') === 'run');
}

/** Turns parsed or recorded data into a stored run. */
function buildActivity({ points = [], name, startTime, summary, device }, source) {
  points = points.filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  const st = annotate(points);
  const s = summary || {};
  const pick = (a, b) => (a != null && a > 0 ? a : b);
  const t0 = startTime || points[0]?.t || Date.now();
  const act = {
    id: uid(),
    type: 'run',
    source,
    device: device || null,
    startTime: t0,
    distance: pick(s.distance, st.distance),
    movingTime: pick(s.movingTime, st.movingTime),
    elapsedTime: pick(s.elapsedTime, st.elapsedTime),
    elevGain: pick(s.elevGain, st.elevGain),
    avgHr: pick(s.avgHr, st.avgHr),
    maxHr: pick(s.maxHr, st.maxHr),
    preview: downsample(points.filter((p) => p.lat != null), 150).map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5)]),
    createdAt: Date.now(),
  };
  act.name = name || defaultName(t0);
  const clean = points.map(({ cd, mt, ...r }) => r);
  return { act, points: clean };
}

function startOfWeek(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

/** Consecutive weeks with at least one run (this week can still be pending). */
function weekStreak(runs) {
  const weeks = new Set(runs.map((a) => startOfWeek(a.startTime)));
  let wk = startOfWeek();
  if (!weeks.has(wk)) wk -= 7 * 864e5;
  let n = 0;
  while (weeks.has(wk)) { n++; wk = startOfWeek(wk - 3 * 864e5); }
  return n;
}

// ---------------------------------------------------------------- chrome
function setTopbar({ left = '', title = '', right = '' } = {}) {
  $('#tb-left').innerHTML = left;
  $('#tb-title').innerHTML = title;
  $('#tb-right').innerHTML = right;
  updateWalletChip();
}
const iconLink = (href, icon, label) => `<a class="icon-btn" href="${href}" aria-label="${label}">${icon}</a>`;
const backLink = (href = '#/home') => iconLink(href, ICON.back, 'Back');
const walletChip = () => '<a id="wallet-chip" class="wallet-chip" href="#/earn" aria-label="Wallet"></a>';
const logo = '<span class="logo">RUNN<em>ER</em></span>';

function updateWalletChip() {
  const el = $('#wallet-chip');
  if (el && game.state) el.innerHTML = coinTag(game.coins + (earn?.coins || 0));
}

function updateRecBanner() {
  const onRecord = (location.hash || '').startsWith('#/record');
  $('#rec-banner').hidden = rec.state === 'idle' || onRecord;
  $('#rec-banner-time').textContent = rec.state === 'paused' ? 'Paused' : fmtDur(rec.activeSeconds);
}
rec.addEventListener('tick', updateRecBanner);
rec.addEventListener('state', updateRecBanner);
rec.addEventListener('tick', updateWalletChip);
game.addEventListener('change', updateWalletChip);

// ---------------------------------------------------------------- router
async function route() {
  cleanup.forEach((f) => { try { f(); } catch (e) { console.warn(e); } });
  cleanup = [];
  const [, page = 'home', arg] = (location.hash || '#/home').split('/');
  const tab = { activity: 'home', feed: 'home', settings: 'you', devices: 'you' }[page] || page;
  $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.body.classList.toggle('immersive', page === 'record');
  updateRecBanner();
  window.scrollTo(0, 0);
  try {
    if (page === 'record') return renderRecord();
    if (page === 'activity') return await renderActivity(arg);
    if (page === 'earn') { setTopbar({ title: 'Earn', right: walletChip() }); return renderEarn(view, { toast, onCleanup }); }
    if (page === 'rewards') { setTopbar({ title: 'Rewards', right: walletChip() }); return renderRewards(view, { toast, onCleanup }); }
    if (page === 'you') return await renderYou(arg);
    if (page === 'settings') return renderSettings();
    if (page === 'devices') return renderDevices();
    return await renderHome();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<section class="page"><div class="card">Something went wrong: ${esc(e.message)}</div></section>`;
  }
}

// ---------------------------------------------------------------- home feed
function routeSvg(preview, cls = 'route-thumb') {
  if (!preview || preview.length < 2) return '';
  const lat0 = preview[0][0];
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xy = preview.map(([la, lo]) => [lo * k, -la]);
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX || 1e-6, h = maxY - minY || 1e-6;
  const W = 100, H = 100, pad = 10;
  const s = Math.min((W - pad * 2) / w, (H - pad * 2) / h);
  const ox = (W - w * s) / 2, oy = (H - h * s) / 2;
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${((x - minX) * s + ox).toFixed(1)},${((y - minY) * s + oy).toFixed(1)}`).join('');
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/></svg>`;
}

const flame = (n) => `<div class="flame ${n ? 'on' : ''}"><svg viewBox="0 0 48 60" aria-hidden="true"><path d="M24 2c3 10 14 16 14 32a14 14 0 0 1-28 0c0-8 4-13 7-17 1 5 3 8 6 9-2-9 0-17 1-24z"/></svg><b>${n}</b></div>`;

function post(a) {
  const src = a.device ? `${a.device}` : SOURCE_LABEL[a.source] || '';
  return `
    <article class="post">
      <a class="post-link" href="#/activity/${a.id}">
        <div class="post-head">
          ${avatar()}
          <div><b>${esc(runnerName())}</b><span>${fmtDate(a.startTime)} · ${esc(src)}</span></div>
        </div>
        <h2 class="post-title">${esc(a.name)}</h2>
        <div class="post-stats">
          <div><span>Distance</span><b>${fmtDist(a.distance)}</b></div>
          <div><span>Pace</span><b>${fmtPace(a.distance, a.movingTime)}</b></div>
          <div><span>Time</span><b>${fmtTime(a.movingTime)}</b></div>
        </div>
        ${a.earn?.coins > 0 ? `<div class="post-earn">${coinTag(a.earn.coins, true)} ${COIN} earned${a.earn.sneakerLabel ? ` · ${esc(a.earn.sneakerLabel)}` : ''}</div>` : ''}
      </a>
      ${a.preview?.length > 1 ? `<div class="post-map" data-map="${a.id}" role="link" tabindex="-1">${routeSvg(a.preview, 'route-thumb fallback')}</div>` : ''}
    </article>`;
}

/** Non-interactive Leaflet map, created when the element scrolls into view. */
function lazyMaps(acts) {
  const byId = Object.fromEntries(acts.map((a) => [a.id, a]));
  const maps = [];
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const a = byId[en.target.dataset.map];
      en.target.innerHTML = '';
      const map = L.map(en.target, {
        zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
        boxZoom: false, keyboard: false, touchZoom: false, tap: false,
      });
      map.attributionControl.setPrefix(false);
      baseLayer().addTo(map);
      const line = routeLine(a.preview);
      map.fitBounds(line.getBounds(), { padding: [20, 20] }); // a map needs a view before layers are added
      line.addTo(map);
      maps.push(map);
    }
  }, { rootMargin: '200px' });
  $$('[data-map]').forEach((el) => {
    io.observe(el);
    el.addEventListener('click', () => { location.hash = `#/activity/${el.dataset.map}`; });
  });
  onCleanup(() => { io.disconnect(); maps.forEach((m) => m.remove()); });
}

async function renderHome() {
  setTopbar({ title: logo, right: walletChip() });
  const runs = await listRuns();
  const streak = weekStreak(runs);
  const ranThisWeek = runs.some((a) => a.startTime >= startOfWeek());
  view.innerHTML = `
    <section class="feed">
      <div class="streak-card">
        <div class="row between"><h3>Your streak</h3><a class="link" href="#/you">View progress</a></div>
        <div class="streak-body">
          <div class="streak-num">${flame(streak)}<span>Week${streak === 1 ? '' : 's'}</span></div>
          <p>${!streak ? 'Start your streak by logging a run.' : ranThisWeek ? `Nice — you've run ${streak} week${streak === 1 ? '' : 's'} in a row.` : 'Run this week to keep your streak alive.'}</p>
          <a class="btn primary pill" href="#/record">Record now</a>
        </div>
      </div>
      <div class="community-stats" id="community-stats" hidden></div>
      ${appBanner()}
      ${runs.length ? runs.map(post).join('') : `
        <div class="post empty">
          ${ICON.route}
          <h3>No runs yet</h3>
          <p class="muted">Record your first run with your phone — RUNNER tracks the route, pace and splits.</p>
          <div class="actions-row" style="justify-content:center">
            <a class="btn primary pill" href="#/record">Record a run</a>
          </div>
        </div>`}
    </section>`;
  lazyMaps(runs.filter((a) => a.preview?.length > 1));
  fillCommunityStats();
  view.querySelector('[data-act="hide-app-banner"]')?.addEventListener('click', () => {
    try { localStorage.setItem(APP_BANNER_KEY, '1'); } catch { /* ignore */ }
    view.querySelector('.app-banner')?.remove();
  });
}

/** Front-page totals: runners who have earned and RUNNER earned by runners (from the rewards server). */
const fmtBig = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : Math.round(n).toLocaleString());
async function fillCommunityStats() {
  const s = await publicStats();
  const el = document.getElementById('community-stats');
  if (!el || !s || s.since == null) return;
  el.innerHTML = `
    <div><b>${Number(s.runners || 0).toLocaleString()}</b><span>Runners</span></div>
    <div><b>${fmtBig(Number(s.earned || 0))}</b><span>$${COIN} earned</span></div>
    <p>${Number(s.sneakers || 0).toLocaleString()} Genesis sneakers owned${s.claimed != null ? ` · ${fmtBig(Number(s.claimed))} ${COIN} claimed to wallets` : ''}</p>`;
  el.hidden = false;
}

// Website only: point people to the Android app, which keeps recording with the screen locked.
const APP_BANNER_KEY = 'runner.appBanner.hidden';
function appBanner() {
  if (isNative) return '';
  try { if (localStorage.getItem(APP_BANNER_KEY)) return ''; } catch { /* show it */ }
  return `<div class="app-banner">
      <span class="app-banner-icon">${ICON.phone}</span>
      <div><b>RUNNER for Android is out</b><span class="muted small">Keeps recording your run with the screen locked.</span></div>
      <a class="btn primary pill sm" href="/download">Download</a>
      <button class="icon-btn sm" data-act="hide-app-banner" aria-label="Hide">×</button>
    </div>`;
}

// ---------------------------------------------------------------- map styles
// Free tile sources, fine for now. Heavy production use should move to a
// keyed provider (e.g. MapTiler / Stadia) to respect the OSM tile usage policy.
const MAP_STYLES = {
  standard: { label: 'Standard', url: TILE_URL, attr: TILE_ATTR, max: 19, swatch: 'linear-gradient(135deg,#efe9dd,#cfe3c2)' },
  light: { label: 'Light', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attr: `${TILE_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`, max: 20, sub: 'abcd', swatch: 'linear-gradient(135deg,#fafafa,#e3e3e3)' },
  dark: { label: 'Dark', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr: `${TILE_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`, max: 20, sub: 'abcd', swatch: 'linear-gradient(135deg,#2b2b2e,#111)' },
  satellite: { label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Imagery &copy; Esri, Maxar, Earthstar Geographics', max: 19, swatch: 'linear-gradient(135deg,#4f6b3c,#2a3d2a)' },
  terrain: { label: 'Terrain', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attr: `${TILE_ATTR}, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`, max: 17, swatch: 'linear-gradient(135deg,#d9e4bd,#b9c79a)' },
};
const mapPref = {
  get() { try { const v = localStorage.getItem('runearn.map'); return MAP_STYLES[v] ? v : 'standard'; } catch { return 'standard'; } },
  set(v) { try { localStorage.setItem('runearn.map', v); } catch { /* ignore */ } },
};
function baseLayer(key = mapPref.get()) {
  const st = MAP_STYLES[key];
  return L.tileLayer(st.url, { attribution: st.attr, maxZoom: st.max, subdomains: st.sub || 'abc' });
}

// ---------------------------------------------------------------- live run state
// Kept outside the Record screen so it keeps counting while you browse other tabs.
let live = { startedAt: 0, splits: [], lastTick: 0, gapSec: 0, lastGap: 0 };
rec.addEventListener('state', () => {
  if (rec.state === 'recording' && live.startedAt !== rec.startedAt) {
    live = { startedAt: rec.startedAt, splits: [], lastTick: Date.now(), gapSec: 0, lastGap: 0 };
  }
});
rec.addEventListener('tick', () => {
  const now = Date.now();
  if (rec.state !== 'recording') { live.lastTick = now; return; }
  // Phones suspend web apps in the background (screen locked / app switched),
  // so ticks stop. A long gap between ticks means tracking was paused.
  const gap = (now - live.lastTick) / 1000;
  if (live.lastTick && gap > 8 && !isNative) { // the phone app keeps GPS running
    live.gapSec += gap;
    live.lastGap = gap;
    toast(`GPS was paused for ${fmtDur(gap)} while RUNNER wasn't on screen. Keep the app open with the screen on while you run.`, 6000);
  }
  live.lastTick = now;
  const unit = units.meters();
  const done = live.splits.length;
  if (rec.distance >= (done + 1) * unit) {
    const prevAt = live.splits[done - 1]?.at || 0;
    live.splits.push({ at: rec.activeSeconds, time: rec.activeSeconds - prevAt });
  }
});

/** "00:00" / "1:02:03", or always "00:00:00" when long = true. */
function fmtClock(sec, long = false) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return long ? `${p(h)}:${p(m)}:${p(x)}` : h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
}

// Screen wake while recording on the website: the browser's Wake Lock API only (no hidden media, which
// could take over the phone's media controls or pause music). Best effort — browsers without it, or a
// user locking the phone, still suspend the page; the phone app records with the screen off.
const keepAwake = {
  lock: null,
  async on() {
    if (isNative || !navigator.wakeLock) return;
    try { this.lock = await navigator.wakeLock.request('screen'); } catch { /* not allowed right now */ }
  },
  off() {
    this.lock?.release?.().catch(() => {});
    this.lock = null;
  },
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && rec.state !== 'idle') keepAwake.on();
});

// ---------------------------------------------------------------- record
let recView = (() => { try { return localStorage.getItem('runearn.recview') === 'stats' ? 'stats' : 'map'; } catch { return 'map'; } })();

function renderRecord() {
  const U = units.label();
  view.innerHTML = `
    <section class="rec" id="rec">
      <div id="rmap" class="rec-map"></div>
      <a class="icon-btn rec-close" href="#/home" aria-label="Close (recording continues)">${ICON.down}</a>
      <div class="gps-pill" id="gps"><i></i><span>Locating…</span></div>
      <div class="rec-bottom">
      <div class="map-ctrls">
        <button class="icon-btn" data-ctl="layers" aria-label="Map style">${ICON.layers}</button>
        <button class="icon-btn" data-ctl="locate" aria-label="Center on my location">${ICON.locate}</button>
      </div>
      <div class="rec-card">
        <div class="rec-card-top"><span>Run</span><button class="rc-toggle" data-ctl="expand" aria-label="Show big stats">${ICON.expand}</button></div>
        <div class="rc-stats">
          <div><b data-f="time">00:00</b><span>Time</span></div>
          <div><b data-f="avg">–:––</b><span>Avg. pace (/${U})</span></div>
          <div><b data-f="dist">0.00</b><span>Distance (${U})</span></div>
        </div>
      </div>
      <div class="rec-sheet" id="sheet"></div>
      </div>
      <div class="stats-view" id="stats-view" hidden>
        <div class="sv-top"><b data-f="clock">00:00:00</b><button class="rc-toggle" data-ctl="collapse" aria-label="Back to map">${ICON.collapse}</button></div>
        <div class="earn-status" data-f="earn"></div>
        <div class="sv-block"><b data-f="split">–:––</b><span>Split avg. pace (/${U})</span></div>
        <div class="sv-block"><b class="sv-huge" data-f="dist">0.00</b><span>Distance (${U})</span></div>
        <div class="sv-splits" data-f="bars"></div>
        <span class="sv-cap">Splits (${U})</span>
        <div class="live-mini">
          <div><span>Heart rate</span><b class="hr-val" data-f="hr">–</b></div>
          <div><span>Earned</span><b data-f="coins">${coinTag(0)}</b></div>
          <div><span>Energy</span><b data-f="energy">–</b></div>
        </div>
        <div class="sv-ctrls" data-f="ctrls"></div>
      </div>
    </section>`;

  const start = rec.lastFix ? [rec.lastFix.lat, rec.lastFix.lon] : [-7.7956, 110.3695];
  const map = L.map('rmap', { zoomControl: false }).setView(start, rec.lastFix ? 16 : 13);
  map.attributionControl.setPrefix(false);
  let base = baseLayer().addTo(map);
  const casing = L.polyline(rec.points.map((p) => [p.lat, p.lon]), { color: '#fff', weight: 9, opacity: 0.9 }).addTo(map);
  const line = L.polyline(rec.points.map((p) => [p.lat, p.lon]), { color: MAP_ROUTE, weight: 5 }).addTo(map);
  const me = L.circleMarker(start, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 });
  if (rec.lastFix) me.addTo(map);
  let follow = true;
  map.on('dragstart', () => { follow = false; });
  onCleanup(() => map.remove());

  const setF = (name, html, isHtml = false) => $$(`[data-f="${name}"]`).forEach((el) => { if (isHtml) el.innerHTML = html; else el.textContent = html; });

  const gps = $('#gps');
  const onPos = (e) => {
    const f = e.detail;
    me.setLatLng([f.lat, f.lon]);
    if (!map.hasLayer(me)) { me.addTo(map); map.setView([f.lat, f.lon], 16); }
    else if (follow) map.panTo([f.lat, f.lon], { animate: true });
    const acc = Math.round(f.acc ?? 0);
    gps.className = `gps-pill ${acc <= 15 ? 'good' : acc <= 35 ? 'weak' : 'bad'}`;
    gps.querySelector('span').textContent = acc <= 35 ? 'GPS ready' : `Weak GPS · ±${acc} m`;
  };
  const onErr = (e) => {
    gps.className = 'gps-pill bad';
    gps.querySelector('span').textContent = e.detail.message;
  };
  const onPoint = (e) => { casing.addLatLng([e.detail.lat, e.detail.lon]); line.addLatLng([e.detail.lat, e.detail.lon]); };

  const connectSensor = async () => {
    if (hrm.connected) { if (confirm(`Disconnect ${hrm.device?.name || 'heart-rate sensor'}?`)) hrm.disconnect(); return; }
    try { await hrm.connect(); toast('Heart-rate sensor connected · +10% coins'); }
    catch (err) { if (err.name !== 'NotFoundError') toast(err.message, 4000); }
  };

  const ctrls = () => (rec.state === 'recording'
    ? `<button class="pill-btn pause" data-ctl="pause">${ICON.pause}<span>Pause</span></button>`
    : `<button class="pill-btn resume" data-ctl="resume">${ICON.play}<span>Resume</span></button>
       <button class="pill-btn finish" data-ctl="finish">${ICON.stop}<span>Finish</span></button>`);

  // ----- before the run: start sheet
  const idleSheet = () => {
    const s = game.active;
    const z = s && SNEAKER_TYPES[s.type];
    const energy = game.energy;
    const hr = hrm.current();
    return `
      <div class="sheet-handle"></div>
      <div class="start-row">
        <a class="round-opt" href="#/earn" aria-label="Sneaker">
          <span class="round">${s ? sneakerSvg(s, 'sneaker-art xs') : ICON.coin}</span>
          <span>${s ? z.short : 'Sneaker'}</span>
        </a>
        <button class="start-btn" data-ctl="start" aria-label="Start run">${ICON.play}<span>Start</span></button>
        <button class="round-opt" data-ctl="sensor" aria-label="Heart-rate sensor">
          <span class="round ${hrm.connected ? 'on' : ''}">${ICON.heart}</span>
          <span>${hrm.connected ? (hr ? `${hr} bpm` : 'Connected') : 'Sensor'}</span>
        </button>
      </div>
      ${isNative ? '' : `<div class="keep-open">${ICON.sun}<span><b>Keep RUNNER open, screen on.</b> Locking the phone pauses GPS.</span></div>`}
      <div class="sheet-list">
        ${s ? `
        <a class="sheet-row" href="#/earn">
          ${ICON.coin}
          <div><b>${energy >= 0.05 ? `≈ ${fmtCoins(earnPerEnergy(s, game.earnFactor))} ${COIN} per energy` : 'Out of energy — tracking only'}</b>
          <span>⚡ ${energy.toFixed(1)}/${game.maxEnergy} · earn at ${paceRange(z)}</span></div>
          ${ICON.chev}
        </a>` : `
        <a class="sheet-row" href="#/earn">
          ${ICON.coin}
          <div><b>Get a sneaker NFT to earn ${COIN}</b>
          <span>From ${PRICE_ETH.common} ETH · you can still track runs without one</span></div>
          ${ICON.chev}
        </a>`}
      </div>`;
  };

  // ----- during the run (map view): status, quick numbers, controls
  const liveSheet = () => `
    <div class="sheet-handle"></div>
    <div class="earn-status" data-f="earn"></div>
    <div class="live-mini">
      <div><span>Pace now</span><b data-f="cur">–</b></div>
      <div><span>Heart rate</span><b class="hr-val" data-f="hr">–</b></div>
      <div><span>Earned</span><b data-f="coins">${coinTag(0)}</b></div>
      <div><span>Energy</span><b data-f="energy">–</b></div>
    </div>
    <div class="sv-ctrls" data-f="ctrls">${ctrls()}</div>`;

  const renderBars = () => {
    const unit = units.meters();
    const lastAt = live.splits.at(-1)?.at || 0;
    const curDist = rec.distance - live.splits.length * unit;
    const curTime = rec.activeSeconds - lastAt;
    const done = live.splits.slice(-2).map((sp) => ({ pace: sp.time, label: fmtPace(unit, sp.time, false) }));
    const cur = { pace: curDist > 20 ? (curTime / curDist) * unit : null, label: curDist > 20 ? fmtPace(curDist, curTime, false) : '–:––', current: true };
    const bars = [...done, cur];
    while (bars.length < 3) bars.push({ empty: true });
    const fastest = Math.min(...bars.filter((b) => b.pace).map((b) => b.pace));
    return bars.map((b) => (b.empty ? '<div class="bar empty"></div>' : `
      <div class="bar ${b.current ? 'current' : ''}">
        <span>${b.label}</span>
        <i style="height:${b.pace ? Math.round(30 + 60 * (fastest / b.pace)) : 30}px"></i>
      </div>`)).join('');
  };

  const updateLive = () => {
    const unit = units.meters();
    const recording = rec.state !== 'idle';
    setF('time', recording ? fmtClock(rec.activeSeconds) : '00:00');
    setF('clock', fmtClock(recording ? rec.activeSeconds : 0, true));
    setF('avg', recording ? fmtPace(rec.distance, rec.activeSeconds, false) : '–:––');
    setF('dist', fmtDist(recording ? rec.distance : 0, false));
    const lastAt = live.splits.at(-1)?.at || 0;
    const curDist = rec.distance - live.splits.length * unit;
    setF('split', recording && curDist > 20 ? fmtPace(curDist, rec.activeSeconds - lastAt, false) : '–:––');
    const v = rec.currentSpeed();
    setF('cur', v ? fmtPace(v, 1, false) : '–');
    setF('hr', String(hrm.current() ?? '–'));
    setF('coins', coinTag(earn?.coins || 0), true);
    setF('energy', earn?.sneaker ? `⚡ ${earn.energyLeft.toFixed(1)}` : '–');
    setF('bars', renderBars(), true);

    const z = earn?.sneaker && SNEAKER_TYPES[earn.sneaker.type];
    const pace = v ? `${fmtPace(v, 1, false)} /${units.label()}` : '';
    const msg = !recording ? ['off', 'Ready']
      : rec.state === 'paused' ? ['off', 'Paused']
      : !z ? ['off', 'No sneaker equipped — tracking only']
      : {
        earning: ['earning', `Earning${hrm.current() ? ' · HR bonus +10%' : ''}`],
        waiting: ['off', 'Waiting for GPS…'],
        slow: ['warn', `Too slow (${pace}) — speed up to earn`],
        fast: ['warn', `Too fast (${pace}) — ease off to earn`],
        noenergy: ['off', 'Out of energy — still tracking your run'],
        vehicle: ['bad', 'Vehicle speed detected — not earning'],
        nosneaker: ['off', 'No sneaker equipped'],
      }[earn?.status || 'waiting'];
    $$('[data-f="earn"]').forEach((el) => { el.className = `earn-status ${msg[0]}`; el.textContent = msg[1]; });
  };

  const applyView = () => {
    $('#stats-view').hidden = recView !== 'stats';
    $('#rec').classList.toggle('stats-mode', recView === 'stats');
  };

  const renderSheet = () => {
    const isLive = rec.state !== 'idle';
    $('#rec').classList.toggle('live', isLive);
    $('#sheet').innerHTML = isLive ? liveSheet() : idleSheet();
    $$('[data-f="ctrls"]').forEach((el) => { el.innerHTML = isLive ? ctrls() : `<button class="pill-btn resume" data-ctl="start">${ICON.play}<span>Start</span></button>`; });
    applyView();
    setTimeout(() => map.invalidateSize(), 50);
    updateLive();
  };

  const openLayers = (btn) => {
    document.querySelector('.layers-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'layers-pop';
    pop.innerHTML = `<b>Map style</b>${Object.entries(MAP_STYLES).map(([k, st]) => `
      <button data-style="${k}" class="${mapPref.get() === k ? 'on' : ''}"><i style="background:${st.swatch}"></i>${st.label}</button>`).join('')}`;
    $('#rec').appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = `${Math.max(12, r.top - 8)}px`;
    pop.onclick = (e) => {
      const b = e.target.closest('[data-style]');
      if (!b) return;
      mapPref.set(b.dataset.style);
      map.removeLayer(base);
      base = baseLayer().addTo(map);
      base.bringToBack();
      pop.remove();
    };
    setTimeout(() => document.addEventListener('click', function off(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', off); }
    }), 0);
  };

  $('#rec').onclick = async (e) => {
    const b = e.target.closest('[data-ctl]');
    if (!b) return;
    switch (b.dataset.ctl) {
      case 'start':
        rec.start('run');
        follow = true;
        line.setLatLngs([]);
        casing.setLatLngs([]);
        await keepAwake.on();
        break;
      case 'pause': rec.pause(); break;
      case 'resume': rec.resume(); break;
      case 'finish': finishRecording(); break;
      case 'sensor': connectSensor(); break;
      case 'layers': openLayers(b); break;
      case 'locate':
        if (!rec.lastFix) { toast('Waiting for GPS…'); break; }
        follow = true;
        map.setView([rec.lastFix.lat, rec.lastFix.lon], Math.max(map.getZoom(), 17));
        break;
      case 'expand':
      case 'collapse':
        recView = b.dataset.ctl === 'expand' ? 'stats' : 'map';
        try { localStorage.setItem('runearn.recview', recView); } catch { /* ignore */ }
        applyView();
        setTimeout(() => map.invalidateSize(), 50);
        break;
    }
  };

  const onHr = () => (rec.state === 'idle' ? renderSheet() : updateLive());
  rec.addEventListener('position', onPos);
  rec.addEventListener('gpserror', onErr);
  rec.addEventListener('point', onPoint);
  rec.addEventListener('tick', updateLive);
  rec.addEventListener('state', renderSheet);
  hrm.addEventListener('hr', onHr);
  hrm.addEventListener('change', onHr);
  onCleanup(() => {
    rec.removeEventListener('position', onPos);
    rec.removeEventListener('gpserror', onErr);
    rec.removeEventListener('point', onPoint);
    rec.removeEventListener('tick', updateLive);
    rec.removeEventListener('state', renderSheet);
    hrm.removeEventListener('hr', onHr);
    hrm.removeEventListener('change', onHr);
    if (rec.state === 'idle') rec.stopGps(); // keep GPS alive while recording in the background
  });

  rec.ensureGps();
  if (rec.lastFix) onPos({ detail: rec.lastFix });
  renderSheet();
}

/** Toast text after saving a run, including what the rewards server decided. */
function earnToast(e, saved) {
  if (e?.pending) return `${saved} · reward will be checked when you're back online`;
  if (e?.rejected) return `${saved} · no reward: ${e.rejected}`;
  if (e?.voided) return `${saved} · not counted (vehicle speeds)`;
  if (e?.suspendedUntil !== undefined && e?.decision === 'voided') return `${saved} · no reward — wallet suspended ${e.suspendedUntil ? `until ${new Date(e.suspendedUntil).toLocaleDateString()}` : 'permanently'} (fair-play strikes)`;
  if (e?.decision === 'voided') return `${saved} · no reward: ${e.reasons?.[0] || 'this run looks unreal'} — strike ${e.strikes}/${e.strikeLimit}`;
  if (e?.decision === 'partial') return `${saved} · +${fmtCoins(e.coins)} ${COIN} (${e.payPct}% — ${e.reasons?.[0] || 'some signs looked unusual'}), usable in 24 h`;
  if (e?.capped) return `${saved} · +${fmtCoins(e.coins)} ${COIN} — today's RUNNER emission is used up`;
  if (e?.held && e.coins > 0) return `${saved} · +${fmtCoins(e.coins)} ${COIN} verified — usable in 24 h`;
  return e?.coins > 0 ? `${saved} · +${fmtCoins(e.coins)} ${COIN}${e.server ? ' (verified)' : ''}` : saved;
}

async function finishRecording() {
  if (rec.points.length < 2) {
    if (confirm('Not enough GPS data was recorded to save this run. Discard it?')) {
      rec.discard();
      db.kvDel('inprogress').catch(() => {});
      keepAwake.off();
    }
    return;
  }
  const session = earn?.toJSON();
  const gapSec = Math.round(live.gapSec);
  const out = rec.finish();
  keepAwake.off();
  const { act, points } = buildActivity({ startTime: out.startedAt, points: out.points }, 'gps');
  act.movingTime = Math.min(act.movingTime || out.activeSeconds, out.activeSeconds) || out.activeSeconds;
  if (gapSec > 0) act.gapSec = gapSec;
  if (session) act.earn = await settleRun(session, act.id, out.points, { steps: await out.steps, mockFixes: out.mockFixes });
  else out.steps.catch(() => {});
  await db.saveActivity(act, points);
  await db.kvDel('inprogress').catch(() => {});
  rec.stopGps();
  toast(earnToast(act.earn, 'Run saved'), 4500);
  location.hash = `#/activity/${act.id}`;
}

// ---------------------------------------------------------------- run detail
function lineChart(canvas, data, { color, reverse = false, fmtY, fill = false }) {
  const muted = cssVar('--muted'), grid = cssVar('--line');
  return new Chart(canvas, {
    type: 'line',
    data: { datasets: [{ data, borderColor: color, backgroundColor: color + '26', fill, pointRadius: 0, borderWidth: 2, tension: 0.3, spanGaps: true }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { title: (i) => `${i[0].parsed.x.toFixed(2)} ${units.label()}`, label: (i) => fmtY(i.parsed.y) } },
      },
      scales: {
        x: { type: 'linear', min: 0, ticks: { color: muted, maxTicksLimit: 6, callback: (v) => `${+v.toFixed(v < 1 ? 2 : 1)}` }, grid: { display: false }, border: { display: false } },
        y: { reverse, ticks: { color: muted, maxTicksLimit: 4, callback: fmtY }, grid: { color: grid }, border: { display: false } },
      },
    },
  });
}

function earnCard(a) {
  if (a.source !== 'gps') {
    return '<div class="note">Imported runs count toward your stats and streak but don\'t earn coins — only runs recorded live with GPS earn.</div>';
  }
  const e = a.earn;
  if (!e) return '';
  if (e.voided) return '<div class="note warn">No coins earned — most of this run was at vehicle speed.</div>';
  return `
    <div class="card earn-card">
      <div class="row between">
        <h4 style="margin:0">Earnings</h4>
        <span class="row">${e.hrVerified ? '<span class="badge">HR verified</span>' : ''}</span>
      </div>
      <div class="earn-total">${coinTag(e.coins, true)} <small>${COIN}</small></div>
      <div class="stats-grid">
        <div><span class="lbl">Energy used</span><b>⚡ ${(+e.energy).toFixed(2)}</b></div>
        <div><span class="lbl">Time earning</span><b>${fmtDur(e.zoneSec)}</b></div>
        <div><span class="lbl">Sneaker</span><b>${e.sneakerLabel ? esc(e.sneakerLabel.split(' #')[0].replace(' Runner', '')) : '–'}</b></div>
      </div>
      <div class="muted small">${e.sneakerLabel ? `Sneaker: ${esc(e.sneakerLabel)}` : ''}${e.coins <= 0 && !e.energy ? ' · Run inside your sneaker\'s pace zone (with energy left) to earn.' : ''}</div>
    </div>`;
}

async function renderActivity(id) {
  setTopbar({ left: backLink(), title: 'Run' });
  const a = await db.getActivity(id);
  if (!a) { view.innerHTML = '<section class="page"><div class="card">Run not found. <a class="link" href="#/home">Back home</a></div></section>'; return; }
  const pts = (await db.getStream(id)) || [];
  annotate(pts);
  const gpsPts = pts.filter((p) => p.lat != null);
  const splits = computeSplits(pts, units.meters());
  const hasHr = pts.some((p) => p.hr);
  const hasEle = pts.some((p) => p.ele != null);
  const src = a.device || SOURCE_LABEL[a.source];
  const fastest = Math.min(...splits.map((s) => s.time / s.dist).filter((v) => v > 0));

  view.innerHTML = `
    <section class="detail">
      <div class="detail-top">
        <div class="post-head">${avatar()}<div><b>${esc(runnerName())}</b><span>${fmtDate(a.startTime)} · ${esc(src)}</span></div></div>
        <h1 id="a-name" class="post-title" title="Tap to rename">${esc(a.name)}</h1>
        <div class="post-stats">
          <div><span>Distance</span><b>${fmtDist(a.distance)}</b></div>
          <div><span>Pace</span><b>${fmtPace(a.distance, a.movingTime)}</b></div>
          <div><span>Time</span><b>${fmtTime(a.movingTime)}</b></div>
        </div>
      </div>
      ${gpsPts.length > 1 ? '<div id="amap" class="detail-map"></div>' : '<div class="page"><div class="note">No GPS track — this looks like a treadmill run.</div></div>'}
      <div class="page">
        <div class="card">
          <div class="stats-grid">
            <div><span class="lbl">Elevation gain</span><b>${fmtElev(a.elevGain)}</b></div>
            <div><span class="lbl">Avg heart rate</span><b>${a.avgHr ? `${Math.round(a.avgHr)} bpm` : '–'}</b></div>
            <div><span class="lbl">Elapsed time</span><b>${fmtTime(a.elapsedTime)}</b></div>
          </div>
        </div>
        ${a.gapSec > 20 ? `<div class="note warn">GPS was paused for ${fmtTime(a.gapSec)} during this run because RUNNER wasn't on screen (phone locked or another app open). Distance from that time may be missing.</div>` : ''}
        ${earnCard(a)}
        ${splits.length ? `
          <div class="card">
            <h4>Splits</h4>
            <table class="splits">
              <thead><tr><th>${units.label().toUpperCase()}</th><th>Pace</th><th style="width:40%"></th><th>Elev</th>${hasHr ? '<th>HR</th>' : ''}</tr></thead>
              <tbody>
                ${splits.map((s) => {
                  const spd = s.time / s.dist;
                  const w = Math.max(12, (100 * fastest) / spd); // fastest split = full bar
                  return `<tr>
                    <td>${s.partial ? (s.dist / units.meters()).toFixed(2) : s.n}</td>
                    <td><b>${fmtPace(s.dist, s.time, false)}</b></td>
                    <td><div class="bar ${spd === fastest ? 'fast' : ''}" style="width:${Math.min(100, w).toFixed(0)}%"></div></td>
                    <td class="muted">${s.elev == null ? '–' : (s.elev >= 0 ? '+' : '') + fmtElev(s.elev)}</td>
                    ${hasHr ? `<td class="muted">${s.hr ?? '–'}</td>` : ''}
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>` : ''}
        ${pts.length > 5 ? '<div class="card"><h4>Pace</h4><div class="chart-box"><canvas id="c-pace"></canvas></div></div>' : ''}
        ${hasHr ? '<div class="card"><h4>Heart rate</h4><div class="chart-box"><canvas id="c-hr"></canvas></div></div>' : ''}
        ${hasEle ? '<div class="card"><h4>Elevation</h4><div class="chart-box"><canvas id="c-ele"></canvas></div></div>' : ''}
        <div class="actions-row">
          <button class="btn pill" id="b-gpx">Export GPX</button>
          <button class="btn pill danger" id="b-del">Delete run</button>
        </div>
      </div>
    </section>`;

  if (gpsPts.length > 1) {
    const map = L.map('amap', { zoomControl: false, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    baseLayer().addTo(map);
    // Draw each recorded segment separately so pauses don't draw a straight line.
    const segs = [[]];
    for (const p of gpsPts) { if (p.b && segs.at(-1).length) segs.push([]); segs.at(-1).push([p.lat, p.lon]); }
    const line = routeLine(segs);
    map.fitBounds(line.getBounds(), { padding: [24, 24] }); // a map needs a view before layers are added
    line.addTo(map);
    L.circleMarker(segs[0][0], { radius: 7, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).addTo(map);
    L.circleMarker(segs.at(-1).at(-1), { radius: 7, color: '#fff', weight: 2, fillColor: '#141414', fillOpacity: 1 }).addTo(map); // finish: dark, so it stands out from the orange line
    onCleanup(() => map.remove());
  }

  const charts = [];
  const sample = downsample(pts.map((p, i) => i), 500);
  const x = (i) => pts[i].cd / units.meters();
  if ($('#c-pace')) {
    const sp = speedSeries(pts);
    const data = sample.map((i) => {
      const v = sp[i];
      return { x: x(i), y: !v || v < 0.3 ? null : Math.min(units.meters() / v, 20 * 60) };
    });
    charts.push(lineChart($('#c-pace'), data, { color: cssVar('--route'), reverse: true, fmtY: (y) => fmtPace(units.meters(), y, false) }));
  }
  if ($('#c-hr')) {
    charts.push(lineChart($('#c-hr'), sample.map((i) => ({ x: x(i), y: pts[i].hr ?? null })), { color: cssVar('--hr'), fmtY: (y) => `${Math.round(y)}` }));
  }
  if ($('#c-ele')) {
    charts.push(lineChart($('#c-ele'), sample.map((i) => ({ x: x(i), y: pts[i].ele ?? null })), { color: cssVar('--elev'), fill: true, fmtY: (y) => fmtElev(y) }));
  }
  onCleanup(() => charts.forEach((c) => c.destroy()));

  $('#a-name').onclick = async () => {
    const name = prompt('Rename run', a.name);
    if (name && name.trim()) {
      a.name = name.trim();
      await db.updateActivity(a);
      $('#a-name').textContent = a.name;
    }
  };
  $('#b-del').onclick = async () => {
    if (!confirm(`Delete "${a.name}"? This can't be undone.`)) return;
    await db.deleteActivity(a.id);
    toast('Run deleted');
    location.hash = '#/home';
  };
  $('#b-gpx').onclick = () => download(`${a.name.replace(/[^\w\- ]+/g, '').trim() || 'run'}.gpx`, toGPX(a, pts), 'application/gpx+xml');
}

function toGPX(a, pts) {
  const segs = [];
  let cur = [];
  for (const p of pts) {
    if (p.lat == null) continue;
    if (p.b && cur.length) { segs.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  const trkpt = (p) => `      <trkpt lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time>${p.hr ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : ''}</trkpt>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RUNNER" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><time>${new Date(a.startTime).toISOString()}</time></metadata>
  <trk>
    <name>${esc(a.name)}</name>
    <type>running</type>
${segs.map((s) => `    <trkseg>\n${s.map(trkpt).join('\n')}\n    </trkseg>`).join('\n')}
  </trk>
</gpx>`;
}

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const el = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(el);
  el.click();
  el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- you (profile)
async function renderYou(tab = 'progress') {
  setTopbar({ right: iconLink('#/settings', ICON.gear, 'Settings') });
  const runs = await listRuns();
  const total = (list, k) => list.reduce((s, a) => s + (a[k] || 0), 0);
  const wk0 = startOfWeek();
  const week = runs.filter((a) => a.startTime >= wk0);
  const streak = weekStreak(runs);

  view.innerHTML = `
    <section class="profile">
      <div class="prof-head">
        ${avatar('xl')}
        <div><h1>${esc(runnerName())}</h1><span>${runs.length} run${runs.length === 1 ? '' : 's'}</span>
          ${auth.signedIn ? `<a class="addr-chip" href="${explorerUrl(auth.state.address)}" target="_blank" rel="noopener">${addressAvatar(auth.state.address, 18)}${shortAddress(auth.state.address)}</a>` : ''}</div>
      </div>
      <div class="prof-actions">
        <button class="btn pill" id="b-edit">Edit profile</button>
        <a class="btn pill" href="#/devices">Heart rate</a>
      </div>
      <div class="tabs" role="tablist">
        <a role="tab" href="#/you/progress" class="${tab === 'progress' ? 'on' : ''}">Progress</a>
        <a role="tab" href="#/you/runs" class="${tab === 'runs' ? 'on' : ''}">Runs</a>
      </div>
    </section>
    <section class="page" id="you-body"></section>`;

  $('#b-edit').onclick = async () => {
    const name = prompt('Your name', runnerName());
    if (name != null) { await game.setName(name); renderYou(tab); }
  };

  const body = $('#you-body');
  if (tab === 'runs') {
    body.innerHTML = runs.length ? `<div class="card run-list">${runs.map((a) => `
      <a class="run-row" href="#/activity/${a.id}">
        <span class="run-thumb">${routeSvg(a.preview) || ICON.route}</span>
        <span class="run-info"><b>${esc(a.name)}</b><span class="muted small">${fmtDate(a.startTime)}</span>
          <span class="run-stats">${fmtDist(a.distance)} · ${fmtPace(a.distance, a.movingTime)} · ${fmtTime(a.movingTime)}</span></span>
      </a>`).join('')}</div>` : '<div class="card muted">No runs yet.</div>';
    return;
  }

  // Calendar of this month for the streak card (Mon–Sun rows).
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const ranOn = new Set(runs.filter((a) => a.startTime >= first.getTime()).map((a) => new Date(a.startTime).getDate()));
  const lead = (first.getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  body.innerHTML = `
    <div class="card">
      <h3 class="card-title">This week</h3>
      <div class="post-stats">
        <div><span>Distance</span><b>${fmtDist(total(week, 'distance'))}</b></div>
        <div><span>Elev gain</span><b>${fmtElev(total(week, 'elevGain'))}</b></div>
        <div><span>Time</span><b>${fmtTime(total(week, 'movingTime'))}</b></div>
      </div>
      <span class="muted small" style="display:block;margin:18px 0 6px">Past 12 weeks</span>
      <div class="chart-box weeks"><canvas id="c-weeks"></canvas></div>
      <a class="btn pill block" href="#/you/runs">See all runs</a>
    </div>
    <div class="card">
      <div class="row between"><h3 class="card-title" style="margin:0">Streak</h3><span class="muted small">${now.toLocaleDateString([], { month: 'long' })}</span></div>
      <div class="streak-month">
        <div class="streak-num">${flame(streak)}<span>Week${streak === 1 ? '' : 's'}</span></div>
        <div class="cal" aria-label="Days you ran this month">
          ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<i class="cal-h">${d}</i>`).join('')}
          ${cells.map((d) => (d == null ? '<i></i>' : `<i class="cal-d ${ranOn.has(d) ? 'ran' : ''} ${d === now.getDate() ? 'today' : ''}" title="${d}"></i>`)).join('')}
        </div>
      </div>
    </div>
    <div class="card">
      <h3 class="card-title">All-time</h3>
      <div class="post-stats">
        <div><span>Runs</span><b>${runs.length}</b></div>
        <div><span>Distance</span><b>${fmtDist(total(runs, 'distance'))}</b></div>
        <div><span>Longest</span><b>${fmtDist(Math.max(0, ...runs.map((a) => a.distance)))}</b></div>
      </div>
    </div>`;

  const weeks = Array.from({ length: 12 }, (_, i) => {
    const s = wk0 - (11 - i) * 7 * 864e5, e = s + 7 * 864e5;
    return { s, d: total(runs.filter((a) => a.startTime >= s && a.startTime < e), 'distance') / units.meters() };
  });
  const accent = cssVar('--route'), muted = cssVar('--muted'), grid = cssVar('--line'), surface = cssVar('--surface');
  const chart = new Chart($('#c-weeks'), {
    type: 'line',
    data: {
      labels: weeks.map((w) => w.s),
      datasets: [{
        data: weeks.map((w) => +w.d.toFixed(2)), borderColor: accent, backgroundColor: accent + '2e', fill: true, tension: 0,
        borderWidth: 3, pointRadius: weeks.map((_, i) => (i === 11 ? 7 : 5)), pointBackgroundColor: weeks.map((_, i) => (i === 11 ? accent : surface)),
        pointBorderColor: accent, pointBorderWidth: 2.5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { title: (i) => `Week of ${new Date(+i[0].label).toLocaleDateString([], { month: 'short', day: 'numeric' })}`, label: (i) => `${i.parsed.y} ${units.label()}` } },
      },
      scales: {
        x: {
          grid: { display: false }, border: { display: false },
          ticks: {
            color: muted, maxRotation: 0, autoSkip: false,
            // Label the first week of each month, like "SEP".
            callback: (_, i) => { const d = new Date(weeks[i].s); const p = i && new Date(weeks[i - 1].s); return i && d.getMonth() !== p.getMonth() ? d.toLocaleDateString([], { month: 'short' }).toUpperCase() : ''; },
          },
        },
        y: { position: 'right', beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 3, callback: (v) => `${v} ${units.label()}` } },
      },
    },
  });
  onCleanup(() => chart.destroy());
}

// ---------------------------------------------------------------- settings
function renderSettings() {
  setTopbar({ left: backLink('#/you'), title: 'Settings' });
  view.innerHTML = `
    <section class="page">
      <div class="card list-card">
        ${auth.state.configured ? `
        <div class="setting">
          <div class="row">${ICON.user}<div><b>Account</b><div class="muted small">${auth.signedIn
            ? `${esc(auth.state.user?.method || '')}${auth.state.user?.email ? ` · ${esc(auth.state.user.email)}` : ''} · wallet ${shortAddress(auth.state.address)}`
            : `Guest — sign in with ${SIGN_IN_METHODS} to get your wallet`}</div></div></div>
          <button class="btn sm ${auth.signedIn ? '' : 'primary'}" id="b-account">${auth.signedIn ? 'Sign out' : 'Sign in'}</button>
        </div>` : ''}
        <div class="setting">
          <div class="row">${ICON.ruler}<div><b>Units</b><div class="muted small">Distance and pace</div></div></div>
          <div class="seg" id="units">
            <button data-u="km" class="${units.get() === 'km' ? 'on' : ''}">km</button>
            <button data-u="mi" class="${units.get() === 'mi' ? 'on' : ''}">mi</button>
          </div>
        </div>
        <a class="setting" href="#/devices">
          <div class="row">${ICON.heart}<div><b>Heart-rate sensor</b><div class="muted small">Chest straps and watches that broadcast heart rate</div></div></div>
          ${ICON.chev}
        </a>
        ${auth.signedIn && auth.state.address.toLowerCase() === DEV_WALLET.toLowerCase() ? `<a class="setting" href="${SITE}/admin.html?c=token" target="_blank" rel="noopener">
          <div class="row">${ICON.gear}<div><b>Admin</b><div class="muted small">Dev wallet only — deploy, launch, protocol rewards, game settings</div></div></div>
          ${ICON.chev}
        </a>` : ''}
        ${isNative ? '' : `<a class="setting" href="/download" target="_blank" rel="noopener">
          <div class="row">${ICON.phone}<div><b>Android app</b><div class="muted small">Keeps recording with the screen locked — get it at runearn.fun/download</div></div></div>
          ${ICON.chev}
        </a>`}
        <a class="setting" href="${SITE}/whitepaper" target="_blank" rel="noopener">
          <div class="row">${ICON.doc}<div><b>Whitepaper</b><div class="muted small">How RUNNER, the sneakers and the token work</div></div></div>
          ${ICON.chev}
        </a>
        <a class="setting" href="${SITE}/privacy" target="_blank" rel="noopener">
          <div class="row">${ICON.doc}<div><b>Privacy policy</b><div class="muted small">What RUNNER collects and how to delete it</div></div></div>
          ${ICON.chev}
        </a>
        <a class="setting" href="${FEEDBACK_URL}" target="_blank" rel="noopener">
          <div class="row">${ICON.chat}<div><b>Send feedback</b><div class="muted small">Report a bug or share an idea</div></div></div>
          ${ICON.chev}
        </a>
        <div class="setting">
          <div class="row">${ICON.trash}<div><b>Delete all data</b><div class="muted small">Runs, coins and sneakers on this device</div></div></div>
          <button class="btn sm danger" id="b-wipe">Delete</button>
        </div>
        ${auth.signedIn ? `<div class="setting">
          <div class="row">${ICON.user}<div><b>Delete account</b><div class="muted small">Your RUNNER account and its unclaimed balance</div></div></div>
          <button class="btn sm danger" id="b-delete-account">Delete</button>
        </div>` : ''}
      </div>
      <p class="muted small" style="text-align:center">RUNNER ${VERSION} · Your runs are stored privately on this device. Earnings become real ${COIN} tokens when you claim them in Earn.</p>
    </section>`;

  $('#units').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    units.set(b.dataset.u);
    renderSettings();
  };
  const acct = $('#b-account');
  if (acct) {
    acct.onclick = async () => {
      if (!auth.signedIn) { try { await auth.login(); } catch (err) { toast(err.message, 4000); } return; }
      if (!confirm('Sign out? Your runs and sneakers stay on this phone and come back when you sign in again.')) return;
      await auth.logout();
      toast('Signed out');
    };
    const rerender = () => renderSettings();
    auth.addEventListener('change', rerender);
    onCleanup(() => auth.removeEventListener('change', rerender));
  }
  const delBtn = $('#b-delete-account');
  if (delBtn) delBtn.onclick = async () => {
    if (rec.state !== 'idle') { toast('Finish your current run first'); return; }
    if (!confirm(`Delete your RUNNER account?\n\nThis deletes your account and your unclaimed ${COIN} balance on our server, signs you out and clears this device. ${COIN} you already claimed and your sneakers stay in your wallet.`)) return;
    if (auth.state.walletKind === 'embedded' && confirm('Your wallet was created for you at sign-in. After deleting, you can only reach it with its private key.\n\nExport the private key now? (OK = export first, Cancel = continue deleting)')) {
      try { await auth.exportWallet(); } catch (err) { toast(err.message, 4000); }
      return;
    }
    if ((prompt('Type DELETE to delete your account.') || '').trim().toUpperCase() !== 'DELETE') { toast('Not deleted'); return; }
    delBtn.disabled = true;
    try {
      await deleteAccount();
      await auth.logout();
      await db.clearAll();
      await game.reset();
      toast('Your account has been deleted');
      await runOnboarding();
      location.hash = '#/home';
    } catch (err) {
      delBtn.disabled = false;
      toast(String(err.message || err).slice(0, 200), 5000);
    }
  };
  $('#b-wipe').onclick = async () => {
    if (rec.state !== 'idle') { toast('Finish your current run first'); return; }
    if (!confirm('Delete ALL runs, coins and sneakers on this device? This can\'t be undone.')) return;
    await db.clearAll();
    await game.reset();
    toast('All data deleted');
    await runOnboarding();
    location.hash = '#/home';
  };
}

// ---------------------------------------------------------------- heart-rate sensor
function renderDevices() {
  setTopbar({ left: backLink('#/you'), title: 'Heart-rate sensor' });
  view.innerHTML = `
    <section class="page">
      <div class="card">
        <h4>Heart-rate sensor</h4>
        <div class="row between">
          <div class="hr-live"><b id="hr-val">${hrm.current() ?? '–'}</b><span class="muted">bpm</span></div>
          <button class="btn pill ${hrm.connected ? '' : 'primary'}" id="b-hr">${hrm.connected ? 'Disconnect' : 'Connect'}</button>
        </div>
        <p class="muted small" id="hr-status" style="margin:10px 0 0">${hrm.connected ? `Connected to ${esc(hrm.device?.name || 'heart-rate sensor')}. You get +10% coins while recording.` : hrm.supported
          ? 'Pair a chest strap, or a watch broadcasting HR (Garmin: Heart rate settings → <b>Broadcast Heart Rate</b>). +10% coins while recording.'
          : 'Bluetooth isn\'t available in this browser. Use Chrome on Android, Windows, macOS or ChromeOS.'}</p>
      </div>

    </section>`;

  const hrVal = () => { const el = $('#hr-val'); if (el) el.textContent = hrm.current() ?? '–'; };
  const hrChange = () => renderDevices();
  hrm.addEventListener('hr', hrVal);
  hrm.addEventListener('change', hrChange);
  onCleanup(() => { hrm.removeEventListener('hr', hrVal); hrm.removeEventListener('change', hrChange); });

  $('#b-hr').onclick = async () => {
    if (hrm.connected) return hrm.disconnect();
    try {
      $('#hr-status').textContent = 'Searching for heart-rate sensors…';
      await hrm.connect();
    } catch (e) {
      $('#hr-status').textContent = e.name === 'NotFoundError' ? 'No sensor selected.' : e.message;
    }
  };
}

// ---------------------------------------------------------------- boot
async function recoverUnfinished() {
  try {
    const snap = await db.kvGet('inprogress');
    if (!snap?.points?.length) return;
    await db.kvDel('inprogress');
    if (snap.points.length < 2) return;
    if (!confirm(`Found an unfinished run from ${fmtDate(snap.startedAt)}. Save it?`)) return;
    const { act, points } = buildActivity({ startTime: snap.startedAt, points: snap.points }, 'gps');
    // The step counter doesn't survive the app closing: the server sees the steps as lost.
    if (snap.earn) act.earn = await settleRun(snap.earn, act.id, snap.points, { steps: isNative ? { lost: true } : null, mockFixes: snap.mockFixes || 0 });
    await db.saveActivity(act, points);
    toast(earnToast(act.earn, 'Recovered run'));
  } catch (e) { console.warn(e); }
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => {
  if (rec.state !== 'idle') { e.preventDefault(); e.returnValue = ''; }
});
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isNative) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// ---------------------------------------------------------------- account ↔ progress
// Progress lives on this device. When someone signs in, we tie it to their
// account's wallet; if a *different* account signs in, we don't mix the two.
let resolvingConflict = false;
async function syncWallet() {
  const s = auth.state;
  if (!game.state || resolvingConflict) return;
  // Signed out → no wallet → no sneakers to earn with (progress stays saved).
  if (s.ready && !s.authenticated) { if (game.state.sneakers.length) await game.syncOwned([]); return; }
  if (!s.authenticated || !s.address || !s.user) return;
  const w = game.state.wallet;
  const info = { address: s.address, privyId: s.user.id, method: s.user.method, email: s.user.email };
  if (!w || w.privyId === s.user.id) {
    if (!w || w.address !== s.address || w.email !== s.user.email) {
      await game.linkWallet(info);
      if (!w) {
        if (game.state.profile.name === 'Runner' && s.user.name) await game.setName(s.user.name);
        toast(`Wallet ready · ${shortAddress(s.address)}`);
      }
    }
    syncOwnedSneakers().then(() => syncRewards()).catch(() => {}); // sneakers on-chain, then verified balance
    return;
  }
  resolvingConflict = true;
  const fresh = confirm(`This phone has RUNNER progress for ${w.email || shortAddress(w.address)}.\n\nOK: start fresh for ${s.user.email || 'this account'} (removes the other account's runs and sneakers from this phone).\nCancel: sign out.`);
  if (fresh) {
    await db.clearAll();
    await game.reset();
    await game.linkWallet(info);
    if (s.user.name) await game.setName(s.user.name);
    await runOnboarding();
    location.hash = '#/home';
    route();
  } else {
    await auth.logout();
  }
  resolvingConflict = false;
}
auth.addEventListener('change', syncWallet);

await game.load();
// Restore a previous Privy session in the background (never blocks the app).
if (auth.state.configured) auth.load();
if (!game.state.onboarded) await runOnboarding();
await recoverUnfinished();
route();
