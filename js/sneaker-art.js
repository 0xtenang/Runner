// Original RUNNER sneaker illustrations — four lines (Stride, Pod, Knit, Court)
// inspired by popular shoe *styles* but drawn from scratch with our own
// details and the RUNNER bolt mark. No real brand's logos, stripes, text or
// signature parts are used (e.g. no hollow tube soles, no side stripe text,
// no swoosh or wings).
//
// Drawn like a studio product shot: no outlines; each part is lit from the
// top left with clipped volume shading, a soft shadow where the upper meets
// the sole, a dark collar lining, lit laces and eyelets, and a contact shadow.
//
// A sneaker's look comes from its fields: model, hue, accent, midTone,
// pattern, laces, edition (set from its token in collection.js). Class
// (type) shapes the sole on running lines; rarity adds finish effects.

const STACK = { walker: 10, jogger: 4, runner: 12, trainer: 5 }; // heel stack by class
let seq = 0; // unique gradient ids when many sneakers share a page

const BOLT_SHAPE = [[60, 50], [98, 38], [94, 46], [132, 34], [92, 58], [97, 49]];
const SPARKLE = 'M0-7L1.8-1.8L7 0L1.8 1.8L0 7L-1.8 1.8L-7 0L-1.8-1.8Z';
const f1 = (n) => n.toFixed(1);

function palette(s) {
  const seed = Number(s.serial) || Math.round((s.hue ?? 120) * 7.3) || 1;
  const rar = s.rarity || 'common';
  const h = s.hue ?? 120;
  const h2 = s.accent ?? (h + 140 + (seed % 80)) % 360;
  const midTone = s.midTone ?? seed % 3;
  const lightLaces = s.laces ? s.laces === 'light' : seed % 2 === 1;
  const shiny = rar === 'rare' || rar === 'epic';
  const dark = `hsl(${h} 42% 19%)`;
  let P = {
    h, h2, midTone,
    upper: `hsl(${h} 58% 46%)`, upper2: `hsl(${(h + 26) % 360} 66% 56%)`,
    dark, light: `hsl(${h} 62% 86%)`, lining: `hsl(${h} 26% 13%)`,
    mid: midTone === 0 ? '#f6f6f2' : midTone === 1 ? `hsl(${h2} 80% 62%)` : `hsl(${h} 62% 88%)`,
    mid2: shiny ? `hsl(${h2} 85% 56%)` : midTone === 0 ? '#d9d9d2' : midTone === 1 ? `hsl(${h2} 70% 48%)` : `hsl(${h} 46% 72%)`,
    mark: midTone === 1 ? '#ffffff' : `hsl(${h2} 85% 58%)`,
    lace: lightLaces ? '#f7f7f5' : dark,
    plate: rar === 'epic' ? '#f5c518' : '#1a1a1a',
    outsole: '#1c1c1e', outsoleTop: '#46464a',
    grad: rar !== 'common', sheen: shiny, glow: rar === 'epic', sparkle: rar === 'epic',
  };
  const ed = s.edition || 'standard';
  if (ed === 'gold') {
    P = { ...P, upper: '#b9861a', upper2: '#f1d47a', dark: '#5e4109', light: '#fff1c2', lining: '#3b2a08', mid: '#fff8e1', mid2: '#e2bd5a',
      mark: '#fffbe8', lace: '#5e4109', plate: '#f5c518', outsole: '#3b2a08', outsoleTop: '#7a5a1c', grad: true, sheen: true, glow: true, sparkle: true };
  } else if (ed === 'ghost') {
    P = { ...P, upper: `hsl(${h} 24% 93%)`, upper2: `hsl(${h2} 40% 88%)`, dark: `hsl(${h} 14% 62%)`, light: '#ffffff', lining: `hsl(${h} 12% 40%)`,
      mid: '#ffffff', mid2: `hsl(${h2} 45% 85%)`, mark: `hsl(${h2} 80% 58%)`, lace: '#ffffff', outsole: `hsl(${h} 10% 52%)`, outsoleTop: `hsl(${h} 10% 70%)`, grad: true, sheen: true };
  } else if (ed === 'neon') {
    P = { ...P, upper: `hsl(${h} 100% 52%)`, upper2: `hsl(${h2} 100% 58%)`, dark: `hsl(${h} 85% 18%)`, light: `hsl(${h2} 100% 82%)`, lining: '#0b0b0c',
      mid: '#26262a', mid2: `hsl(${h2} 100% 48%)`, mark: '#ffffff', lace: '#ffffff', outsole: '#0b0b0c', outsoleTop: '#2a2a2e', grad: true, glow: true };
  }
  return P;
}

