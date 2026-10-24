// Original RUNNER sneaker illustrations — four lines (Stride, Pod, Knit, Court)
// inspired by popular shoe *styles* but drawn from scratch with our own
// details and the RUNNER bolt mark. No real brand's logos, stripes, text or
// signature parts are used (e.g. no hollow tube or cloud-pod soles, no side
// stripes, no swoosh or wings).
//
// Drawn like a designer's colourway sheet rather than a 3D render: flat
// material colours, panel construction lines and stitching, a real curated
// colourway with a name, and only the shading a studio photo would show (a
// soft shadow under the collar and where the upper meets the sole).
//
// A sneaker's look comes from its fields: model, hue, accent, midTone,
// pattern, laces, edition (set from its token in collection.js). Class
// (type) shapes the sole; rarity adds the material finish.

const STACK = { walker: 10, jogger: 4, runner: 12, trainer: 5 }; // heel stack by class
let seq = 0; // unique ids when many sneakers share a page

const BOLT = [[0, 12], [26, 3.5], [23.5, 9], [50, 0], [22, 17], [25.5, 10.5]]; // RUNNER bolt, 50 × 17
const SPARKLE = 'M0-7L1.8-1.8L7 0L1.8 1.8L0 7L-1.8 1.8L-7 0L-1.8-1.8Z';
const f1 = (n) => n.toFixed(1);

// ---------------------------------------------------------------- colourways
// Curated like a real season's line: grounded neutrals, a few confident brights,
// soft tonals. [name, upper, overlay, collar, fade, mark, accent, own foam, tonal foam]
const COLORWAYS = [
  ['Midnight Black', '#1d1d1f', '#0e0e10', '#2a2a2d', '#3b3b40', '#f4f3ee', '#e8483b', '#f4f3ee', '#2b2b2e'],
  ['Cloud White', '#f2f1ec', '#dcdad2', '#e6e4dd', '#ffffff', '#1d1d1f', '#e8483b', '#f7f6f2', '#e9e7e0'],
  ['Stone Grey', '#a7a6a0', '#7d7c77', '#8f8e88', '#c9c8c2', '#f4f3ee', '#d9ff5a', '#efeee9', '#b9b8b2'],
  ['Graphite', '#45474c', '#2e3034', '#3a3c40', '#6a6d73', '#e9eaec', '#ff6a3d', '#e9e9e6', '#505257'],
  ['Harbor Navy', '#1f3556', '#142540', '#1a2c48', '#3d5a85', '#e9edf3', '#3fc6f0', '#f1f2ef', '#2a4268'],
  ['Glacier', '#d7e1ea', '#1f4e79', '#1f4e79', '#f1f5f8', '#7d93a8', '#2ec5e8', '#f7f8f8', '#c3d1dd'],
  ['Cobalt', '#2550c8', '#163a9a', '#1b3f9f', '#4d75e0', '#ffffff', '#ffd23f', '#f4f4f1', '#3a61d1'],
  ['Ocean Teal', '#1c6f73', '#124c50', '#165a5e', '#2f9095', '#eaf3f2', '#ffb347', '#f2f3ef', '#2a8085'],
  ['Mint Breeze', '#bfe6d6', '#6fae98', '#8cc4ae', '#e3f5ee', '#2f6e5c', '#1d1d1f', '#f6f7f3', '#a9dbc6'],
  ['Olive Trail', '#5d6440', '#3f4529', '#4b5232', '#7f8758', '#e8e4d2', '#f08a24', '#e9e3cf', '#6b7349'],
  ['Forest', '#24483a', '#162f26', '#1c3b2f', '#3b6a57', '#e7eee9', '#d9ff5a', '#efefe9', '#2f5848'],
  ['Sand Dune', '#d8c7a6', '#b19b72', '#c2ad86', '#ece1cb', '#5e4a2c', '#1d1d1f', '#f3ede0', '#cdb994'],
  ['Desert Clay', '#b8673f', '#8a4626', '#9c5431', '#d48a62', '#f6eadf', '#1d1d1f', '#f3eadf', '#c27750'],
  ['Signal Orange', '#e8483b', '#b6301f', '#c43a28', '#ff7a5c', '#ffffff', '#1d1d1f', '#f6f4ef', '#ee6a5a'],
  ['Ember', '#2a2a2d', '#161618', '#1f1f22', '#46464b', '#ff6a3d', '#ff6a3d', '#ff6a3d', '#3a3a3e'],
  ['Sunrise', '#ffb04a', '#e0832a', '#ef9a38', '#ffd08a', '#5a2f0c', '#e8483b', '#fff6e8', '#ffc472'],
  ['Lemon Zest', '#e9e45a', '#bdb636', '#d2cc46', '#f6f3a6', '#3d3b12', '#1d1d1f', '#f8f7ea', '#ece88a'],
  ['Coral Reef', '#f27a6a', '#cc5444', '#de6656', '#f9a99e', '#ffffff', '#1f3556', '#fbf3ef', '#f59a8d'],
  ['Pearl Pink', '#efc9d2', '#c98b9b', '#d9a5b2', '#f9e5ea', '#8e1f45', '#8e1f45', '#f8e6eb', '#f2d3db'],
  ['Berry', '#7e1f45', '#5a1230', '#6a1839', '#a3365f', '#f6dde6', '#ffb3c7', '#f5eef0', '#8f2b52'],
  ['Lilac Haze', '#cbbfe6', '#9484c2', '#ab9dd3', '#e6defa', '#3d2f6b', '#1d1d1f', '#f6f3fb', '#d8cfee'],
  ['Ice Blue', '#cfe6f5', '#86b5d6', '#a3c7e2', '#eef7fc', '#21587f', '#e8483b', '#f7fafb', '#bcdcef'],
  ['Arctic Night', '#26303d', '#161d26', '#1e2731', '#3b4757', '#9fd6ff', '#9fd6ff', '#e8edf2', '#323e4d'],
  ['Charcoal Ember', '#3a3633', '#24211f', '#2e2b28', '#57514c', '#ff8a3d', '#ff8a3d', '#ece7e1', '#47423e'],
];
const cwIndex = (s) => (Math.floor(((s.hue ?? 120) % 360) / 15) + 7 * (s.midTone ?? 0)) % COLORWAYS.length;

