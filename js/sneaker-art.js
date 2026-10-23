// Original RUNNER sneaker illustrations — four lines (Stride, Pod, Knit, Court)
// inspired by popular shoe *styles* but drawn from scratch with our own
// details and the RUNNER bolt mark. No real brand's logos, stripes, text or
// signature parts are used (e.g. no hollow tube soles, no side stripe text,
// no swoosh or wings).
//
// A sneaker's look comes from its fields: model, hue, accent, midTone,
// pattern, laces, edition (set from its token in collection.js). Class
// (type) shapes the sole on running lines; rarity adds finish effects.

const STACK = { walker: 10, jogger: 4, runner: 12, trainer: 5 }; // heel stack by class
let seq = 0; // unique gradient ids when many sneakers share a page

const BOLT_SHAPE = [[60, 50], [98, 38], [94, 46], [132, 34], [92, 58], [97, 49]];
const SPARKLE = 'M0-7L1.8-1.8L7 0L1.8 1.8L0 7L-1.8 1.8L-7 0L-1.8-1.8Z';

function palette(s) {
  const seed = Number(s.serial) || Math.round((s.hue ?? 120) * 7.3) || 1;
  const rar = s.rarity || 'common';
  const h = s.hue ?? 120;
  const h2 = s.accent ?? (h + 140 + (seed % 80)) % 360;
  const midTone = s.midTone ?? seed % 3;
  const lightLaces = s.laces ? s.laces === 'light' : seed % 2 === 1;
  const shiny = rar === 'rare' || rar === 'epic';
  const dark = `hsl(${h} 55% 22%)`;
  let P = {
    h, h2, midTone,
    upper: `hsl(${h} 72% 52%)`, upper2: `hsl(${(h + 32) % 360} 82% 60%)`,
    dark, light: `hsl(${h} 85% 84%)`,
    mid: midTone === 0 ? '#f7f7f3' : midTone === 1 ? `hsl(${h2} 88% 62%)` : `hsl(${h} 75% 88%)`,
    mid2: shiny ? `hsl(${h2} 92% 55%)` : midTone === 0 ? '#deded7' : midTone === 1 ? `hsl(${h2} 80% 50%)` : `hsl(${h} 60% 74%)`,
    mark: midTone === 1 ? '#ffffff' : `hsl(${h2} 92% 58%)`,
    lace: lightLaces ? '#ffffff' : dark,
    plate: rar === 'epic' ? '#f5c518' : '#1a1a1a',
    outsole: '#1d1d1f',
    grad: rar !== 'common', sheen: shiny, glow: rar === 'epic', sparkle: rar === 'epic',
  };
  const ed = s.edition || 'standard';
  if (ed === 'gold') {
    P = { ...P, upper: '#c8961e', upper2: '#f6dc7a', dark: '#6b4a0c', light: '#fff1c2', mid: '#fff8e1', mid2: '#e9c662',
      mark: '#fffbe8', lace: '#6b4a0c', plate: '#f5c518', outsole: '#3b2a08', grad: true, sheen: true, glow: true, sparkle: true };
  } else if (ed === 'ghost') {
    P = { ...P, upper: `hsl(${h} 30% 94%)`, upper2: `hsl(${h2} 45% 88%)`, dark: `hsl(${h} 18% 64%)`, light: '#ffffff',
      mid: '#ffffff', mid2: `hsl(${h2} 55% 86%)`, mark: `hsl(${h2} 85% 58%)`, lace: '#ffffff', outsole: `hsl(${h} 12% 55%)`, grad: true, sheen: true };
  } else if (ed === 'neon') {
    P = { ...P, upper: `hsl(${h} 100% 55%)`, upper2: `hsl(${h2} 100% 60%)`, dark: `hsl(${h} 90% 22%)`, light: `hsl(${h2} 100% 82%)`,
      mid: '#18181b', mid2: `hsl(${h2} 100% 50%)`, mark: '#ffffff', lace: '#ffffff', outsole: '#0b0b0c', grad: true, glow: true };
  }
  return P;
}