function patternDef(id, kind) {
  switch (kind) {
    case 'knit':
      return `<pattern id="${id}k" width="5" height="4" patternUnits="userSpaceOnUse"><path d="M0 2Q1.25.4 2.5 2T5 2" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width=".9"/><path d="M0 3.6Q1.25 2 2.5 3.6T5 3.6" fill="none" stroke="#000" stroke-opacity=".1" stroke-width=".7"/></pattern>`;
    case 'speckle':
      return `<pattern id="${id}k" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".8" fill="#000" opacity=".18"/><circle cx="6.5" cy="1.5" r=".6" fill="#fff" opacity=".35"/><circle cx="5" cy="7" r=".9" fill="#000" opacity=".14"/><circle cx="8" cy="5.5" r=".5" fill="#fff" opacity=".28"/></pattern>`;
    case 'plain':
      return `<pattern id="${id}k" width="4" height="4" patternUnits="userSpaceOnUse"/>`;
    default: // engineered mesh
      return `<pattern id="${id}k" width="4.4" height="3.8" patternUnits="userSpaceOnUse"><ellipse cx="2.2" cy="1.9" rx="1.1" ry=".8" fill="#000" opacity=".16"/><ellipse cx="2" cy="1.6" rx=".7" ry=".45" fill="#fff" opacity=".14"/></pattern>`;
  }
}

function defs(id, P, pattern) {
  return `<defs>
    <linearGradient id="${id}u" x1="0" y1="0" x2="1" y2=".35"><stop offset="0" stop-color="${P.upper}"/><stop offset="1" stop-color="${P.grad ? P.upper2 : P.upper}"/></linearGradient>
    <linearGradient id="${id}v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".26"/><stop offset=".34" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
    <radialGradient id="${id}e" cx=".55" cy=".42" r=".62"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></radialGradient>
    <radialGradient id="${id}h"><stop offset="0" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset=".05" stop-color="${P.mid}"/><stop offset="1" stop-color="${P.mid2}"/></linearGradient>
    <linearGradient id="${id}n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".16" stop-color="#fff" stop-opacity="0"/><stop offset=".66" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".26"/></linearGradient>
    <linearGradient id="${id}o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.outsoleTop}"/><stop offset=".55" stop-color="${P.outsole}"/></linearGradient>
    <linearGradient id="${id}x" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.lining}"/><stop offset="1" stop-color="#000"/></linearGradient>
    <linearGradient id="${id}s" x1="0" x2="1" y1="0" y2="0" gradientTransform="rotate(28)">
      <stop offset=".28" stop-color="#fff" stop-opacity="0"/><stop offset=".43" stop-color="#fff" stop-opacity=".42"/>
      <stop offset=".5" stop-color="#cdf7ff" stop-opacity=".18"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    ${patternDef(id, pattern)}
    <filter id="${id}b1" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="1"/></filter>
    <filter id="${id}b3" x="-30%" y="-300%" width="160%" height="700%"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="${id}g" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>`;
}

const sparkles = (P) => (P.sparkle ? [[26, 10, 1], [216, 28, 0.8], [196, 8, 0.6]].map(([x, y, k]) =>
  `<path class="sparkle" transform="translate(${x} ${y}) scale(${k})" d="${SPARKLE}"/>`).join('') : '');

/** Soft studio shadow under the shoe: a wide falloff and a tight contact line. */
const groundShadow = (id, y = 109) => `
    <ellipse cx="124" cy="${y}" rx="110" ry="5.5" fill="#000" opacity=".14" filter="url(#${id}b3)"/>
    <ellipse cx="120" cy="${y - 1.4}" rx="98" ry="2.2" fill="#000" opacity=".3" filter="url(#${id}b1)"/>`;

