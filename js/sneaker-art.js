// Original RUNNER sneaker illustrations — four running lines (Stride, Pod, Knit, Trail)
// inspired by popular shoe *styles* but drawn from scratch with our own
// details and the RUNNER bolt mark. No real brand's logos, stripes, text or
// signature parts are used (e.g. no hollow tube or cloud-pod soles, no side
// stripes, no swoosh or wings).
//
// Drawn like a studio product photo of a real running shoe: real proportions
// (flared heel tab, deep collar dip, toe spring), engineered knit whose speckle
// fades from the collar, a padded collar, soft top-left light, smooth bevelled
// foam with the RUNNER speed cut, and a curated, named colourway.
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
      return `<pattern id="${id}k" width="2.4" height="2" patternUnits="userSpaceOnUse"><path d="M0 1Q.6 0 1.2 1T2.4 1" fill="none" stroke="${lo}" stroke-opacity="${dark ? 0.14 : 0.09}" stroke-width=".45"/></pattern>`;
    case 'speckle':
      return `<pattern id="${id}k" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="2" r=".4" fill="${lo}" opacity=".22"/><circle cx="4.6" cy="1" r=".3" fill="${lo}" opacity=".16"/><circle cx="3.6" cy="4.6" r=".45" fill="${lo}" opacity=".15"/><circle cx="5.6" cy="3.6" r=".28" fill="${lo}" opacity=".2"/></pattern>`;
    case 'plain':
      return `<pattern id="${id}k" width="4" height="4" patternUnits="userSpaceOnUse"/>`;
    default: // engineered mesh
      return `<pattern id="${id}k" width="2" height="1.8" patternUnits="userSpaceOnUse"><ellipse cx=".6" cy=".55" rx=".32" ry=".24" fill="${lo}" opacity="${dark ? 0.16 : 0.1}"/><ellipse cx="1.6" cy="1.45" rx=".32" ry=".24" fill="${lo}" opacity="${dark ? 0.16 : 0.1}"/></pattern>`;
  }
}

function defs(id, P, pattern) {
  return `<defs>
    <linearGradient id="${id}u" x1="1" y1="0" x2="0" y2="0"><stop offset=".1" stop-color="${P.knitFade ? P.fade : P.upper}"/><stop offset=".55" stop-color="${P.upper}"/></linearGradient>
    <linearGradient id="${id}sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
    <linearGradient id="${id}toe" gradientUnits="userSpaceOnUse" x1="196" y1="0" x2="242" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
    <linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".22" stop-color="#fff" stop-opacity="0"/><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
    <linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd9f1" stop-opacity="0"/><stop offset=".3" stop-color="#ffd9f1" stop-opacity=".5"/><stop offset=".55" stop-color="#c9f2ff" stop-opacity=".5"/><stop offset=".8" stop-color="#fff3c4" stop-opacity=".45"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}kg" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="78"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="${id}km" maskUnits="userSpaceOnUse" x="0" y="0" width="244" height="120"><rect width="244" height="120" fill="url(#${id}kg)"/></mask>
    <pattern id="${id}dot" width="1.7" height="1.5" patternUnits="userSpaceOnUse"><circle cx=".45" cy=".4" r=".38" fill="${P.collar}"/><circle cx="1.3" cy="1.15" r=".3" fill="${P.collar}"/></pattern>
    ${material(id, pattern, P)}
    <filter id="${id}b1" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="1"/></filter>
    <filter id="${id}b2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter>
    <filter id="${id}b3" x="-30%" y="-300%" width="160%" height="700%"><feGaussianBlur stdDeviation="2.6"/></filter>
    <filter id="${id}g" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>`;
}

const sparkles = (P) => (P.sparkle ? [[26, 6, 1], [216, 26, 0.8], [196, 6, 0.6]].map(([x, y, k]) =>
  `<path class="sparkle" transform="translate(${x} ${y}) scale(${k})" d="${SPARKLE}"/>`).join('') : '');