function patternDef(id, kind) {
  switch (kind) {
    case 'knit':
      return `<pattern id="${id}k" width="6" height="5" patternUnits="userSpaceOnUse"><path d="M0 2.5Q1.5.5 3 2.5T6 2.5" fill="none" stroke="#fff" stroke-opacity=".24" stroke-width="1"/></pattern>`;
    case 'speckle':
      return `<pattern id="${id}k" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".9" fill="#000" opacity=".22"/><circle cx="6.5" cy="1.5" r=".7" fill="#fff" opacity=".4"/><circle cx="5" cy="7" r="1" fill="#000" opacity=".18"/><circle cx="8" cy="5.5" r=".6" fill="#fff" opacity=".32"/></pattern>`;
    case 'plain':
      return `<pattern id="${id}k" width="4" height="4" patternUnits="userSpaceOnUse"/>`;
    default: // mesh
      return `<pattern id="${id}k" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r=".9" fill="#fff" opacity=".22"/></pattern>`;
  }
}

function defs(id, P, pattern) {
  return `<defs>
    <linearGradient id="${id}u" x1="0" x2="1" y1="0" y2="0.4"><stop offset="0" stop-color="${P.upper}"/><stop offset="1" stop-color="${P.grad ? P.upper2 : P.upper}"/></linearGradient>
    <linearGradient id="${id}d" x1="0" x2="0" y1="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
    <linearGradient id="${id}m" x1="0" x2="0" y1="0" y2="1"><stop offset=".1" stop-color="${P.mid}"/><stop offset="1" stop-color="${P.mid2}"/></linearGradient>
    <linearGradient id="${id}s" x1="0" x2="1" y1="0" y2="0" gradientTransform="rotate(28)">
      <stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity=".55"/>
      <stop offset=".5" stop-color="#b9f6ff" stop-opacity=".25"/><stop offset=".62" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    ${patternDef(id, pattern)}
    <filter id="${id}g" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>`;
}

const sparkles = (P) => (P.sparkle ? [[26, 10, 1], [216, 28, 0.8], [196, 8, 0.6]].map(([x, y, k]) =>
  `<path class="sparkle" transform="translate(${x} ${y}) scale(${k})" d="${SPARKLE}"/>`).join('') : '');

