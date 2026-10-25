// Email sign-in drawn by the app itself, for the website added to an iPhone home screen. Privy's own
// window draws blank there, so this sheet asks for the email and the 6-digit code and passes them to
// Privy's headless email login (auth.sendEmailCode / auth.loginWithEmailCode). The wallet is created
// as usual once signed in.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = 'https://www.runearn.fun/';

let open = null; // the sheet currently shown (only one at a time)

/** Shows the sheet. Resolves when it closes; sign-in itself shows up as an auth 'change'. */
export function openEmailSignIn(auth) {
  if (open) return open.done;
  const el = document.createElement('div');
  el.className = 'sheet-overlay email-signin';
  document.body.appendChild(el);
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  let email = '';
  let step = 'email'; // 'email' → 'code'
  let busy = false;

  const close = () => {
    el.classList.add('out');
    auth.removeEventListener('change', onAuth);
    setTimeout(() => el.remove(), 180);
    open = null;
    resolve();
  };
  const onAuth = () => { if (auth.signedIn) close(); };
  auth.addEventListener('change', onAuth);

  function draw(status = '', bad = false) {
    el.innerHTML = `<form class="sheet-panel" role="dialog" aria-modal="true" aria-label="Sign in" novalidate>
      <div class="sheet-grab"></div>
      <h2 class="sheet-title">Sign in to RUNNER</h2>
      ${step === 'email' ? `
        <p class="muted">Enter your email. We'll send a 6-digit code; your Robinhood Chain wallet is created automatically — no seed phrase.</p>
        <input class="es-input" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(email)}" required>
        <button class="btn primary pill block" ${busy ? 'disabled' : ''}>${busy ? 'Sending…' : 'Send code'}</button>`
      : `
        <p class="muted">Enter the 6-digit code sent to <b>${esc(email)}</b>.</p>
        <input class="es-input es-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required>
        <button class="btn primary pill block" ${busy ? 'disabled' : ''}>${busy ? 'Signing in…' : 'Sign in'}</button>
        <button class="btn pill block" type="button" data-act="back" ${busy ? 'disabled' : ''}>Use another email</button>`}
      <div class="small ${bad ? 'bad' : 'muted'}" role="status">${status}</div>
      <p class="muted small" style="margin:0">Google, Apple and wallet sign-in work in your browser: <a href="${SITE}" target="_blank" rel="noopener">open runearn.fun</a>. If you signed up there with email, use the same email here to reach the same wallet.</p>
      <button class="btn pill block" type="button" data-act="close">Cancel</button>
    </form>`;
    el.querySelector('.es-input')?.focus();
  }

  el.addEventListener('click', (e) => {
    if (e.target === el) return close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    if (act === 'back' && !busy) { step = 'email'; draw(); }
  });

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const form = e.target;
    try {
      if (step === 'email') {
        const v = form.email.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return draw('Enter a valid email address.', true);
        email = v;
        busy = true; draw();
        await auth.sendEmailCode(email);
        busy = false; step = 'code'; draw('Code sent — check your inbox (and spam).');
      } else {
        const code = form.code.value.replace(/\D/g, '');
        if (code.length !== 6) return draw('The code has 6 digits.', true);
        busy = true; draw();
        await auth.loginWithEmailCode(code);
        busy = false;
        if (!auth.signedIn) draw('Signed in — setting up your wallet…');
      }
    } catch (err) {
      busy = false;
      draw(`${esc(String(err?.message || err).slice(0, 200))}`, true);
    }
  });

  draw();
  open = { done };
  return done;
}