/** The colourway name a sneaker is drawn in (also a marketplace trait). */
export function colorwayName(s) {
  const ed = s.edition || 'standard';
  if (ed === 'gold') return 'Gold Standard';
  if (ed === 'ghost') return 'Ghost';
  if (ed === 'neon') return 'Neon Night';
  return COLORWAYS[cwIndex(s)][0];
}

function palette(s) {
  const rar = s.rarity || 'common';
  const [name, upper, overlay, collar, fade, mark, accent, ownFoam, tonalFoam] = COLORWAYS[cwIndex(s)];
  const midTone = s.midTone ?? 0;
  const mid = midTone === 0 ? '#f4f3ee' : midTone === 1 ? ownFoam : tonalFoam;
  const lightLaces = s.laces ? s.laces === 'light' : true;
  let P = {
    name, upper, overlay, collar, fade, mark, accent, mid,
    tongue: collar, lining: '#161618',
    lace: lightLaces ? '#f5f4ef' : overlay,
    outsole: '#202022', plate: rar === 'epic' ? '#f5c518' : '#1a1a1a',
    knitFade: rar !== 'common', pearl: rar === 'rare' || rar === 'epic', glow: rar === 'epic', sparkle: rar === 'epic',
  };
  const ed = s.edition || 'standard';
  if (ed === 'gold') {
    P = { ...P, name: 'Gold Standard', upper: '#c9971f', overlay: '#8a6410', collar: '#a57a16', fade: '#f1d47a', mark: '#fff6d6', accent: '#ffffff',
      mid: '#fff6dc', tongue: '#a57a16', lace: '#fff6d6', outsole: '#4a3608', knitFade: true, pearl: true, glow: true, sparkle: true };
  } else if (ed === 'ghost') {
    P = { ...P, name: 'Ghost', upper: '#eef1f4', overlay: '#cdd4dc', collar: '#dde3e9', fade: '#ffffff', mark: '#9aa7b5', accent: '#9fd6ff',
      mid: '#ffffff', tongue: '#dde3e9', lace: '#ffffff', outsole: '#b9c2cc', knitFade: true, pearl: true };
  } else if (ed === 'neon') {
    P = { ...P, name: 'Neon Night', upper: '#16161a', overlay: '#0a0a0c', collar: '#101013', fade: '#2a2a30', mark: '#d9ff5a', accent: '#ff3d9a',
      mid: '#d9ff5a', tongue: '#101013', lace: '#d9ff5a', outsole: '#0a0a0c', knitFade: true, glow: true };
  }
  P.line = mixHex(P.upper, '#000000', 0.32);    // construction lines: a darker tone of the panel, never black outlines
  P.overLine = mixHex(P.overlay, '#000000', 0.3);
  P.midLine = mixHex(P.mid, '#000000', 0.16);
  P.overStitch = luminance(P.overlay) < 0.45 ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.3)';
  return P;
}

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
function luminance(h) { const [r, g, b] = hexRgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

// ---------------------------------------------------------------- materials
function material(id, kind, P) {
  const dark = luminance(P.upper) < 0.45;
  const lo = dark ? '#ffffff' : '#000000';
  switch (kind) {
    case 'knit':
      return `<pattern id="${id}k" width="3" height="2.4" patternUnits="userSpaceOnUse"><path d="M0 1.2Q.75 0 1.5 1.2T3 1.2" fill="none" stroke="${lo}" stroke-opacity="${dark ? 0.16 : 0.1}" stroke-width=".55"/></pattern>`;
    case 'speckle':
      return `<pattern id="${id}k" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="2" r=".45" fill="${lo}" opacity=".2"/><circle cx="5" cy="1" r=".35" fill="${lo}" opacity=".16"/><circle cx="4" cy="5.2" r=".5" fill="${lo}" opacity=".14"/><circle cx="6.4" cy="4" r=".3" fill="${lo}" opacity=".18"/></pattern>`;
    case 'plain':
      return `<pattern id="${id}k" width="4" height="4" patternUnits="userSpaceOnUse"/>`;
    default: // engineered mesh: small offset holes
      return `<pattern id="${id}k" width="2.6" height="2.2" patternUnits="userSpaceOnUse"><ellipse cx=".8" cy=".7" rx=".42" ry=".3" fill="${lo}" opacity="${dark ? 0.14 : 0.1}"/><ellipse cx="2.1" cy="1.8" rx=".42" ry=".3" fill="${lo}" opacity="${dark ? 0.14 : 0.1}"/></pattern>`;
  }
}

function defs(id, P, pattern) {
  return `<defs>
    <linearGradient id="${id}u" x1="1" y1="0" x2="0" y2="0"><stop offset=".15" stop-color="${P.upper}"/><stop offset="1" stop-color="${P.knitFade ? P.fade : P.upper}"/></linearGradient>
    <linearGradient id="${id}sh" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>
    <linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
    <linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd9f1" stop-opacity="0"/><stop offset=".3" stop-color="#ffd9f1" stop-opacity=".45"/><stop offset=".55" stop-color="#c9f2ff" stop-opacity=".45"/><stop offset=".8" stop-color="#fff3c4" stop-opacity=".4"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></linearGradient>
    ${material(id, pattern, P)}
    <filter id="${id}b1" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="1"/></filter>
    <filter id="${id}b3" x="-30%" y="-300%" width="160%" height="700%"><feGaussianBlur stdDeviation="2.6"/></filter>
    <filter id="${id}g" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>`;
}

const sparkles = (P) => (P.sparkle ? [[26, 10, 1], [216, 28, 0.8], [196, 8, 0.6]].map(([x, y, k]) =>
  `<path class="sparkle" transform="translate(${x} ${y}) scale(${k})" d="${SPARKLE}"/>`).join('') : '');

/** Soft studio shadow under the shoe. */
const groundShadow = (id, y = 108.5) => `
    <ellipse cx="124" cy="${y}" rx="108" ry="4.5" fill="#000" opacity=".13" filter="url(#${id}b3)"/>
    <ellipse cx="122" cy="${y - 1}" rx="94" ry="1.6" fill="#000" opacity=".26" filter="url(#${id}b1)"/>`;

/** A panel: flat material colour and a construction line in a darker tone. */
const panel = (d, fill, line, extra = '') => `<path d="${d}" fill="${fill}" stroke="${line}" stroke-width=".6" stroke-linejoin="round" ${extra}/>`;
const stitch = (d, colour, extra = '') => `<path d="${d}" fill="none" stroke="${colour}" stroke-width=".5" stroke-dasharray="1.3 1.1" stroke-linecap="round" ${extra}/>`;
const pts = (o, list) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${o(x, y)}`).join('') + 'Z';
const boltAt = (o, x0, y0, k) => pts(o, BOLT.map(([x, y]) => [x0 + x * k, y0 + y * k]));
const xy = (o, x, y) => o(x, y).split(' ').map(Number);

/** Laces seen from the side: cord crossings over the throat with eyelets. */
function laces(P, list, w = 2.2) {
  const d = list.map(([a, b, c, e]) => `M${f1(a)} ${f1(b)}L${f1(c)} ${f1(e)}`).join('');
  const eyes = list.map(([a, b]) => `<circle cx="${f1(a)}" cy="${f1(b)}" r="1.5" fill="${P.overLine}"/><circle cx="${f1(a)}" cy="${f1(b)}" r=".7" fill="#000" opacity=".5"/>`).join('');
  return `${eyes}<path d="${d}" stroke="${mixHex(P.lace, '#000000', 0.35)}" stroke-width="${w + 0.7}" stroke-linecap="round"/>
    <path d="${d}" stroke="${P.lace}" stroke-width="${w}" stroke-linecap="round"/>`;
}

// Stack-aware geometry shared by the running lines (heel left, toe right, ground at 108).
function frame(S) {
  const off = (x) => 0.55 * S * (1 - 0.65 * x / 240);
  const o = (x, y) => `${x} ${f1(y - off(x))}`;
  const seam = `C${o(190, 81.5)} ${o(120, 79.5)} ${o(60, 76.5)}C${o(40, 76)} ${o(24, 75.5)} ${o(10, 76)}`;
  const seamPath = `M${o(233, 82)}${seam}`;
  // Foam: toe spring at the front, a bevelled heel at the back.
  const mid = `M${o(10, 76)}C${o(7, 83)} 8 93 15 98C18 102 24 104 32 104L176 104C202 103 222 96 236 86C238.5 84.5 237 82.5 ${o(233, 82)}${seam}Z`;
  const outsole = 'M15 98C18 102 24 104 32 104L176 104C202 103 222 96 236 86L238.5 88.5C224 101 204 107.6 177 108L31 108C21 108 15.5 104.5 13.6 100Z';
  return { off, o, seam, seamPath, mid, outsole };
}

function soleDetails(id, s, P, F, wave) {
  const { mid, outsole, seamPath, off } = F;
  const y = (x, base, k) => f1(base - off(x) * k);
  const sculpt = wave
    ? `M18 ${y(18, 92, 0.4)}C40 ${y(40, 84, 0.4)} 58 ${y(58, 98, 0.4)} 82 ${y(82, 92, 0.4)}S118 ${y(118, 84, 0.4)} 142 ${y(142, 92, 0.4)}S186 ${y(186, 92, 0.4)} 222 ${y(222, 84, 0.4)}`
    : `M20 ${y(20, 90, 0.5)}C70 ${y(70, 97, 0.5)} 160 ${y(160, 97, 0.5)} 224 ${y(224, 85, 0.5)}`;
  return `
    <clipPath id="${id}cm"><path d="${mid}"/></clipPath>
    ${panel(mid, P.mid, P.midLine)}
    <g clip-path="url(#${id}cm)">
      <path d="${mid}" fill="url(#${id}m)"/>
      ${P.pearl ? `<path d="${mid}" fill="url(#${id}p)"/>` : ''}
      <path d="${sculpt}" fill="none" stroke="${P.midLine}" stroke-width="1.1" stroke-linecap="round"/>
      <path d="${sculpt}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8" transform="translate(0 1.1)" stroke-linecap="round"/>
      ${s.type === 'runner' ? `<path d="M30 ${y(30, 80, 0.6)}C90 ${y(90, 86, 0.6)} 170 ${y(170, 86, 0.6)} 228 ${y(228, 78, 0.6)}" fill="none" stroke="${P.plate}" stroke-width="2.4" stroke-linecap="round"/>` : ''}
      <path d="${seamPath}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.2"/>
      <rect x="22" y="${y(22, 97, 0.3)}" width="14" height="1.6" rx=".8" fill="${P.midLine}" opacity=".7"/>
    </g>
    ${panel(outsole, P.outsole, mixHex(P.outsole, '#000000', 0.4))}
    ${s.type === 'trainer' ? `<g fill="${P.outsole}">${Array.from({ length: 12 }, (_, i) => `<rect x="${28 + i * 16}" y="${f1(106.6 - (i > 9 ? (i - 9) * 1.6 : 0))}" width="8" height="3" rx="1"/>`).join('')}</g>` : ''}
    <path d="M32 104L176 104C202 103 222 96 236 86" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width=".7" transform="translate(0 1.2)"/>`;
}

// ---------------------------------------------------------------- Stride
// Everyday runner: engineered mesh, heel counter, toe mudguard, eyestay, lace
// cage straps, padded collar and pull tab. The bolt sits on the quarter panel.
function drawStride(id, s, P, wave = false, minStack = 0) {
  const S = Math.max(minStack, STACK[s.type] ?? 4);
  const F = frame(S);
  const { o, seam, seamPath } = F;
  const upper = `M${o(10, 76)}C${o(5, 60)} ${o(8, 42)} ${o(16, 32)}C${o(20, 27.5)} ${o(28, 25.5)} ${o(34, 28.5)}C${o(44, 34.5)} ${o(56, 40.5)} ${o(68, 39.5)}C${o(80, 38.5)} ${o(90, 28)} ${o(98, 20.5)}C${o(102, 16)} ${o(110, 16)} ${o(113, 20.5)}C${o(128, 36)} ${o(160, 50)} ${o(196, 60)}C${o(222, 67)} ${o(238, 74)} ${o(233, 82)}${seam}Z`;
  const collar = `M${o(14, 35)}C${o(19, 28.5)} ${o(28, 26)} ${o(34, 29)}C${o(44, 35)} ${o(56, 41)} ${o(68, 40)}C${o(80, 39)} ${o(90, 28.5)} ${o(97, 21.5)}`;
  const heel = `M${o(2, 82)}L${o(2, 33)}C${o(20, 34)} ${o(34, 40)} ${o(43, 50)}C${o(49, 57)} ${o(51, 66)} ${o(49, 82)}Z`;
  const mudguard = `M${o(150, 90)}C${o(168, 74)} ${o(200, 69)} ${o(242, 74)}L${o(244, 94)}L${o(150, 94)}Z`;
  const eyestay = `M${o(101, 22.5)}C${o(124, 39)} ${o(156, 51)} ${o(192, 61)}`;
  const laceList = Array.from({ length: 5 }, (_, i) => { const x = 116 + i * 14, y = 28 + i * 6.3; return [...xy(o, x, y), ...xy(o, x - 11, y + 7.5)]; });
  const [tx, ty] = xy(o, 9, 52);
  return `
    ${groundShadow(id)}
    ${P.glow ? `<path d="${F.mid}" fill="${P.accent}" filter="url(#${id}g)" opacity=".75"/>` : ''}
    <clipPath id="${id}cu"><path d="${upper}"/></clipPath>
    ${panel(`M${o(14, 33)}C${o(10, 22)} ${o(14, 15)} ${o(22, 16.5)}L${o(26, 23)}C${o(21, 21.5)} ${o(19, 26)} ${o(20, 32)}Z`, P.overlay, P.overLine)}
    ${panel(`M${o(93, 25)}C${o(96, 14)} ${o(103, 10.5)} ${o(111, 12.5)}C${o(116, 14)} ${o(117, 19)} ${o(115, 24)}Z`, P.tongue, mixHex(P.tongue, '#000000', 0.3))}
    <path d="${upper}" fill="url(#${id}u)"/>
    <g clip-path="url(#${id}cu)">
      <path d="${upper}" fill="url(#${id}k)"/>
      ${panel(mudguard, P.overlay, P.overLine)}
      ${stitch(`M${o(154, 87)}C${o(171, 72.5)} ${o(200, 67.5)} ${o(240, 72.5)}`, P.overStitch)}
      ${panel(heel, P.overlay, P.overLine)}
      ${stitch(`M${o(6, 35.5)}C${o(22, 37)} ${o(33, 43)} ${o(40, 51)}C${o(45, 58)} ${o(47, 66)} ${o(46, 76)}`, P.overStitch)}
      <path d="${eyestay}" fill="none" stroke="${P.overlay}" stroke-width="11" stroke-linecap="round"/>
      <path d="${eyestay}" fill="none" stroke="${P.overLine}" stroke-width=".6" transform="translate(0 5.4)"/>
      ${stitch(eyestay, P.overStitch, 'transform="translate(0 3.6)"')}
      <path d="${collar}" fill="none" stroke="${P.collar}" stroke-width="7.5" stroke-linecap="round"/>
      <path d="${collar}" fill="none" stroke="${P.lining}" stroke-width="2.2" transform="translate(0 -2.6)" stroke-linecap="round"/>
      <path d="${collar}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="3" transform="translate(0 4.2)" filter="url(#${id}b1)"/>
      <rect x="${tx}" y="${ty}" width="2.4" height="9" rx="1" fill="${P.accent}" opacity=".85"/>
      <path d="${seamPath}" fill="none" stroke="#000" stroke-opacity=".26" stroke-width="5" filter="url(#${id}b3)"/>
      <path d="${upper}" fill="url(#${id}sh)"/>
    </g>
    <path d="${upper}" fill="none" stroke="${P.line}" stroke-width=".6" stroke-linejoin="round"/>
    ${panel(boltAt(o, 64, 48, 0.78), P.mark, mixHex(P.mark, '#000000', 0.25))}
    ${laces(P, laceList)}
    <circle cx="${f1(laceList[4][0] + 3)}" cy="${f1(laceList[4][1] + 2.5)}" r="1.1" fill="${P.accent}"/>
    ${soleDetails(id, s, P, F, wave)}`;
}

// ---------------------------------------------------------------- Pod
// Max-cushion rocker: the same construction on a tall foam with a sculpted wave
// sidewall (closed foam, no hollow pods).
const drawPod = (id, s, P) => drawStride(id, s, P, true, 8);

// ---------------------------------------------------------------- Knit
// Sock-knit lifestyle runner: one-piece knit upper, ribbed ankle collar, rope
// laces, heel loop, a slim wave sole.
function drawKnit(id, s, P) {
  const F = frame(2);
  const { o, seam, seamPath } = F;
  const upper = `M${o(10, 76)}C${o(5, 56)} ${o(9, 35)} ${o(18, 25)}C${o(25, 18)} ${o(35, 18)} ${o(43, 23)}C${o(54, 29)} ${o(66, 30)} ${o(78, 27)}C${o(88, 24.5)} ${o(94, 18)} ${o(102, 15.5)}C${o(108, 14)} ${o(113, 16)} ${o(117, 21)}C${o(130, 36)} ${o(162, 49)} ${o(198, 59)}C${o(224, 66.5)} ${o(239, 74)} ${o(233, 82)}${seam}Z`;
  const ribs = [0, 1, 2, 3].map((i) => `M${o(14 + i * 1.5, 30 + i * 3.4)}C${o(28, 22.5 + i * 3.4)} ${o(44, 28 + i * 3.2)} ${o(60, 32.5 + i * 2.8)}C${o(78, 34.5 + i * 2.4)} ${o(92, 24 + i * 2.6)} ${o(104, 18.5 + i * 2.6)}`).join('');
  const laceList = Array.from({ length: 6 }, (_, i) => { const x = 122 + i * 12.5, y = 33 + i * 5.7; return [...xy(o, x, y), ...xy(o, x - 10, y + 6.5)]; });
  return `
    ${groundShadow(id)}
    ${P.glow ? `<path d="${F.mid}" fill="${P.accent}" filter="url(#${id}g)" opacity=".75"/>` : ''}
    <path d="M${o(20, 27)}C${o(11, 15)} ${o(18, 4)} ${o(31, 10)}" fill="none" stroke="${P.overlay}" stroke-width="4.6" stroke-linecap="round"/>
    <clipPath id="${id}cu"><path d="${upper}"/></clipPath>
    <path d="${upper}" fill="url(#${id}u)"/>
    <g clip-path="url(#${id}cu)">
      <path d="${upper}" fill="url(#${id}k)"/>
      <path d="${ribs}" fill="none" stroke="${P.line}" stroke-opacity=".55" stroke-width="1"/>
      <path d="M${o(20, 24)}C${o(27, 17)} ${o(36, 16.5)} ${o(44, 22)}C${o(55, 29)} ${o(66, 29.5)} ${o(78, 26.5)}C${o(88, 24)} ${o(94, 17.5)} ${o(103, 15)}" fill="none" stroke="${P.lining}" stroke-width="2.4"/>
      <path d="M${o(10, 71)}C${o(40, 67)} ${o(110, 67)} ${o(233, 75)}L${o(240, 92)}L${o(4, 92)}Z" fill="${P.overlay}" opacity=".22"/>
      <path d="${seamPath}" fill="none" stroke="#000" stroke-opacity=".24" stroke-width="5" filter="url(#${id}b3)"/>
      <path d="${upper}" fill="url(#${id}sh)"/>
    </g>
    <path d="${upper}" fill="none" stroke="${P.line}" stroke-width=".6" stroke-linejoin="round"/>
    ${panel(boltAt(o, 26, 50, 0.5), P.mark, mixHex(P.mark, '#000000', 0.25))}
    ${laces(P, laceList, 2.8)}
    ${soleDetails(id, s, P, F, true)}`;
}

// ---------------------------------------------------------------- Court
// High-top court classic: padded ankle collar, colour-blocked leather panels,
// perforated toe, stitched cupsole and the RUNNER badge on the collar.
function drawCourt(id, s, P) {
  const white = s.midTone === 0 || luminance(P.upper) < 0.12;
  const base = white ? '#f3f2ec' : P.upper;
  const block = white ? P.upper : P.overlay;
  const blockLine = mixHex(block, '#000000', 0.3);
  const toe = s.edition === 'neon' ? P.overlay : '#f6f5f0';
  const cupFill = s.edition === 'neon' ? P.mid : s.edition === 'gold' ? '#fff6dc' : s.midTone === 1 ? '#efe7d4' : '#faf9f5';
  const upper = 'M14 78L13 34C13 18 20 7 32 5C44 3 58 5 67 9L72 13C82 16 92 19 100 23C118 34 150 46 188 56C214 62 232 68 232 78C180 81 120 80 60 79C40 78 24 78 14 78Z';
  const seam = 'M232 78C180 81 120 80 60 79C40 78 24 78 14 78';
  const cup = 'M10 77L232 79C238 79 240 83 239 88C238 95 232 98 222 98L22 98C14 98 10 94 10 88Z';
  const laceList = Array.from({ length: 6 }, (_, i) => { const x = 108 + i * 13, y = 28 + i * 5.6; return [x, y, x - 12, y + 8]; });
  const perfs = [[196, 66], [204, 68], [212, 70], [200, 72], [208, 74], [216, 74], [220, 70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1"/>`).join('');
  const bolt = (x0, y0, k) => BOLT.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x0 + x * k)} ${f1(y0 + y * k)}`).join('') + 'Z';
  return `
    ${groundShadow(id, 103.5)}
    ${P.glow ? `<path d="${cup}" fill="${P.accent}" filter="url(#${id}g)" opacity=".75"/>` : ''}
    ${panel('M86 26C90 10 102 2 113 5C117 6 119 10 118 16L114 30Z', toe, '#cfcdc4')}
    <rect x="100" y="8" width="9" height="6" rx="1.5" fill="${block}"/>
    <clipPath id="${id}cu"><path d="${upper}"/></clipPath><clipPath id="${id}cm"><path d="${cup}"/></clipPath>
    <path d="${upper}" fill="${base}"/>
    <g clip-path="url(#${id}cu)">
      ${panel('M168 51C198 58 226 64 232 76L232 80C214 80 196 80 172 80C169 70 168 61 168 51Z', toe, '#cfcdc4')}
      <g fill="#000" opacity=".26">${perfs}</g>
      ${panel('M14 78L13 36C26 41 38 46 46 54C43 62 43 71 47 79Z', block, blockLine)}
      ${panel('M0 40L0 0L70 0L71 22C56 17 36 19 22 33Z', block, blockLine)}
      ${panel('M100 23C118 34 150 46 188 56L184 64C150 55 118 44 96 33Z', block, blockLine)}
      ${panel('M60 79C66 70 78 63 96 60C120 57 146 60 170 66L172 80C140 80 100 80 60 79Z', block, blockLine)}
      ${stitch('M22 33C36 19 56 17 71 22M47 79C43 71 43 62 46 54M96 33C118 44 150 55 184 64M60 79C66 70 78 63 96 60C120 57 146 60 170 66', luminance(block) < 0.45 ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.3)')}
      <path d="M13 34C13 18 20 7 32 5C44 3 58 5 67 9" fill="none" stroke="${P.lining}" stroke-width="2.4" transform="translate(0 2)"/>
      <path d="${seam}" fill="none" stroke="#000" stroke-opacity=".24" stroke-width="5" filter="url(#${id}b3)"/>
      <path d="${upper}" fill="url(#${id}sh)"/>
    </g>
    <path d="${upper}" fill="none" stroke="${mixHex(base, '#000000', 0.3)}" stroke-width=".6"/>
    <path d="M13 34C13 18 20 7 32 5C44 3 58 5 67 9" fill="none" stroke="${block}" stroke-width="5" stroke-linecap="round"/>
    ${panel(bolt(124, 52, 1.05), white ? P.overlay : P.mark, white ? P.overLine : mixHex(P.mark, '#000000', 0.25))}
    <circle cx="36" cy="21" r="6.6" fill="${block}" stroke="${toe}" stroke-width="1.6"/>
    <path d="${bolt(30.5, 18, 0.22)}" fill="${toe}"/>
    ${laces({ ...P, lace: P.lace === '#f5f4ef' ? '#f5f4ef' : block, overLine: blockLine }, laceList)}
    ${panel(cup, cupFill, '#d6d4cb')}
    <g clip-path="url(#${id}cm)">
      <path d="${cup}" fill="url(#${id}m)"/>
      ${P.pearl ? `<path d="${cup}" fill="url(#${id}p)"/>` : ''}
      <path d="M16 85L233 86.5" stroke="#000" stroke-opacity=".28" stroke-width=".8" stroke-dasharray="2 1.6"/>
      <path d="M8 93L240 93L240 104L8 104Z" fill="${s.edition && s.edition !== 'standard' ? P.outsole : block}"/>
      <path d="${seam}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2"/>
    </g>`;
}

const DRAW = { stride: drawStride, pod: drawPod, knit: drawKnit, court: drawCourt };
const DEFAULT_PATTERN = { stride: 'mesh', pod: 'mesh', knit: 'knit', court: 'plain' };

/** SVG markup for a sneaker (owned, listed, or a collection preview). */
export function sneakerSvg(s, cls = 'sneaker-art') {
  const id = `sn${++seq}`;
  const model = DRAW[s.model] ? s.model : 'stride';
  const P = palette(s);
  const pattern = model === 'court' ? 'plain' : s.pattern || DEFAULT_PATTERN[model];
  return `<svg class="${cls} rarity-${s.rarity || 'common'} model-${model} ed-${s.edition || 'standard'}" viewBox="0 0 244 120" aria-hidden="true">
    ${defs(id, P, pattern)}
    ${DRAW[model](id, s, P)}
    ${sparkles(P)}
  </svg>`;
}
