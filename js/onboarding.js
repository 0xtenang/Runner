// First-launch onboarding: welcome (sign in or guest) → how earning works →
// name, units, location and heart-rate setup. Sneakers are NFTs bought in the
// Earn tab — there is no free starter.
import { game, MINUTES_PER_ENERGY, COIN } from './game.js';
import { auth, shortAddress } from './auth.js';
import { sneakerSvg } from './earn-view.js';
import { traitsFor, PRICE_ETH } from './collection.js';
import { units } from './stats.js';

export function runOnboarding() {
  return new Promise((resolve) => {
    let step = 0;
    let locStatus = '';
    let signStatus = '';
    let name = game.state.profile?.name && game.state.profile.name !== 'Runner' ? game.state.profile.name : '';
    const el = document.createElement('div');
    el.className = 'onboard';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Welcome to RUNNER');
    document.body.appendChild(el);
    document.body.classList.add('no-scroll');

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const screens = [
      () => `
        <div class="ob-hero">
          <img src="icon.svg" alt="" width="88" height="88">
          <h1>RUNN<em>ER</em></h1>
          <p class="ob-tag">Run in the real world. Earn with every kilometre.</p>
        </div>
        <ul class="ob-list">
          <li><b>Track every run</b><span>Live GPS map, pace, splits and heart rate.</span></li>
          <li><b>Earn ${COIN} tokens</b><span>Own a sneaker NFT and earn ${COIN} while you run.</span></li>
          <li><b>Bring your watch</b><span>Import runs from Garmin, COROS, Polar, Suunto, Apple Watch and more.</span></li>
        </ul>
        ${auth.signedIn ? `<div class="ob-signed">✓ Signed in${auth.state.user?.email ? ` as ${esc(auth.state.user.email)}` : ''} · wallet ${shortAddress(auth.state.address)}</div>` : ''}
        ${signStatus ? `<p class="ob-sign-status" role="status">${esc(signStatus)}</p>` : ''}`,
      () => `
        <h2 class="ob-title">How earning works</h2>
        <div class="ob-shoes">${[3, 146, 42].map((id) => sneakerSvg(traitsFor(id), 'sneaker-art xs')).join('')}</div>
        <ol class="ob-steps">
          <li><i>1</i><div><b>Get a sneaker NFT</b><span>Pick one from the RUNNER Genesis collection of 9,999 — from ${PRICE_ETH.common} ETH. It lives in your own wallet.</span></div></li>
          <li><i>2</i><div><b>Run in its pace zone</b><span>Each sneaker class has a pace zone. Stay inside it to earn — a Daily Runner earns between 6:00 and 15:00 /km.</span></div></li>
          <li><i>3</i><div><b>Spend energy, earn ${COIN}</b><span>Every ${MINUTES_PER_ENERGY} minutes of earning uses 1 energy. Energy refills over 24 hours — more sneakers, more energy.</span></div></li>
          <li><i>4</i><div><b>Level up</b><span>Spend ${COIN} on level-ups, attribute points and repairs. Only live GPS runs earn — vehicle speeds don't count.</span></div></li>
        </ol>`,
      () => `
        <h2 class="ob-title">Quick setup</h2>
        <label class="ob-name">
          <span class="lbl">Your name</span>
          <input id="ob-name" type="text" maxlength="40" autocomplete="given-name" placeholder="Runner" value="${name.replace(/"/g, '&quot;')}">
        </label>
        <div class="ob-setup">
          <div class="setting">
            <div><b>Units</b><div class="muted small">Distance and pace</div></div>
            <div class="seg" id="ob-units">
              <button data-u="km" class="${units.get() === 'km' ? 'on' : ''}">km</button>
              <button data-u="mi" class="${units.get() === 'mi' ? 'on' : ''}">mi</button>
            </div>
          </div>
          <div class="setting">
            <div><b>Location</b><div class="muted small">${locStatus || 'Needed to track your route and earn. Only used while you record.'}</div></div>
            <button class="btn sm" id="ob-loc">Allow</button>
          </div>
          <div class="setting">
            <div><b>Heart rate (optional)</b><div class="muted small">Connect a chest strap or watch later under <b>Devices</b> for a +10% earning bonus.</div></div>
          </div>
        </div>`,
    ];

    const offerSignIn = () => step === 0 && auth.state.configured && !auth.signedIn;

    const draw = () => {
      const last = step === screens.length - 1;
      el.innerHTML = `
        <div class="ob-card">
          <div class="ob-top">
            ${step ? '<button class="btn ghost sm" data-ob="back">← Back</button>' : '<span></span>'}
            <div class="ob-dots" aria-label="Step ${step + 1} of ${screens.length}">${screens.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
          </div>
          <div class="ob-body">${screens[step]()}</div>
          ${offerSignIn() ? `
            <div class="ob-auth">
              <button class="btn primary ob-signin" data-ob="signin">Continue with Google, Apple or email</button>
              <button class="btn ob-guest" data-ob="next">Continue as guest</button>
              <span class="muted small">Signing in creates your own Robinhood Chain wallet — no seed phrase or private key to import. You need it to own sneakers and earn.</span>
            </div>` : `
            <button class="btn primary ob-next" data-ob="next">${last ? 'Start running' : step === 0 ? 'Get started' : 'Next'}</button>`}
        </div>`;
      el.querySelector('.ob-next, .ob-signin')?.focus({ preventScroll: true });
    };

    // Advance automatically once sign-in completes (Privy finishes asynchronously).
    const onAuth = () => {
      if (step === 0 && auth.signedIn) {
        const u = auth.state.user;
        if (!name) name = u?.name || (u?.email ? u.email.split('@')[0] : '');
        signStatus = '';
        step = 1;
        draw();
      } else if (step === 0 && auth.state.error && signStatus) {
        signStatus = auth.state.error;
        draw();
      }
    };
    auth.addEventListener('change', onAuth);
    // Warm up Privy in the background so the sign-in sheet opens quickly.
    if (auth.state.configured) auth.load();

    el.addEventListener('input', (e) => { if (e.target.id === 'ob-name') name = e.target.value; });

    el.addEventListener('click', async (e) => {
      const u = e.target.closest('#ob-units button');
      if (u) { units.set(u.dataset.u); draw(); return; }
      if (e.target.closest('#ob-loc')) {
        if (!navigator.geolocation) { locStatus = 'Location isn\'t available in this browser.'; draw(); return; }
        locStatus = 'Waiting for permission…'; draw();
        navigator.geolocation.getCurrentPosition(
          () => { locStatus = '✓ Location allowed'; draw(); },
          (err) => { locStatus = err.code === 1 ? 'Permission denied — you can allow it later in your browser settings.' : 'Couldn\'t get a fix yet — that\'s OK indoors.'; draw(); },
          { enableHighAccuracy: true, timeout: 15000 }
        );
        return;
      }
      const nav = e.target.closest('[data-ob]');
      if (!nav) return;
      if (nav.dataset.ob === 'back') { step--; draw(); return; }
      if (nav.dataset.ob === 'signin') {
        signStatus = 'Opening sign-in…';
        draw();
        try {
          await auth.login();
          signStatus = 'Finish signing in in the window that opened.';
        } catch (err) {
          signStatus = err.message;
        }
        draw();
        return;
      }
      if (step < screens.length - 1) { step++; draw(); return; }
      // Finish
      nav.disabled = true;
      await game.setName(name);
      await game.finishOnboarding();
      auth.removeEventListener('change', onAuth);
      el.classList.add('out');
      document.body.classList.remove('no-scroll');
      setTimeout(() => el.remove(), 200);
      resolve();
    });

    draw();
  });
}
