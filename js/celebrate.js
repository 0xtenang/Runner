// "Nice work!" after a run is saved: a full-screen moment with an orange swoosh drawing itself,
// sneakers and coins floating up, and what the run earned. Tap to skip; closes by itself.
const SHOE = '<svg viewBox="0 0 48 48"><path d="M5 31c0-3 2-5 4-6l6-3 4-8c1-2 3-2 4-1l3 3 2-2c1-1 3-1 4 0 4 5 8 9 11 12 1 1 1 3 0 4l-2 2H9c-2 0-4-1-4-3z"/><path d="M5 33h38M19 22l3 3M23 19l3 3"/></svg>';
const COIN = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17"/><path d="M24 14v20M19 18h7.5a4 4 0 0 1 0 8H20"/></svg>';

/** Shows the celebration; resolves when it closes. `coins` > 0 adds "+N RUNNER". */
export function celebrate({ coins = 0 } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'celebrate';
    el.setAttribute('role', 'status');
    const floaters = [
      [SHOE, 18, 70, 0], [COIN, 72, 82, 0.15], [SHOE, 64, 22, 0.3], [COIN, 12, 30, 0.45], [SHOE, 42, 88, 0.6], [COIN, 84, 48, 0.75],
    ].map(([svg, x, y, d]) => `<span class="cb-float" style="left:${x}%;top:${y}%;animation-delay:${d}s">${svg}</span>`).join('');
    el.innerHTML = `
      <svg class="cb-swoosh" viewBox="0 0 400 800" preserveAspectRatio="none" aria-hidden="true">
        <path d="M420 -20 C 380 220, 260 330, 120 380 S -40 470, -40 470" />
      </svg>
      ${floaters}
      <div class="cb-text">
        <b>Nice work!</b>
        ${coins > 0 ? `<span>+${(Math.round(coins * 100) / 100).toLocaleString()} RUNNER</span>` : ''}
      </div>`;
    document.body.appendChild(el);
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      el.classList.add('out');
      setTimeout(() => { el.remove(); resolve(); }, 250);
    };
    el.addEventListener('click', close);
    setTimeout(close, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1200 : 2400);
  });
}