/** Lighting for an upper: volume, edge falloff, shadow at the sole seam, highlights, finish. */
function upperLight(id, P, upper, seam, lights) {
  return `
      <path d="${upper}" fill="url(#${id}v)"/>
      <path d="${upper}" fill="url(#${id}e)"/>
      <path d="${seam}" fill="none" stroke="#000" stroke-opacity=".38" stroke-width="7" filter="url(#${id}b3)"/>
      ${lights.map(([x, y, rx, ry, rot, op]) => `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${f1(x)} ${f1(y)})" fill="url(#${id}h)" opacity="${op}"/>`).join('')}
      ${P.sheen ? `<path d="${upper}" fill="url(#${id}s)"/>` : ''}`;
}

/** Lighting for a midsole: top bevel catch-light, bottom falloff, a lit edge along the seam. */
const midLight = (id, mid, seam) => `
      <path d="${mid}" fill="url(#${id}n)"/>
      <path d="${mid}" fill="url(#${id}e)" opacity=".55"/>
      <path d="${seam}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.6"/>`;

/** Laces crossing the throat: shadow, cord, highlight; eyelets at both ends. */
function laceSet(id, P, list, width = 2.6) {
  const d = list.map(([x1, y1, x2, y2]) => `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`).join('');
  const eyes = list.flatMap(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]])
    .map(([x, y]) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="1.9" fill="${P.dark}"/><circle cx="${f1(x - 0.3)}" cy="${f1(y - 0.3)}" r=".9" fill="#000" opacity=".55"/>`).join('');
  return `${eyes}
    <path d="${d}" stroke="#000" stroke-opacity=".32" stroke-width="${width + 0.6}" stroke-linecap="round" transform="translate(.6 .9)" filter="url(#${id}b1)"/>
    <path d="${d}" stroke="${P.lace}" stroke-width="${width}" stroke-linecap="round"/>
    <path d="${d}" stroke="#fff" stroke-opacity=".55" stroke-width=".7" stroke-linecap="round" transform="translate(-.3 -.6)"/>`;
}

/** The RUNNER bolt, slightly embossed. */
const boltMark = (id, d, fill) => `
    <path d="${d}" fill="#000" opacity=".28" transform="translate(.8 1)" filter="url(#${id}b1)"/>
    <path d="${d}" fill="${fill}"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".6" transform="translate(-.3 -.4)"/>`;

const stitch = (d, op = 0.4) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${op}" stroke-width=".65" stroke-dasharray="1.6 1.4" stroke-linecap="round"/>`;

