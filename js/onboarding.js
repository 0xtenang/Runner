// First-launch onboarding: welcome → how earning works → pick a free starter
// sneaker → name, units, location and heart-rate setup.
import { game, SNEAKER_TYPES, MINUTES_PER_ENERGY, COIN } from './game.js';
import { sneakerSvg, showReveal, paceRange } from './earn-view.js';
import { units } from './stats.js';

const STARTERS = [
  { type: 'walker', hue: 200, best: 'Run-walk and recovery runs' },
  { type: 'jogger', hue: 95, best: 'Easy runs — the most popular pick' },
  { type: 'runner', hue: 15, best: 'Tempo runs and faster training' },
  { type: 'trainer', hue: 280, best: 'Any pace — earns 15% less' },
];

export function runOnboarding() {
  return new Promise((resolve) => {
    let step = 0;
    let choice = 'jogger';
    let locStatus = '';
    let name = game.state.profile?.name && game.state.profile.name !== 'Runner' ? game.state.profile.name : '';
    const el = document.createElement('div');
    el.className = 'onboard';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Welcome to RUNNER');
    document.body.appendChild(el);
    document.body.classList.add('no-scroll');

    const screens = [
      () => `
        <div class="ob-hero">
          <img src="icon.svg" alt="" width="88" height="88">
          <h1>RUNN<em>ER</em></h1>
          <p class="ob-tag">Run in the real world. Earn with every kilometre.</p>
        </div>
        <ul class="ob-list">
          <li><b>Track every run</b><span>Live GPS map, pace, splits and heart rate.</span></li>
          <li><b>Earn ${COIN} coins</b><span>Equip a sneaker and earn while you run.</span></li>
          <li><b>Bring your watch</b><span>Import runs from Garmin, COROS, Polar, Suunto, Apple Watch and more.</span></li>
        </ul>`,
      () => `
        <h2 class="ob-title">How earning works</h2>
        <ol class="ob-steps">
          <li><i>1</i><div><b>Equip a sneaker</b><span>Each type has a pace zone. Stay inside it to earn — a Daily Runner earns between 6:00 and 15:00 /km.</span></div></li>
          <li><i>2</i><div><b>Spend energy</b><span>Every ${MINUTES_PER_ENERGY} minutes of earning uses 1 energy. Energy refills over 24 hours, and more sneakers means more energy.</span></div></li>
          <li><i>3</i><div><b>Earn and upgrade</b><span>Collect coins and mystery boxes, level up, assign attribute points and mint new sneakers.</span></div></li>
          <li><i>4</i><div><b>Keep it real</b><span>Only runs recorded live with GPS earn. Vehicle speeds don't count, and a heart-rate sensor adds a +10% bonus.</span></div></li>
        </ol>`,
      () => `
        <h2 class="ob-title">Pick your free sneaker</h2>
        <p class="muted ob-sub">Pick the one that matches how you usually run. You can collect more later.</p>
        <div class="ob-starters" role="radiogroup" aria-label="Starter sneaker">
          ${STARTERS.map((s) => {
            const t = SNEAKER_TYPES[s.type];
            return `<button class="ob-starter ${choice === s.type ? 'on' : ''}" role="radio" aria-checked="${choice === s.type}" data-type="${s.type}">
              ${sneakerSvg({ type: s.type, rarity: 'common', hue: s.hue }, 'sneaker-art sm')}
              <b>${t.label}</b>
              <span class="ob-zone">${paceRange(t)}</span>
              <span class="muted small">${s.best}</span>
            </button>`;
          }).join('')}
        </div>`,
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

    const draw = () => {
      const last = step === screens.length - 1;
      el.innerHTML = `
        <div class="ob-card">
          <div class="ob-top">
            ${step ? '<button class="btn ghost sm" data-ob="back">← Back</button>' : '<span></span>'}
            <div class="ob-dots" aria-label="Step ${step + 1} of ${screens.length}">${screens.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
          </div>
          <div class="ob-body">${screens[step]()}</div>
          <button class="btn primary ob-next" data-ob="next">${last ? 'Start moving' : step === 2 ? `Choose ${SNEAKER_TYPES[choice].label}` : step === 0 ? 'Get started' : 'Next'}</button>
        </div>`;
      el.querySelector('.ob-next').focus({ preventScroll: true });
    };

    el.addEventListener('input', (e) => { if (e.target.id === 'ob-name') name = e.target.value; });

    el.addEventListener('click', async (e) => {
      const starter = e.target.closest('.ob-starter');
      if (starter) { choice = starter.dataset.type; draw(); return; }
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
      if (step < screens.length - 1) { step++; draw(); return; }
      // Finish
      nav.disabled = true;
      await game.setName(name);
      const s = await game.claimStarter(choice, STARTERS.find((x) => x.type === choice).hue);
      el.classList.add('out');
      document.body.classList.remove('no-scroll');
      setTimeout(() => el.remove(), 200);
      await showReveal({
        kicker: 'Your first sneaker',
        title: `${SNEAKER_TYPES[s.type].label} <span class="muted">#${s.serial}</span>`,
        sneaker: s,
        note: `Every sneaker rolls its own stats. Run at ${paceRange(SNEAKER_TYPES[s.type])} to earn.`,
        buttons: [{ id: 'ok', label: "Let's go", primary: true }],
      });
      resolve(s);
    });

    draw();
  });
}
