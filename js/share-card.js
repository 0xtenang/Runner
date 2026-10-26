// Share cards for a finished run: story-sized images (1080×1920) with distance, pace, time and the
// route line — transparent (to lay over a photo), dark, red, and an "earned" card when the run earned
// RUNNER. Drawn on a canvas in the app (no map tiles, nothing uploaded), then shared through the
// phone's share sheet or saved.
import { isNative } from './geo.js';

const W = 1080, H = 1920;
const RED = '#E8483B', INK = '#0b0b0c', CREAM = '#FFF8EF';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Small seeded random numbers, so a run's speed lines look the same every time. */
function seeded(seed) {
  let x = 0;
  for (const ch of String(seed)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}

function speedLines(ctx, seed, colors) {
  const rnd = seeded(seed);
  for (let i = 0; i < 26; i++) {
    const y = rnd() * H, len = 260 + rnd() * 620, x = rnd() * W - 200, tilt = -0.11;
    ctx.strokeStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.25 + rnd() * 0.5;
    ctx.lineWidth = 2 + rnd() * 7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + len * tilt); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Route segments ([[lat, lon], …] per segment) fitted into a box, aspect kept. */
function drawRoute(ctx, segs, box, color) {
  const all = segs.flat();
  if (all.length < 2) return;
  const lat0 = all.reduce((s, p) => s + p[0], 0) / all.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p[1] * k), ys = all.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(box.w / (maxX - minX || 1e-9), box.h / (maxY - minY || 1e-9));
  const ox = box.x + (box.w - (maxX - minX) * scale) / 2, oy = box.y + (box.h - (maxY - minY) * scale) / 2;
  ctx.strokeStyle = color; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const seg of segs) {
    if (seg.length < 2) continue;
    ctx.beginPath();
    seg.forEach((p, i) => { const x = ox + (p[1] * k - minX) * scale, y = oy + (-p[0] - minY) * scale; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
}

function wordmark(ctx, y, accent) {
  ctx.font = '104px Anton, Impact, sans-serif';
  ctx.textBaseline = 'alphabetic';
  const a = 'RUNN', b = 'ER';
  const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width;
  const x = (W - wa - wb) / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = CREAM; ctx.fillText(a, x, y);
  ctx.fillStyle = accent; ctx.fillText(b, x + wa, y);
}

function stat(ctx, label, value, y, color) {
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = '700 44px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(label, W / 2, y);
  ctx.font = '150px Anton, Impact, sans-serif';
  ctx.fillText(value, W / 2, y + 160, W - 120);
}

/**
 * Draws one card. `run` = { id, distance, pace, time, segs, earned, sneaker }.
 * Variants: 'transparent', 'dark', 'red', and the earnings cards 'earned-clear' (transparent),
 * 'earned' (dark) and 'earned-red'.
 */
export function drawCard(variant, run) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const earned = variant.startsWith('earned');
  const clear = variant === 'transparent' || variant === 'earned-clear';
  const red = variant === 'red' || variant === 'earned-red';
  if (variant === 'dark' || variant === 'earned') {
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    speedLines(ctx, run.id, [CREAM, RED, '#ff8a5b']);
  } else if (red) {
    ctx.fillStyle = RED; ctx.fillRect(0, 0, W, H);
    speedLines(ctx, run.id, [CREAM, '#ffd4c7']);
  }
  const text = CREAM;
  if (clear) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18; }
  const routeColor = red ? CREAM : RED;
  if (earned) {
    stat(ctx, 'Distance', run.distance, 300, text);
    stat(ctx, 'Pace', run.pace, 590, text);
    ctx.textAlign = 'center'; ctx.fillStyle = red ? INK : RED;
    ctx.font = '700 44px -apple-system, system-ui, sans-serif';
    ctx.fillText('Earned', W / 2, 880);
    ctx.font = '180px Anton, Impact, sans-serif';
    if (red) ctx.fillStyle = CREAM;
    ctx.fillText(`+${run.earned}`, W / 2, 1070, W - 120);
    ctx.fillStyle = text; ctx.font = '700 52px -apple-system, system-ui, sans-serif';
    ctx.fillText('RUNNER', W / 2, 1150);
    if (run.sneaker) { ctx.font = '500 40px -apple-system, system-ui, sans-serif'; ctx.globalAlpha = 0.8; ctx.fillText(`with ${run.sneaker}`, W / 2, 1215); ctx.globalAlpha = 1; }
    drawRoute(ctx, run.segs, { x: 330, y: 1290, w: 420, h: 320 }, routeColor);
    wordmark(ctx, 1770, red ? INK : RED);
  } else {
    stat(ctx, 'Distance', run.distance, 330, text);
    stat(ctx, 'Pace', run.pace, 640, text);
    stat(ctx, 'Time', run.time, 950, text);
    drawRoute(ctx, run.segs, { x: 270, y: 1240, w: 540, h: 400 }, routeColor);
    wordmark(ctx, 1790, variant === 'red' ? INK : RED);
  }
  return c;
}

const toBlob = (canvas) => new Promise((ok) => canvas.toBlob(ok, 'image/png'));
const blobToBase64 = (blob) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });

const Cap = globalThis.Capacitor;
const nativeShare = () => isNative && Cap?.isPluginAvailable?.('Share') && Cap?.isPluginAvailable?.('Filesystem');

/** Shares the image through the phone's share sheet (falls back to saving it). */
async function shareImage(canvas, filename) {
  const blob = await toBlob(canvas);
  if (nativeShare()) {
    const Filesystem = Cap.registerPlugin('Filesystem'), Share = Cap.registerPlugin('Share');
    const { uri } = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: 'CACHE' });
    await Share.share({ title: 'My RUNNER run', files: [uri] });
    return 'shared';
  }
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'My RUNNER run' });
    return 'shared';
  }
  return download(blob, filename);
}

/** Saves the PNG: the share sheet's "Save Image" in the phone apps, a download on the web. */
async function saveImage(canvas, filename) {
  if (nativeShare()) return shareImage(canvas, filename);
  return download(await toBlob(canvas), filename);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}

/** Opens the share sheet for a run. */
export async function openShareSheet(run, { toast = () => {} } = {}) {
  try { await document.fonts?.load?.('150px Anton'); } catch { /* falls back to Impact */ }
  const variants = [['transparent', 'Transparent'], ['dark', 'Dark'], ['red', 'Red']];
  if (run.earned) variants.splice(1, 0, ['earned-clear', 'Earned · Transparent'], ['earned', 'Earned · Dark'], ['earned-red', 'Earned · Red']);
  const cards = variants.map(([v, label]) => ({ v, label, canvas: drawCard(v, run) }));
  const filename = `runner-run-${run.id}.png`;

  const el = document.createElement('div');
  el.className = 'sheet-overlay share-sheet';
  el.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Share your run">
      <div class="sheet-grab"></div>
      <div class="row between"><h2 class="sheet-title">Share your run</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="share-cards" tabindex="0">
        ${cards.map((c, i) => `<figure class="share-card ${c.v === 'transparent' || c.v === 'earned-clear' ? 'checker' : ''}" data-i="${i}"><img alt="${esc(c.label)} share card" src="${c.canvas.toDataURL('image/png')}"><figcaption>${esc(c.label)}</figcaption></figure>`).join('')}
      </div>
      <div class="share-dots">${cards.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
      <button class="btn primary pill block" data-act="share">Share</button>
      <button class="btn pill block" data-act="save">Save image</button>
      <p class="muted small" style="margin:0;text-align:center">Transparent works as a sticker on your own photo in Instagram Stories.</p>
    </div>`;
  document.body.appendChild(el);
  const strip = el.querySelector('.share-cards');
  // The picked card is the one nearest the middle of the strip.
  const current = () => {
    const box = strip.getBoundingClientRect(), mid = box.left + box.width / 2;
    let best = 0, dist = Infinity;
    [...strip.children].forEach((fig, i) => { const r = fig.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid); if (d < dist) { dist = d; best = i; } });
    return best;
  };
  const syncDots = () => el.querySelectorAll('.share-dots i').forEach((d, i) => d.classList.toggle('on', i === current()));
  strip.addEventListener('scroll', syncDots, { passive: true });
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 180); };
  el.addEventListener('click', async (e) => {
    if (e.target === el || e.target.closest('[data-close]')) return close();
    const fig = e.target.closest('.share-card');
    if (fig) return fig.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const card = cards[current()];
    try {
      const done = act === 'share' ? await shareImage(card.canvas, filename) : await saveImage(card.canvas, filename);
      if (done === 'saved') toast('Image saved');
    } catch (err) {
      if (!/abort|cancel/i.test(String(err?.name || err?.message))) toast(String(err?.message || err).slice(0, 160), 4000);
    }
  });
}