/** Helpers for running lines: stack height tapers from heel to toe. */
function stackHelpers(S) {
  const off = (x) => S * (1 - 0.6 * x / 240);
  const o = (x, y) => `${x} ${(y - off(x)).toFixed(1)}`;
  const pts = (list) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${o(x, y)}`).join('') + 'Z';
  const line = (pairs) => pairs.map(([x, y], i) => `${i === 0 ? 'M' : i % 3 === 1 ? 'C' : ''}${x} ${(y - off(x) * 0.5).toFixed(1)}`).join(' ');
  const topEdge = `C${o(200, 76)} ${o(120, 68)} ${o(50, 61)}C${o(30, 59)} ${o(18, 58)} ${o(10, 58)}`;
  const midPath = `M${o(10, 58)}C${o(4, 70)} 4 92 16 100C50 106 140 107 190 102C212 99 228 90 238 78C240 74 236 72 ${o(230, 73)}${topEdge}Z`;
  return { off, o, pts, line, topEdge, midPath };
}
const OUTSOLE = 'M16 100C50 106 140 107 190 102C212 99 228 90 238 78L240 82C232 95 214 104 190 106.5C140 112 50 111 14 104Z';

function lugsFor(type) {
  if (type !== 'trainer') return '';
  return Array.from({ length: 11 }, (_, i) => {
    const x = 26 + i * 17, y = 103 + 6 * (1 - ((x - 110) / 100) ** 2);
    return `<rect x="${x}" y="${y.toFixed(1)}" width="9" height="4.5" rx="1.5"/>`;
  }).join('');
}

// ---------------------------------------------------------------- Stride
function drawStride(id, s, P) {
  const S = STACK[s.type] ?? 4;
  const { off, o, pts, line, topEdge, midPath } = stackHelpers(S);
  const upperPath = `M${o(12, 60)}C${o(8, 44)} ${o(10, 30)} ${o(18, 22)}C${o(22, 16)} ${o(32, 14)} ${o(38, 18)}C${o(48, 26)} ${o(60, 30)} ${o(74, 28)}C${o(84, 26)} ${o(90, 18)} ${o(96, 12)}C${o(100, 7)} ${o(110, 8)} ${o(112, 14)}C${o(120, 30)} ${o(150, 44)} ${o(186, 54)}C${o(212, 60)} ${o(232, 66)} ${o(230, 73)}${topEdge}Z`;
  const laces = Array.from({ length: 5 }, (_, i) => { const x = 116 + i * 13.5, y = 24 + i * 6.4; return `M${o(x, y)}L${o(x - 12, y + 8)}`; }).join('');
  const lugs = lugsFor(s.type);
  return `
    ${P.glow ? `<path d="${midPath}" fill="${P.mid2}" filter="url(#${id}g)" opacity=".9"/>` : ''}
    <path d="${upperPath}" fill="url(#${id}u)"/><path d="${upperPath}" fill="url(#${id}k)"/><path d="${upperPath}" fill="url(#${id}d)"/>
    <path d="M${o(12, 60)}C${o(8, 44)} ${o(10, 30)} ${o(18, 22)}C${o(22, 16)} ${o(32, 14)} ${o(38, 18)}L${o(42, 22)}C${o(36, 36)} ${o(36, 50)} ${o(42, 62)}C${o(28, 61)} ${o(18, 60)} ${o(12, 60)}Z" fill="${P.dark}" opacity=".55"/>
    <path d="M${o(180, 53)}C${o(210, 59)} ${o(232, 66)} ${o(230, 73)}C${o(214, 75)} ${o(196, 74)} ${o(176, 71)}C${o(180, 66)} ${o(181, 60)} ${o(180, 53)}Z" fill="${P.dark}" opacity=".35"/>
    <path d="M${o(90, 18)}C${o(95, 8)} ${o(104, 4)} ${o(112, 9)}L${o(114, 18)}Z" fill="${P.light}"/>
    <path d="M${o(20, 24)}C${o(28, 20)} ${o(34, 20)} ${o(40, 24)}C${o(50, 31)} ${o(62, 34)} ${o(76, 32)}C${o(86, 30)} ${o(92, 22)} ${o(96, 16)}" fill="none" stroke="${P.dark}" stroke-width="5" stroke-linecap="round"/>
    <path d="M${o(104, 24)}C${o(122, 38)} ${o(150, 50)} ${o(182, 58)}" fill="none" stroke="${P.dark}" stroke-width="9" stroke-linecap="round" opacity=".28"/>
    <path d="${pts(BOLT_SHAPE)}" fill="${P.mark}"/>
    <path d="${laces}" stroke="${P.lace}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M${o(20, 22)}C${o(15, 12)} ${o(20, 4)} ${o(28, 8)}" fill="none" stroke="${P.light}" stroke-width="4" stroke-linecap="round"/>
    <path d="M${o(15, 34)}L${o(14, 48)}" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".75"/>
    ${P.sheen ? `<path d="${upperPath}" fill="url(#${id}s)"/>` : ''}
    <path d="${midPath}" fill="url(#${id}m)"/>
    <path d="M18 ${(82 - off(18) * 0.5).toFixed(1)}C26 ${(74 - off(26) * 0.5).toFixed(1)} 66 ${(76 - off(66) * 0.5).toFixed(1)} 98 ${(84 - off(98) * 0.5).toFixed(1)}C68 ${(90 - off(68) * 0.5).toFixed(1)} 30 ${(90 - off(30) * 0.5).toFixed(1)} 18 ${(82 - off(18) * 0.5).toFixed(1)}Z" fill="${P.sheen ? P.mark : '#000'}" opacity="${P.sheen ? 0.85 : 0.09}"/>
    <path d="${line([[22, 84], [70, 92], [160, 93], [222, 82]])}" fill="none" stroke="#000" stroke-opacity=".1" stroke-width="3" stroke-linecap="round"/>
    <path d="${line([[20, 92], [70, 99], [160, 99], [226, 86]])}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
    ${s.type === 'runner' ? `<path d="${line([[26, 78], [90, 86], [170, 86], [234, 76]])}" fill="none" stroke="${P.plate}" stroke-width="3.2" stroke-linecap="round"/>` : ''}
    <path d="${OUTSOLE}" fill="${P.outsole}"/>
    ${lugs ? `<g fill="${P.outsole}">${lugs}</g>` : ''}`;
}

// ---------------------------------------------------------------- Pod
// Cloud-cushion runner: a row of soft raised cushion pillows on the midsole
// and a sweeping wave panel on the upper. (Closed pillows, not hollow tubes.)
function drawPod(id, s, P) {
  const S = Math.max(6, STACK[s.type] ?? 6);
  const { off, o, pts, topEdge, midPath } = stackHelpers(S);
  const upperPath = `M${o(12, 60)}C${o(9, 46)} ${o(11, 33)} ${o(18, 25)}C${o(23, 19)} ${o(32, 17)} ${o(39, 21)}C${o(50, 29)} ${o(62, 32)} ${o(76, 30)}C${o(86, 28)} ${o(92, 20)} ${o(98, 14)}C${o(102, 9)} ${o(110, 10)} ${o(113, 16)}C${o(122, 32)} ${o(152, 45)} ${o(188, 55)}C${o(213, 61)} ${o(232, 67)} ${o(230, 73)}${topEdge}Z`;
  const laces = Array.from({ length: 5 }, (_, i) => { const x = 118 + i * 13.5, y = 26 + i * 6.4; return `M${o(x, y)}L${o(x - 12, y + 8)}`; }).join('');
  const pillows = Array.from({ length: 7 }, (_, i) => {
    const x = 20 + i * 29, cx = x + 12, y = 79 - off(cx) * 0.5 + (i > 4 ? (i - 4) * 2.5 : 0);
    return `<rect x="${x}" y="${(y + 2.2).toFixed(1)}" width="24" height="13" rx="6.5" fill="#000" opacity=".1"/>
      <rect x="${x}" y="${y.toFixed(1)}" width="24" height="13" rx="6.5" fill="${P.mid}"/>
      <rect x="${x + 3}" y="${(y + 2).toFixed(1)}" width="12" height="3.4" rx="1.7" fill="#fff" opacity=".7"/>`;
  }).join('');
  return `
    ${P.glow ? `<path d="${midPath}" fill="${P.mid2}" filter="url(#${id}g)" opacity=".9"/>` : ''}
    <path d="${upperPath}" fill="url(#${id}u)"/><path d="${upperPath}" fill="url(#${id}k)"/><path d="${upperPath}" fill="url(#${id}d)"/>
    <path d="M${o(16, 61)}C${o(46, 44)} ${o(86, 47)} ${o(124, 41)}C${o(150, 37)} ${o(172, 42)} ${o(196, 52)}L${o(194, 60)}C${o(166, 53)} ${o(142, 52)} ${o(118, 54)}C${o(82, 58)} ${o(48, 61)} ${o(22, 63)}Z" fill="${P.dark}" opacity=".42"/>
    <path d="M${o(180, 53)}C${o(210, 59)} ${o(232, 66)} ${o(230, 73)}C${o(214, 75)} ${o(196, 74)} ${o(176, 71)}Z" fill="${P.dark}" opacity=".3"/>
    <path d="M${o(92, 20)}C${o(97, 9)} ${o(105, 5)} ${o(113, 10)}L${o(115, 20)}Z" fill="${P.light}"/>
    <path d="M${o(20, 27)}C${o(28, 22)} ${o(35, 22)} ${o(41, 26)}C${o(51, 33)} ${o(63, 36)} ${o(77, 34)}C${o(87, 32)} ${o(93, 24)} ${o(98, 18)}" fill="none" stroke="${P.dark}" stroke-width="5" stroke-linecap="round"/>
    <path d="${pts([[26, 46], [42, 40], [40, 44], [56, 38], [40, 50], [43, 45]])}" fill="${P.mark}"/>
    <path d="${laces}" stroke="${P.lace}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M${o(20, 24)}C${o(15, 14)} ${o(21, 6)} ${o(29, 10)}" fill="none" stroke="${P.light}" stroke-width="4" stroke-linecap="round"/>
    ${P.sheen ? `<path d="${upperPath}" fill="url(#${id}s)"/>` : ''}
    <path d="${midPath}" fill="url(#${id}m)"/>
    ${pillows}
    ${s.type === 'runner' ? `<path d="M26 ${(76 - off(26) * 0.5).toFixed(1)}C90 ${(80 - off(90) * 0.5).toFixed(1)} 170 ${(80 - off(170) * 0.5).toFixed(1)} 232 ${(74 - off(232) * 0.5).toFixed(1)}" fill="none" stroke="${P.plate}" stroke-width="3" stroke-linecap="round"/>` : ''}
    <path d="${OUTSOLE}" fill="${P.outsole}"/>
    ${s.type === 'trainer' ? `<g fill="${P.outsole}">${lugsFor('trainer')}</g>` : ''}`;
}

// ---------------------------------------------------------------- Knit
// Sock-knit lifestyle runner: one-piece knitted upper, heel loop, rope laces
// and a soft wave-textured sole.
function drawKnit(id, s, P) {
  const { o, pts } = stackHelpers(3);
  // Lower, slimmer sole than the running lines; the knit upper wraps down to meet it.
  const bottom = 'C180 78 120 80 60 79C40 79 24 78 14 78';
  const sole = 'M10 77C6 84 8 96 18 100C50 106 140 107 190 102C212 99 228 90 238 80C240 77 236 75 230 75C180 78 120 80 60 79C40 79 24 78 10 77Z';
  const upperPath = `M14 78C${o(9, 52)} ${o(11, 32)} ${o(20, 22)}C${o(26, 15)} ${o(36, 14)} ${o(44, 20)}C${o(54, 27)} ${o(64, 28)} ${o(76, 25)}C${o(86, 22)} ${o(92, 15)} ${o(100, 12)}C${o(106, 10)} ${o(112, 12)} ${o(116, 18)}C${o(126, 32)} ${o(158, 44)} ${o(194, 53)}C220 60 236 67 232 75${bottom}Z`;
  const laces = Array.from({ length: 6 }, (_, i) => { const x = 118 + i * 12.5, y = 26 + i * 5.8; return `M${o(x, y)}L${o(x - 12, y + 9)}`; }).join('');
  const waves = [88, 95].map((y) => `M16 ${y}${Array.from({ length: 11 }, (_, i) => `Q${21 + i * 20} ${y - 3.5} ${26 + i * 20} ${y}T${36 + i * 20} ${y}`).join('')}`).join('');
  return `
    ${P.glow ? `<path d="${sole}" fill="${P.mid2}" filter="url(#${id}g)" opacity=".9"/>` : ''}
    <path d="${upperPath}" fill="url(#${id}u)"/>
    <path d="${upperPath}" fill="url(#${id}k)"/>
    <path d="${upperPath}" fill="url(#${id}d)"/>
    <path d="M14 78C40 66 90 63 140 59C180 57 214 65 232 75${bottom}Z" fill="${P.dark}" opacity=".24"/>
    <path d="M${o(22, 24)}C${o(32, 18)} ${o(44, 22)} ${o(54, 28)}C${o(66, 32)} ${o(84, 28)} ${o(98, 16)}" fill="none" stroke="${P.dark}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="${laces}" stroke="${P.lace}" stroke-width="3.4" stroke-linecap="round"/>
    <path d="${laces}" stroke="${P.dark}" stroke-width="1" stroke-dasharray="1.2 1.8" stroke-linecap="round" opacity=".45"/>
    <path d="M${o(19, 26)}C${o(10, 14)} ${o(17, 2)} ${o(30, 9)}" fill="none" stroke="${P.light}" stroke-width="5.5" stroke-linecap="round"/>
    <path d="${pts([[24, 50], [38, 45], [36, 49], [50, 44], [36, 56], [39, 51]])}" fill="${P.mark}"/>
    ${P.sheen ? `<path d="${upperPath}" fill="url(#${id}s)"/>` : ''}
    <path d="${upperPath}" fill="none" stroke="#000" stroke-opacity=".1" stroke-width="1"/>
    <path d="${sole}" fill="url(#${id}m)"/>
    <path d="${waves}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"/>
    <path d="${OUTSOLE}" fill="${P.outsole}"/>`;
}

// ---------------------------------------------------------------- Court
// High-top court classic: tall padded ankle collar, colour-blocked panels,
// perforated toe, stitched cupsole and the RUNNER badge on the collar.
function drawCourt(id, s, P) {
  const base = P.midTone === 0 ? '#f3f3ef' : P.upper;
  const panel = P.midTone === 0 ? P.upper : P.dark;
  const toe = s.edition === 'neon' ? P.light : '#f6f6f2';
  const sole = s.edition === 'neon' ? '#18181b' : s.edition === 'gold' ? '#fff8e1' : P.midTone === 1 ? '#f1ead8' : '#fbfbf8';
  const upperPath = 'M14 78L13 34C13 18 20 7 32 5C44 3 58 5 67 9L72 13C82 16 92 19 100 23C118 34 150 46 188 56C214 62 232 68 232 78C180 81 120 80 60 79C40 78 24 78 14 78Z';
  const laces = Array.from({ length: 6 }, (_, i) => { const x = 108 + i * 13, y = 28 + i * 5.6; return `M${x} ${y}L${x - 12} ${y + 8}`; }).join('');
  const perfs = [[196, 66], [204, 68], [212, 70], [200, 72], [208, 74], [216, 74], [220, 70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1"/>`).join('');
  const bolt = (dx, dy, k) => BOLT_SHAPE.map(([x, y], i) => `${i ? 'L' : 'M'}${(dx + (x - 60) * k).toFixed(1)} ${(dy + (y - 34) * k).toFixed(1)}`).join('') + 'Z';
  return `
    ${P.glow ? `<path d="M10 77L232 79C238 79 240 83 239 88C238 95 232 98 222 98L22 98C14 98 10 94 10 88Z" fill="${P.mid2}" filter="url(#${id}g)" opacity=".9"/>` : ''}
    <path d="${upperPath}" fill="${base}"/>
    ${P.midTone !== 0 ? `<path d="${upperPath}" fill="url(#${id}u)"/>` : ''}
    <path d="${upperPath}" fill="url(#${id}d)"/>
    <path d="M168 51C198 58 226 64 232 76L232 79C214 80 196 80 172 80C169 70 168 61 168 51Z" fill="${toe}"/>
    <g fill="#000" opacity=".25">${perfs}</g>
    <path d="M14 78L13 36C26 41 38 46 46 54C43 62 43 71 47 79Z" fill="${panel}"/>
    <path d="M13 34C13 18 20 7 32 5C44 3 58 5 67 9L71 22C56 17 36 19 22 33Z" fill="${panel}"/>
    <path d="M100 23C118 34 150 46 188 56L184 64C150 55 118 44 96 33Z" fill="${panel}"/>
    <path d="M60 79C66 70 78 63 96 60C120 57 146 60 170 66L172 80C140 80 100 80 60 79Z" fill="${panel}" opacity=".9"/>
    <path d="M22 33C36 19 56 17 71 22M47 79C43 71 43 62 46 54M96 33C118 44 150 55 184 64M60 79C66 70 78 63 96 60C120 57 146 60 170 66" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width=".8" stroke-dasharray="2 2"/>
    <path d="M90 22C94 8 104 2 114 6L116 24Z" fill="${toe}"/>
    <rect x="101" y="9" width="9" height="6" rx="1.5" fill="${panel}"/>
    <path d="${bolt(118, 50, 0.95)}" fill="${P.midTone === 0 ? P.dark : P.mark}"/>
    <path d="M13 34C13 18 20 7 32 5C44 3 58 5 67 9" fill="none" stroke="${panel}" stroke-width="5" stroke-linecap="round"/>
    <path d="M13 34C13 18 20 7 32 5C44 3 58 5 67 9" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="36" cy="21" r="6.6" fill="${panel}" stroke="${toe}" stroke-width="1.6"/>
    <path d="${bolt(36, 21, 0.24)}" fill="${toe}"/>
    <path d="${laces}" stroke="${P.lace === '#ffffff' ? '#ffffff' : P.dark}" stroke-width="2.6" stroke-linecap="round"/>
    ${P.sheen ? `<path d="${upperPath}" fill="url(#${id}s)"/>` : ''}
    <path d="${upperPath}" fill="none" stroke="#000" stroke-opacity=".14" stroke-width="1"/>
    <path d="M10 77L232 79C238 79 240 83 239 88C238 95 232 98 222 98L22 98C14 98 10 94 10 88Z" fill="${sole}" stroke="#000" stroke-opacity=".1" stroke-width="1"/>
    <path d="M16 85L233 86.5" stroke="#000" stroke-opacity=".28" stroke-width=".9" stroke-dasharray="2.2 1.8"/>
    <path d="M12 95L236 95C234 100 229 102 221 102L22 102C16 102 12 100 12 95Z" fill="${s.edition && s.edition !== 'standard' ? P.outsole : panel}"/>`;
}

const DRAW = { stride: drawStride, pod: drawPod, knit: drawKnit, court: drawCourt };
const DEFAULT_PATTERN = { stride: 'mesh', pod: 'mesh', knit: 'knit', court: 'plain' };

/** SVG markup for a sneaker (owned, listed, or a collection preview). */
export function sneakerSvg(s, cls = 'sneaker-art') {
  const id = `sn${++seq}`;
  const model = DRAW[s.model] ? s.model : 'stride';
  const P = palette(s);
  const pattern = s.pattern || DEFAULT_PATTERN[model];
  return `<svg class="${cls} rarity-${s.rarity || 'common'} model-${model} ed-${s.edition || 'standard'}" viewBox="0 0 244 120" aria-hidden="true">
    ${defs(id, P, pattern)}
    <ellipse cx="124" cy="111" rx="108" ry="5" fill="#000" opacity=".16"/>
    ${DRAW[model](id, s, P)}
    ${sparkles(P)}
  </svg>`;
}