/** Helpers for running lines: stack height tapers from heel to toe. */
function stackHelpers(S) {
  const off = (x) => 0.75 * S * (1 - 0.6 * x / 240);
  const o = (x, y) => `${x} ${f1(y - off(x))}`;
  const pts = (list) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${o(x, y)}`).join('') + 'Z';
  const line = (pairs) => pairs.map(([x, y], i) => `${i === 0 ? 'M' : i % 3 === 1 ? 'C' : ''}${x} ${f1(y - off(x) * 0.5)}`).join(' ');
  const topEdge = `C${o(200, 79)} ${o(120, 74)} ${o(50, 67)}C${o(30, 65.5)} ${o(18, 65)} ${o(10, 65)}`;
  const seam = `M${o(230, 75)}${topEdge}`;
  const midPath = `M${o(10, 65)}C${o(4, 76)} 4 92 16 100C50 106 140 107 190 102C212 99 228 90 238 78C240 75 236 74 ${o(230, 75)}${topEdge}Z`;
  return { off, o, pts, line, topEdge, seam, midPath };
}
const OUTSOLE = 'M16 100C50 106 140 107 190 102C212 99 228 90 238 78L240 82C232 95 214 104 190 106.5C140 112 50 111 14 104Z';
const OUTSOLE_EDGE = 'M16 100C50 106 140 107 190 102C212 99 228 90 238 78';

function outsole(id, P, type) {
  const lugs = type === 'trainer' ? Array.from({ length: 11 }, (_, i) => {
    const x = 26 + i * 17, y = 103 + 6 * (1 - ((x - 110) / 100) ** 2);
    return `<rect x="${x}" y="${f1(y)}" width="9" height="4.5" rx="1.5"/>`;
  }).join('') : '';
  return `
    <path d="${OUTSOLE}" fill="url(#${id}o)"/>
    ${lugs ? `<g fill="${P.outsole}">${lugs}</g>` : ''}
    <path d="${OUTSOLE_EDGE}" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width=".8" transform="translate(0 1.4)"/>`;
}

/** Throat laces for running lines, following the eyestay. */
const runLaces = (o, x0, y0, n = 5, dx = 13.5, dy = 6.4) => Array.from({ length: n }, (_, i) => {
  const x = x0 + i * dx, y = y0 + i * dy;
  const [ax, ay] = o(x, y).split(' ').map(Number), [bx, by] = o(x - 12, y + 8).split(' ').map(Number);
  return [ax, ay, bx, by];
});

// ---------------------------------------------------------------- Stride
// Everyday performance runner: engineered mesh, lace-cage straps, padded heel
// counter, sculpted midsole (a carbon-style plate on Daily Runners).
function drawStride(id, s, P) {
  const S = STACK[s.type] ?? 4;
  const { off, o, pts, line, topEdge, seam, midPath } = stackHelpers(S);
  const upper = `M${o(12, 66)}C${o(8, 48)} ${o(10, 30)} ${o(18, 22)}C${o(22, 16)} ${o(32, 14)} ${o(38, 18)}C${o(48, 26)} ${o(60, 30)} ${o(74, 28)}C${o(84, 26)} ${o(90, 18)} ${o(96, 12)}C${o(100, 7)} ${o(110, 8)} ${o(112, 14)}C${o(120, 30)} ${o(150, 44)} ${o(186, 55)}C${o(212, 61)} ${o(234, 68)} ${o(230, 75)}${topEdge}Z`;
  const straps = [0, 1, 2].map((i) => {
    const tx = 112 + i * 22, ty = 22 + i * 9.5, bx = 72 + i * 30, by = 63 + i * 3;
    return `M${o(tx - 3, ty)}L${o(tx + 5, ty + 2)}L${o(bx + 9, by)}L${o(bx - 6, by - 1)}Z`;
  }).join('');
  return `
    ${groundShadow(id)}
    ${P.glow ? `<path d="${midPath}" fill="${P.mid2}" filter="url(#${id}g)" opacity=".85"/>` : ''}
    <clipPath id="${id}cu"><path d="${upper}"/></clipPath><clipPath id="${id}cm"><path d="${midPath}"/></clipPath>
    <path d="M${o(15, 26)}C${o(10, 15)} ${o(15, 6)} ${o(24, 8)}L${o(28, 15)}C${o(23, 13)} ${o(20, 18)} ${o(21, 25)}Z" fill="${P.dark}"/>
    <g clip-path="url(#${id}cu)">
      <path d="${upper}" fill="url(#${id}u)"/><path d="${upper}" fill="url(#${id}k)"/>
      <path d="M${o(0, 70)}L${o(0, 16)}C${o(22, 16)} ${o(38, 26)} ${o(46, 40)}C${o(52, 51)} ${o(52, 61)} ${o(49, 70)}Z" fill="${P.dark}" opacity=".5"/>
      ${stitch(`M${o(8, 19)}C${o(27, 21)} ${o(40, 30)} ${o(45, 43)}C${o(49, 53)} ${o(48, 61)} ${o(46, 68)}`)}
      <path d="M${o(126, 80)}C${o(152, 66)} ${o(196, 62)} ${o(238, 68)}L${o(240, 90)}L${o(126, 90)}Z" fill="${P.dark}" opacity=".26"/>
      ${stitch(`M${o(130, 77)}C${o(156, 65)} ${o(196, 61)} ${o(236, 67)}`, 0.3)}
      <path d="${straps}" fill="${P.dark}" opacity=".3"/>
      <path d="M${o(100, 15)}C${o(122, 33)} ${o(150, 46)} ${o(186, 56)}" fill="none" stroke="${P.dark}" stroke-width="13" stroke-linecap="round" opacity=".42"/>
      <path d="M${o(101, 9)}C${o(123, 27)} ${o(152, 40)} ${o(188, 50)}" fill="none" stroke="#fff" stroke-width="1" opacity=".3"/>
      <path d="M${o(18, 26)}C${o(24, 19)} ${o(32, 18)} ${o(38, 21)}C${o(48, 28)} ${o(60, 31)} ${o(74, 29)}C${o(84, 27)} ${o(90, 20)} ${o(95, 15)}L${o(96, 19)}C${o(90, 25)} ${o(84, 31)} ${o(74, 32)}C${o(60, 34)} ${o(47, 31)} ${o(38, 25)}C${o(32, 21)} ${o(25, 22)} ${o(19, 28)}Z" fill="url(#${id}x)" opacity=".88"/>
      <path d="M${o(90, 18)}C${o(95, 7)} ${o(104, 4)} ${o(112, 9)}L${o(117, 21)}C${o(108, 17)} ${o(98, 18)} ${o(92, 22)}Z" fill="${P.light}"/>
      ${upperLight(id, P, upper, seam, [[...o(128, 34).split(' ').map(Number), 46, 6, 21, 0.5], [...o(206, 61).split(' ').map(Number), 17, 3.2, 15, 0.75], [...o(17, 42).split(' ').map(Number), 2.6, 13, 4, 0.45]])}
    </g>
    ${boltMark(id, pts(BOLT_SHAPE), P.mark)}
    ${laceSet(id, P, runLaces(o, 117, 27.5))}
    ${outsole(id, P, s.type)}
    <g clip-path="url(#${id}cm)">
      <path d="${midPath}" fill="url(#${id}m)"/>
      <path d="${line([[22, 84], [70, 92], [160, 93], [222, 82]])}" fill="none" stroke="#000" stroke-opacity=".16" stroke-width="2.4" stroke-linecap="round"/>
      <path d="${line([[22, 85.6], [70, 93.6], [160, 94.6], [222, 83.6]])}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>
      <path d="M18 ${f1(82 - off(18) * 0.5)}C26 ${f1(74 - off(26) * 0.5)} 66 ${f1(76 - off(66) * 0.5)} 98 ${f1(84 - off(98) * 0.5)}C68 ${f1(90 - off(68) * 0.5)} 30 ${f1(90 - off(30) * 0.5)} 18 ${f1(82 - off(18) * 0.5)}Z" fill="${P.sheen ? P.mark : '#000'}" opacity="${P.sheen ? 0.8 : 0.08}"/>
      ${s.type === 'runner' ? `<path d="${line([[26, 78], [90, 86], [170, 86], [234, 76]])}" fill="none" stroke="${P.plate}" stroke-width="3" stroke-linecap="round"/>` : ''}
      ${midLight(id, midPath, seam)}
    </g>`;
}

// ---------------------------------------------------------------- Pod
// Cloud-cushion runner: a row of soft raised cushion pillows on the midsole
// and a sweeping wave panel on the upper. (Closed pillows, not hollow tubes.)
function drawPod(id, s, P) {
  const S = Math.max(6, STACK[s.type] ?? 6);
  const { off, o, pts, topEdge, seam, midPath } = stackHelpers(S);
  const upper = `M${o(12, 66)}C${o(9, 49)} ${o(11, 33)} ${o(18, 25)}C${o(23, 19)} ${o(32, 17)} ${o(39, 21)}C${o(50, 29)} ${o(62, 32)} ${o(76, 30)}C${o(86, 28)} ${o(92, 20)} ${o(98, 14)}C${o(102, 9)} ${o(110, 10)} ${o(113, 16)}C${o(122, 32)} ${o(152, 45)} ${o(188, 56)}C${o(213, 62)} ${o(234, 68)} ${o(230, 75)}${topEdge}Z`;
  const wave = `M${o(16, 61)}C${o(46, 44)} ${o(86, 47)} ${o(124, 41)}C${o(150, 37)} ${o(172, 42)} ${o(196, 52)}L${o(198, 80)}L${o(10, 80)}Z`;
  const pillows = Array.from({ length: 7 }, (_, i) => {
    const x = 20 + i * 29, cx = x + 12, y = 82 - off(cx) * 0.5 + (i > 4 ? (i - 4) * 2.5 : 0);
    return `<rect x="${x}" y="${f1(y + 2.4)}" width="24" height="13" rx="6.5" fill="#000" opacity=".22" filter="url(#${id}b1)"/>
      <rect x="${x}" y="${f1(y)}" width="24" height="13" rx="6.5" fill="${P.mid}"/>
      <rect x="${x}" y="${f1(y)}" width="24" height="13" rx="6.5" fill="url(#${id}n)"/>
      <ellipse cx="${x + 9}" cy="${f1(y + 3.6)}" rx="6" ry="1.7" fill="url(#${id}h)" opacity=".9"/>`;
  }).join('');
  return `
    ${groundShadow(id)}
    ${P.glow ? `<path d="${midPath}" fill="${P.mid2}" filter="url(#${id}g)" opacity=".85"/>` : ''}
    <clipPath id="${id}cu"><path d="${upper}"/></clipPath><clipPath id="${id}cm"><path d="${midPath}"/></clipPath>
    <path d="M${o(16, 28)}C${o(11, 17)} ${o(16, 8)} ${o(25, 10)}L${o(29, 17)}C${o(24, 15)} ${o(21, 20)} ${o(22, 27)}Z" fill="${P.dark}"/>
    <g clip-path="url(#${id}cu)">
      <path d="${upper}" fill="url(#${id}u)"/><path d="${upper}" fill="url(#${id}k)"/>
      <path d="${wave}" fill="${P.dark}" opacity=".4"/>
      <path d="M${o(16, 61)}C${o(46, 44)} ${o(86, 47)} ${o(124, 41)}C${o(150, 37)} ${o(172, 42)} ${o(196, 52)}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.1"/>
      ${stitch(`M${o(18, 64)}C${o(48, 48)} ${o(86, 51)} ${o(124, 45)}C${o(150, 41)} ${o(172, 46)} ${o(195, 56)}`, 0.35)}
      <path d="M${o(0, 70)}L${o(0, 20)}C${o(20, 20)} ${o(34, 28)} ${o(42, 40)}C${o(47, 50)} ${o(47, 60)} ${o(45, 70)}Z" fill="${P.dark}" opacity=".35"/>
      <path d="M${o(102, 17)}C${o(124, 35)} ${o(152, 47)} ${o(188, 57)}" fill="none" stroke="${P.dark}" stroke-width="12" stroke-linecap="round" opacity=".38"/>
      <path d="M${o(19, 28)}C${o(25, 22)} ${o(33, 21)} ${o(39, 24)}C${o(50, 31)} ${o(62, 34)} ${o(76, 32)}C${o(86, 30)} ${o(92, 23)} ${o(97, 17)}L${o(98, 21)}C${o(92, 27)} ${o(86, 33)} ${o(76, 34)}C${o(62, 36)} ${o(49, 33)} ${o(39, 27)}C${o(33, 23)} ${o(26, 24)} ${o(20, 30)}Z" fill="url(#${id}x)" opacity=".88"/>
      <path d="M${o(92, 20)}C${o(97, 9)} ${o(105, 5)} ${o(113, 10)}L${o(118, 22)}C${o(109, 18)} ${o(99, 19)} ${o(94, 24)}Z" fill="${P.light}"/>
      ${upperLight(id, P, upper, seam, [[...o(130, 36).split(' ').map(Number), 44, 6, 21, 0.5], [...o(207, 62).split(' ').map(Number), 17, 3.2, 15, 0.75], [...o(17, 44).split(' ').map(Number), 2.6, 12, 4, 0.45]])}
    </g>
    ${boltMark(id, pts([[26, 46], [42, 40], [40, 44], [56, 38], [40, 50], [43, 45]]), P.mark)}
    ${laceSet(id, P, runLaces(o, 119, 29.5))}
    ${outsole(id, P, s.type)}
    <g clip-path="url(#${id}cm)">
      <path d="${midPath}" fill="url(#${id}m)"/>
      ${s.type === 'runner' ? `<path d="M26 ${f1(76 - off(26) * 0.5)}C90 ${f1(80 - off(90) * 0.5)} 170 ${f1(80 - off(170) * 0.5)} 232 ${f1(74 - off(232) * 0.5)}" fill="none" stroke="${P.plate}" stroke-width="3" stroke-linecap="round"/>` : ''}
      ${midLight(id, midPath, seam)}
    </g>
    ${pillows}`;
}

// ---------------------------------------------------------------- Knit
// Sock-knit lifestyle runner: one-piece knitted upper with a ribbed ankle
// collar, heel loop, rope laces and a soft wave-textured sole.
function drawKnit(id, s, P) {
  const { o, pts } = stackHelpers(3);
  // Lower, slimmer sole than the running lines; the knit upper wraps down to meet it.
  const bottom = 'C180 78 120 80 60 79C40 79 24 78 14 78';
  const seam = `M232 75${bottom}`;
  const sole = 'M10 77C6 84 8 96 18 100C50 106 140 107 190 102C212 99 228 90 238 80C240 77 236 75 230 75C180 78 120 80 60 79C40 79 24 78 10 77Z';
  const upper = `M14 78C${o(9, 52)} ${o(11, 32)} ${o(20, 22)}C${o(26, 15)} ${o(36, 14)} ${o(44, 20)}C${o(54, 27)} ${o(64, 28)} ${o(76, 25)}C${o(86, 22)} ${o(92, 15)} ${o(100, 12)}C${o(106, 10)} ${o(112, 12)} ${o(116, 18)}C${o(126, 32)} ${o(158, 44)} ${o(194, 53)}C220 60 236 67 232 75${bottom}Z`;
  const laces = Array.from({ length: 6 }, (_, i) => { const x = 118 + i * 12.5, y = 26 + i * 5.8; return [x, y - 3 + i * 0.2, x - 12, y + 6]; });
  const ribs = [0, 1, 2, 3].map((i) => `M${o(16 + i * 2, 24 + i * 3.2)}C${o(30, 17 + i * 3.4)} ${o(46, 24 + i * 3)} ${o(60, 29 + i * 2.6)}C${o(76, 31 + i * 2.2)} ${o(90, 22 + i * 2.4)} ${o(100, 15 + i * 2.6)}`).join('');
  const waves = [88, 95].map((y) => `M16 ${y}${Array.from({ length: 11 }, (_, i) => `Q${21 + i * 20} ${y - 3.5} ${26 + i * 20} ${y}T${36 + i * 20} ${y}`).join('')}`).join('');
  return `
    ${groundShadow(id)}
    ${P.glow ? `<path d="${sole}" fill="${P.mid2}" filter="url(#${id}g)" opacity=".85"/>` : ''}
    <clipPath id="${id}cu"><path d="${upper}"/></clipPath><clipPath id="${id}cm"><path d="${sole}"/></clipPath>
    <path d="M${o(19, 26)}C${o(10, 14)} ${o(17, 2)} ${o(30, 9)}" fill="none" stroke="${P.dark}" stroke-width="5.5" stroke-linecap="round"/>
    <path d="M${o(19, 26)}C${o(10, 14)} ${o(17, 2)} ${o(30, 9)}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1.2" stroke-linecap="round" transform="translate(-.6 -.8)"/>
    <g clip-path="url(#${id}cu)">
      <path d="${upper}" fill="url(#${id}u)"/><path d="${upper}" fill="url(#${id}k)"/>
      <path d="M14 78C40 66 90 63 140 59C180 57 214 65 232 75${bottom}Z" fill="${P.dark}" opacity=".22"/>
      <path d="${ribs}" fill="none" stroke="${P.dark}" stroke-opacity=".35" stroke-width="1.6"/>
      <path d="${ribs}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width=".7" transform="translate(0 -1)"/>
      <path d="M${o(20, 23)}C${o(27, 16)} ${o(36, 15)} ${o(44, 21)}C${o(54, 28)} ${o(64, 29)} ${o(76, 26)}C${o(86, 23)} ${o(92, 16)} ${o(100, 13)}L${o(101, 18)}C${o(93, 22)} ${o(86, 29)} ${o(76, 31)}C${o(62, 34)} ${o(52, 32)} ${o(43, 26)}C${o(35, 21)} ${o(27, 22)} ${o(21, 28)}Z" fill="url(#${id}x)"/>
      ${upperLight(id, P, upper, seam, [[132, 36, 46, 6, 20, 0.45], [210, 63, 16, 3, 15, 0.7], [16, 46, 2.6, 13, 4, 0.4]])}
    </g>
    ${boltMark(id, pts([[24, 50], [38, 45], [36, 49], [50, 44], [36, 56], [39, 51]]), P.mark)}
    ${laceSet(id, P, laces, 3.2)}
    <path d="${laces.map(([a, b, c, d]) => `M${a} ${b}L${c} ${d}`).join('')}" stroke="${P.dark}" stroke-width="1" stroke-dasharray="1.2 1.8" stroke-linecap="round" opacity=".4"/>
    ${outsole(id, P, 'knit')}
    <g clip-path="url(#${id}cm)">
      <path d="${sole}" fill="url(#${id}m)"/>
      <path d="${waves}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.5"/>
      <path d="${waves}" fill="none" stroke="#000" stroke-opacity=".1" stroke-width="1.5" transform="translate(0 1.4)"/>
      ${midLight(id, sole, seam)}
    </g>`;
}

// ---------------------------------------------------------------- Court
// High-top court classic: tall padded ankle collar, colour-blocked panels,
// perforated toe, stitched cupsole and the RUNNER badge on the collar.
function drawCourt(id, s, P) {
  const base = P.midTone === 0 ? '#f2f2ee' : P.upper;
  const panel = P.midTone === 0 ? P.upper : P.dark;
  const toe = s.edition === 'neon' ? P.light : '#f5f5f1';
  const soleFill = s.edition === 'neon' ? '#1c1c20' : s.edition === 'gold' ? '#fff8e1' : P.midTone === 1 ? '#efe8d6' : '#fafaf7';
  const upper = 'M14 78L13 34C13 18 20 7 32 5C44 3 58 5 67 9L72 13C82 16 92 19 100 23C118 34 150 46 188 56C214 62 232 68 232 78C180 81 120 80 60 79C40 78 24 78 14 78Z';
  const seam = 'M232 78C180 81 120 80 60 79C40 78 24 78 14 78';
  const cup = 'M10 77L232 79C238 79 240 83 239 88C238 95 232 98 222 98L22 98C14 98 10 94 10 88Z';
  const laces = Array.from({ length: 6 }, (_, i) => { const x = 108 + i * 13, y = 28 + i * 5.6; return [x, y, x - 12, y + 8]; });
  const perfs = [[196, 66], [204, 68], [212, 70], [200, 72], [208, 74], [216, 74], [220, 70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1"/>`).join('');
  const bolt = (dx, dy, k) => BOLT_SHAPE.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(dx + (x - 60) * k)} ${f1(dy + (y - 34) * k)}`).join('') + 'Z';
  return `
    ${groundShadow(id, 104)}
    ${P.glow ? `<path d="${cup}" fill="${P.mid2}" filter="url(#${id}g)" opacity=".85"/>` : ''}
    <clipPath id="${id}cu"><path d="${upper}"/></clipPath><clipPath id="${id}cm"><path d="${cup}"/></clipPath>
    <path d="M86 26C90 10 102 2 113 5C117 6 119 10 118 16L114 30Z" fill="${toe}"/>
    <path d="M86 26C90 10 102 2 113 5C117 6 119 10 118 16L114 30Z" fill="url(#${id}v)"/>
    <rect x="100" y="8" width="9" height="6" rx="1.5" fill="${panel}"/>
    <g clip-path="url(#${id}cu)">
      <path d="${upper}" fill="${base}"/>
      ${P.midTone !== 0 ? `<path d="${upper}" fill="url(#${id}u)"/>` : ''}
      <path d="M168 51C198 58 226 64 232 76L232 80C214 80 196 80 172 80C169 70 168 61 168 51Z" fill="${toe}"/>
      <g fill="#000" opacity=".28">${perfs}</g>
      <path d="M14 78L13 36C26 41 38 46 46 54C43 62 43 71 47 79Z" fill="${panel}"/>
      <path d="M0 40L0 0L70 0L71 22C56 17 36 19 22 33Z" fill="${panel}"/>
      <path d="M100 23C118 34 150 46 188 56L184 64C150 55 118 44 96 33Z" fill="${panel}"/>
      <path d="M60 79C66 70 78 63 96 60C120 57 146 60 170 66L172 80C140 80 100 80 60 79Z" fill="${panel}" opacity=".92"/>
      ${stitch('M22 33C36 19 56 17 71 22M47 79C43 71 43 62 46 54M96 33C118 44 150 55 184 64M60 79C66 70 78 63 96 60C120 57 146 60 170 66', 0.55)}
      <path d="M13 34C13 18 20 7 32 5C44 3 58 5 67 9L67.5 12.5C58 10 46 9.5 36 11.5C26 13.5 19 21 16 31Z" fill="url(#${id}x)" opacity=".75"/>
      ${upperLight(id, P, upper, seam, [[130, 40, 48, 6, 21, 0.45], [212, 66, 15, 3, 14, 0.7], [17, 46, 2.8, 16, 2, 0.45]])}
    </g>
    <path d="M13 34C13 18 20 7 32 5C44 3 58 5 67 9" fill="none" stroke="${panel}" stroke-width="5" stroke-linecap="round"/>
    <path d="M13 34C13 18 20 7 32 5C44 3 58 5 67 9" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.3" stroke-linecap="round" transform="translate(-.4 -.8)"/>
    ${boltMark(id, bolt(118, 50, 0.95), P.midTone === 0 ? P.dark : P.mark)}
    <circle cx="36.6" cy="21.8" r="6.8" fill="#000" opacity=".25" filter="url(#${id}b1)"/>
    <circle cx="36" cy="21" r="6.6" fill="${panel}" stroke="${toe}" stroke-width="1.6"/>
    <path d="${bolt(27.4, 18.1, 0.24)}" fill="${toe}"/>
    ${laceSet(id, { ...P, lace: P.lace === '#f7f7f5' ? '#f7f7f5' : P.dark }, laces)}
    <g clip-path="url(#${id}cm)">
      <path d="${cup}" fill="${soleFill}"/>
      <path d="${cup}" fill="url(#${id}n)"/>
      <path d="M16 85L233 86.5" stroke="#000" stroke-opacity=".28" stroke-width=".9" stroke-dasharray="2.2 1.8"/>
      <path d="M8 93L240 93L240 104L8 104Z" fill="${s.edition && s.edition !== 'standard' ? P.outsole : panel}"/>
      <path d="M8 93L240 93" stroke="#fff" stroke-opacity=".25" stroke-width=".8"/>
      <path d="${seam}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.4"/>
    </g>`;
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
    ${DRAW[model](id, s, P)}
    ${sparkles(P)}
  </svg>`;
}