/** Soft studio shadow under the shoe. */
const groundShadow = (id, y = 110.5) => `
    <ellipse cx="124" cy="${y}" rx="110" ry="4.2" fill="#000" opacity=".14" filter="url(#${id}b3)"/>
    <ellipse cx="122" cy="${y - 0.8}" rx="98" ry="1.5" fill="#000" opacity=".3" filter="url(#${id}b1)"/>`;

const pts = (o, list) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${o(x, y)}`).join('') + 'Z';
const boltAt = (o, x0, y0, k) => pts(o, BOLT.map(([x, y]) => [x0 + x * k, y0 + y * k]));
const xy = (o, x, y) => o(x, y).split(' ').map(Number);
/** Tiny printed type (heel labels, foam emboss): short bars that read as lettering at this size. */
const microText = (x, y, n, colour, op = 0.6, h = 0.9) => {
  let cx = x, out = '';
  for (let i = 0; i < n; i++) { const w = [1.4, 0.9, 1.7, 1.1, 0.7, 1.5][i % 6]; out += `<rect x="${f1(cx)}" y="${f1(y)}" width="${w}" height="${h}" rx=".2"/>`; cx += w + (i % 5 === 4 ? 1.6 : 0.5); }
  return `<g fill="${colour}" opacity="${op}">${out}</g>`;
};

// Shoe geometry: heel left, toe right, ground at y = 110. Proportions follow a real
// running shoe photographed side-on: height about 0.42 of length, a flared heel tab, a deep
// collar dip, a raised tongue and toe spring. `S` raises the foam (more at the heel).
function frame(S) {
  const off = (x) => S * (1 - 0.55 * x / 240);
  const o = (x, y) => `${x} ${f1(y - off(x))}`;
  const seam = `C${o(190, 88)} ${o(120, 85)} ${o(60, 82)}C${o(40, 81)} ${o(24, 80)} ${o(12, 80)}`;
  const seamPath = `M${o(232, 89)}${seam}`;
  const seamY = (x) => 80 + Math.max(0, x - 12) * (8.5 / 220) - off(x);
  const mid = `M${o(12, 80)}C${o(5, 86)} 6 100 14 104C17 106.6 22 107 30 107L180 107C205 106.6 224 101 237 91C240 89 238.5 87.5 ${o(232, 89)}${seam}Z`;
  const outsole = 'M14 104C17 106.6 22 107 30 107L180 107C205 106.6 224 101 237 91L239.2 93.6C226 104.6 205 110 180 110L30 110C20 110 14.4 107.6 12.8 105Z';
  return { off, o, seam, seamPath, seamY, mid, outsole };
}

/** Foam: smooth, slightly bulging, bevelled top edge, a concave sweep, the RUNNER speed cut. */
function foam(id, s, P, F, opts = {}) {
  const { mid, outsole, seamPath, seamY } = F;
  const cutY = (x) => (seamY(x) + 107) / 2 + 0.8;
  const x0 = 34, x1 = opts.longCut ? 196 : 150;
  const top = [], bot = [];
  for (let x = x0; x <= x1; x += 4) {
    const t = (x - x0) / (x1 - x0), w = 1.9 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.2;
    top.push(`${x} ${f1(cutY(x) - w)}`); bot.unshift(`${x} ${f1(cutY(x) + w * 0.8)}`);
  }
  const cut = `M${top.join('L')}L${bot.join('L')}Z`;
  const groove = luminance(P.accent) > 0.85 || P.accent === P.mid ? mixHex(P.mid, '#000000', 0.45) : P.accent; // the speed cut shows the accent colour
  const sweep = `M16 ${f1(cutY(16) + 7)}C60 ${f1(cutY(60) + 9)} 150 ${f1(cutY(150) + 9)} 226 ${f1(cutY(226) + 2)}`;
  return `
    <clipPath id="${id}cm"><path d="${mid}"/></clipPath>
    <path d="${mid}" fill="${P.mid}"/>
    <g clip-path="url(#${id}cm)">
      ${P.pearl ? `<path d="${mid}" fill="url(#${id}p)"/>` : ''}
      <path d="${sweep}" fill="none" stroke="#000" stroke-opacity=".07" stroke-width="7" filter="url(#${id}b2)"/>
      <path d="${mid}" fill="url(#${id}m)"/>
      ${s.type === 'runner' ? `<path d="M30 ${f1(cutY(30) - 5)}C90 ${f1(cutY(90) - 3.5)} 170 ${f1(cutY(170) - 3.5)} 230 ${f1(cutY(230) - 5.5)}" fill="none" stroke="${P.plate}" stroke-width="1.8" stroke-linecap="round" opacity=".9"/>` : ''}
      <path d="${cut}" fill="${groove}"/>
      <path d="M${top.join('L')}" fill="none" stroke="#000" stroke-opacity=".25" stroke-width=".8"/>
      <path d="M${bot.slice().reverse().join('L')}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".7"/>
      <path d="${seamPath}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.1"/>
      <path d="${seamPath}" fill="none" stroke="#000" stroke-opacity=".14" stroke-width="2.4" transform="translate(0 2.2)" filter="url(#${id}b1)"/>
      ${microText(40, seamY(40) + 4.2, 9, mixHex(P.mid, '#000000', 0.25), 0.45, 0.8)}
    </g>
    <path d="${outsole}" fill="${P.sole2 || P.outsole}"/>
    <path d="M30 107L180 107C205 106.6 224 101 237 91" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width=".7" transform="translate(0 1.1)"/>`;
}

/** The tongue showing above the eyestay along the throat, so the laces cross over it. */
function throatBand(o, edge, x0, x1) {
  const up = [], dn = [];
  for (let x = x0; x <= x1; x += 4) { up.push(o(x, edge(x) - 3.4)); dn.unshift(o(x, edge(x) + 3)); }
  return `M${up.join('L')}L${dn.join('L')}Z`;
}

/** Laces crossing over the top of the eyestay, with eyelets and a lace-lock tag. */
function laceRow(id, P, o, edge, xs, opts = {}) {
  const lace = P.lace, laceShade = mixHex(P.lace, '#000000', 0.38);
  const segs = xs.map((x) => { const [ax, ay] = xy(o, x, edge(x) + 4.2); const [bx, by] = xy(o, x + 8, edge(x + 8) - 1.4); return [ax, ay, bx, by]; });
  const d = segs.map(([a, b, c, e]) => `M${f1(a)} ${f1(b)}L${f1(c)} ${f1(e)}`).join('');
  const eyes = segs.map(([a, b]) => `<circle cx="${f1(a)}" cy="${f1(b)}" r="1.45" fill="${mixHex(P.collar, '#000000', 0.25)}"/><circle cx="${f1(a)}" cy="${f1(b)}" r=".75" fill="#000" opacity=".55"/>`).join('');
  const [lx, ly] = segs[segs.length - 1];
  return `${eyes}
    <path d="${d}" stroke="#000" stroke-opacity=".3" stroke-width="2.9" stroke-linecap="round" transform="translate(.5 .8)" filter="url(#${id}b1)"/>
    <path d="${d}" stroke="${laceShade}" stroke-width="2.7" stroke-linecap="round"/>
    <path d="${d}" stroke="${lace}" stroke-width="2" stroke-linecap="round"/>
    ${opts.noTag ? '' : `<rect x="${f1(lx + 2.2)}" y="${f1(ly + 0.6)}" width="2.4" height="4.4" rx="1" fill="${P.accent}" transform="rotate(28 ${f1(lx + 3.4)} ${f1(ly + 2.8)})"/>`}`;
}

// ---------------------------------------------------------------- the running lines
// One shared last (the foot shape); each line changes the foam, panels and finish.
function drawRunner(id, s, P, opt) {
  const S = Math.max(opt.minStack || 0, STACK[s.type] ?? 4) + (opt.extra || 0);
  const F = frame(S);
  const { o, seam, seamPath } = F;
  const upper = `M${o(12, 80)}C${o(6, 62)} ${o(7, 40)} ${o(13, 29)}C${o(16, 22)} ${o(22, 18)} ${o(30, 18.5)}C${o(39, 19.5)} ${o(46, 30)} ${o(55, 35)}C${o(64, 40)} ${o(73, 35)} ${o(79, 26)}C${o(81, 20)} ${o(84, 13.5)} ${o(90, 11.5)}C${o(96, 9.5)} ${o(102, 11.5)} ${o(104, 17)}C${o(116, 32)} ${o(140, 46)} ${o(170, 57)}C${o(196, 66)} ${o(222, 72)} ${o(236, 79)}C${o(240, 83)} ${o(238.5, 88)} ${o(232, 89)}${seam}Z`;
  const edge = (x) => (x < 104 ? 17 : x < 170 ? 17 + (x - 104) * (40 / 66) : 57 + (x - 170) * 0.3);
  const collar = `M${o(12, 33)}C${o(16, 24)} ${o(22, 19.5)} ${o(30, 20)}C${o(39, 21)} ${o(46, 31.5)} ${o(55, 36.5)}C${o(64, 41.5)} ${o(73, 36.5)} ${o(80, 27)}`;
  const eyestay = `M${o(90, 15.5)}C${o(113, 31)} ${o(139, 45.5)} ${o(171, 58.5)}`;
  const heelPanel = `M${o(0, 50)}L${o(28, 55)}C${o(32, 66)} ${o(36, 77)} ${o(41, 92)}L${o(0, 92)}Z`;
  const tongue = `M${o(77, 30)}C${o(80, 21)} ${o(84, 13.5)} ${o(90, 11.5)}C${o(96, 9.5)} ${o(102, 11.5)} ${o(104, 17)}C${o(107, 22)} ${o(107, 28)} ${o(104, 33)}Z`;
  const throat = throatBand(o, edge, 100, 168);
  const [hx, hy] = xy(o, 4, 60);
  const rubber = mixHex(P.outsole, P.overlay, 0.25);
  const trail = opt.trail;
  return `
    ${groundShadow(id)}
    ${P.glow ? `<path d="${F.mid}" fill="${P.accent}" filter="url(#${id}g)" opacity=".7"/>` : ''}
    <path d="M${o(13, 31)}C${o(9, 21)} ${o(13, 13)} ${o(21, 14)}L${o(25, 20)}C${o(20, 19)} ${o(18, 24)} ${o(19, 30)}Z" fill="${P.overlay}"/>
    <path d="${throat}" fill="${P.tongue}"/>
    <path d="${throat}" fill="url(#${id}sh)"/>
    <clipPath id="${id}cu"><path d="${upper}"/></clipPath>
    <path d="${upper}" fill="url(#${id}u)"/>
    <g clip-path="url(#${id}cu)">
      <path d="${upper}" fill="url(#${id}k)"/>
      ${opt.speckle !== false ? `<rect width="244" height="120" fill="url(#${id}dot)" mask="url(#${id}km)" opacity=".75"/>` : ''}
      ${opt.toeCap ? `<path d="M${o(196, 94)}C${o(205, 77)} ${o(224, 72)} ${o(242, 79)}L${o(244, 96)}Z" fill="${P.overlay}" opacity=".75"/>` : ''}
      ${trail ? `<path d="M${o(174, 94)}C${o(189, 77)} ${o(216, 71.5)} ${o(244, 77)}L${o(246, 98)}Z" fill="${rubber}"/><path d="M${o(191, 83)}L${o(193, 91)}M${o(202, 80)}L${o(204, 89)}M${o(213, 78)}L${o(215, 87)}M${o(224, 77.5)}L${o(226, 86)}" stroke="#fff" stroke-opacity=".14" stroke-width="1.3" stroke-linecap="round"/><path d="M${o(0, 84)}C${o(10, 75)} ${o(32, 74.5)} ${o(48, 76)}C${o(56, 77)} ${o(61, 79.5)} ${o(64, 83)}L${o(64, 96)}L${o(0, 96)}Z" fill="${rubber}"/>` : ''}
      <path d="${heelPanel}" fill="${P.overlay}"/>
      <g transform="rotate(10 ${hx} ${hy})">${microText(hx + 3, hy, 8, P.mark, 0.75)}${microText(hx + 3, hy + 2.4, 5, P.mark, 0.45, 0.6)}</g>
      <path d="${eyestay}" fill="none" stroke="${P.collar}" stroke-width="12" stroke-linecap="round"/>
      <path d="${eyestay}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="1.6" transform="translate(0 6.4)" filter="url(#${id}b1)"/>
      <path d="${tongue}" fill="${P.tongue}"/>
      <path d="${collar}" fill="none" stroke="${P.collar}" stroke-width="10" stroke-linecap="round"/>
      <path d="${collar}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1" transform="translate(0 -1.6)"/>
      <path d="${collar}" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="2.4" transform="translate(0 5.4)" filter="url(#${id}b1)"/>
      <path d="M${o(112, 29)}C${o(136, 43)} ${o(168, 55)} ${o(210, 67)}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="3" filter="url(#${id}b1)"/>
      <path d="M${o(10, 44)}C${o(9, 56)} ${o(10, 66)} ${o(13, 74)}" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="1.6" filter="url(#${id}b1)"/>
      <path d="${upper}" fill="url(#${id}toe)"/>
      <path d="${seamPath}" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="4.5" filter="url(#${id}b3)"/>
      <path d="${upper}" fill="url(#${id}sh)"/>
    </g>
    <rect x="${f1(xy(o, 85, 15)[0])}" y="${f1(xy(o, 85, 15)[1])}" width="7" height="3.2" rx="1" fill="${P.overlay}" transform="rotate(-20 ${f1(xy(o, 88, 16)[0])} ${f1(xy(o, 88, 16)[1])})"/>
    <path d="${boltAt(o, 60, 53, 0.66)}" fill="#000" opacity=".22" transform="translate(.5 .7)" filter="url(#${id}b1)"/>
    <path d="${boltAt(o, 60, 53, 0.66)}" fill="${P.mark}"/>
    ${laceRow(id, P, o, edge, [101, 113, 125, 137, 149])}
    ${foam(id, s, P, F, opt)}
    ${trail ? trailLugs(P) : ''}`;
}

/** Deep multi-directional lugs under a trail outsole (they follow the toe spring). */
function trailLugs(P) {
  const lug = mixHex(P.outsole, '#000000', 0.15);
  const out = [];
  for (let x = 22; x <= 200; x += 13) {
    const yb = x < 180 ? 110 : 110 - (x - 180) * 0.4;
    const lean = x < 120 ? -1.2 : 1.2;
    out.push(`<path d="M${x} ${f1(yb - 0.5)}L${f1(x + 8)} ${f1(yb - 0.5)}L${f1(x + 7 + lean)} ${f1(yb + 3.2)}L${f1(x + 1 + lean)} ${f1(yb + 3.2)}Z"/>`);
  }
  return `<g fill="${lug}">${out.join('')}</g>`;
}

// Stride: everyday trainer — engineered mesh, tonal toe cap, medium foam.
const drawStride = (id, s, P) => drawRunner(id, s, P, { toeCap: true });
// Pod: max-cushion rocker — tall foam with a long speed cut (closed foam, no hollow pods).
const drawPod = (id, s, P) => drawRunner(id, s, P, { minStack: 10, extra: 4, longCut: true });
// Trail: rubber toe bumper and heel band, firmer foam, deep lugs.
const drawTrail = (id, s, P) => drawRunner(id, s, P, { minStack: 6, trail: true });

// Knit: sock-fit knit runner — one-piece knit, ribbed ankle collar, no separate tongue.
function drawKnit(id, s, P) {
  const F = frame(3);
  const { o, seam, seamPath } = F;
  const upper = `M${o(12, 80)}C${o(6, 60)} ${o(8, 38)} ${o(17, 27)}C${o(23, 21)} ${o(31, 20.5)} ${o(39, 24)}C${o(49, 30)} ${o(60, 32)} ${o(72, 29)}C${o(82, 26)} ${o(88, 19.5)} ${o(96, 17.5)}C${o(102, 16.5)} ${o(106, 18.5)} ${o(110, 23)}C${o(122, 36)} ${o(146, 48)} ${o(174, 58)}C${o(200, 66)} ${o(224, 72)} ${o(237, 79)}C${o(240.5, 84)} ${o(238.5, 88)} ${o(232, 89)}${seam}Z`;
  const edge = (x) => (x < 110 ? 23 : x < 174 ? 23 + (x - 110) * (35 / 64) : 58 + (x - 174) * 0.3);
  const ribs = [0, 1, 2, 3, 4].map((i) => `M${o(13 + i, 31 + i * 2.6)}C${o(22, 24 + i * 2.7)} ${o(32, 23.5 + i * 2.7)} ${o(40, 27 + i * 2.6)}C${o(50, 33 + i * 2.4)} ${o(60, 35 + i * 2.2)} ${o(72, 32 + i * 2.2)}C${o(82, 29 + i * 2.2)} ${o(88, 22.5 + i * 2.2)} ${o(96, 20.5 + i * 2.2)}`).join('');
  const throat = throatBand(o, edge, 106, 170);
  return `
    ${groundShadow(id)}
    ${P.glow ? `<path d="${F.mid}" fill="${P.accent}" filter="url(#${id}g)" opacity=".7"/>` : ''}
    <path d="M${o(19, 28)}C${o(11, 16)} ${o(18, 6)} ${o(30, 11)}" fill="none" stroke="${P.overlay}" stroke-width="4.4" stroke-linecap="round"/>
    <path d="${throat}" fill="${P.collar}"/>
    <clipPath id="${id}cu"><path d="${upper}"/></clipPath>
    <path d="${upper}" fill="url(#${id}u)"/>
    <g clip-path="url(#${id}cu)">
      <path d="${upper}" fill="url(#${id}k)"/>
      <rect width="244" height="120" fill="url(#${id}dot)" mask="url(#${id}km)" opacity=".6"/>
      <path d="${ribs}" fill="none" stroke="${P.collar}" stroke-width="1.5"/>
      <path d="${ribs}" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width=".6" transform="translate(0 -.8)"/>
      <path d="M${o(16, 28)}C${o(23, 21.5)} ${o(31, 21)} ${o(39, 24.5)}C${o(49, 30.5)} ${o(60, 32.5)} ${o(72, 29.5)}C${o(82, 26.5)} ${o(88, 20)} ${o(96, 18)}" fill="none" stroke="${P.lining}" stroke-width="2.2"/>
      <path d="M${o(118, 33)}C${o(142, 46)} ${o(172, 56)} ${o(212, 67)}" fill="none" stroke="#fff" stroke-opacity=".26" stroke-width="3" filter="url(#${id}b1)"/>
      <path d="${upper}" fill="url(#${id}toe)"/>
      <path d="${seamPath}" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="4.5" filter="url(#${id}b3)"/>
      <path d="${upper}" fill="url(#${id}sh)"/>
    </g>
    <path d="${boltAt(o, 24, 52, 0.46)}" fill="${P.mark}"/>
    ${laceRow(id, P, o, edge, [108, 120, 132, 144, 156], { noTag: true })}
    ${foam(id, s, P, F, {})}`;
}

const DRAW = { stride: drawStride, pod: drawPod, knit: drawKnit, trail: drawTrail };
const DEFAULT_PATTERN = { stride: 'mesh', pod: 'mesh', knit: 'knit', trail: 'speckle' };

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
