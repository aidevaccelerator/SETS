// Canvas painters. Each takes a sized canvas {g, w, h} and plain data; no engine state is mutated here.

export const C = {
  ink: '#0b1b3a', mute: '#6b7c99', line: '#d6e1f0', faint: '#f3f7fd', royal: '#2563eb',
  sky: '#38bdf8', light: '#93c5fd', pale: '#dbeafe', navy: '#0b2a6b', white: '#ffffff', grey: '#9fb0c9',
};
export const SPECIES = [
  { color: '#1e3a8a', cx: 0.50, cy: 0.28 },
  { color: '#2563eb', cx: 0.80, cy: 0.55 },
  { color: '#60a5fa', cx: 0.20, cy: 0.55 },
  { color: '#0891b2', cx: 0.52, cy: 0.80 },
];
export const STAGES = ['OBSERVE', 'HYPOTHESIZE', 'MUTATE', 'BACKTEST', 'SELECT', 'DEPLOY'];

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const ease = (x) => { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
export const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const money = (n) => {
  const a = Math.abs(n);
  return (n < 0 ? '−$' : '$') + (a < 1000 ? a.toFixed(2) : fmt(a));
};
export const hash = (k) => { let x = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };

// Keeps a canvas sharp at any size / DPR.
export function sized(el) {
  const o = { el, g: el.getContext('2d'), w: 1, h: 1 };
  const fit = () => {
    const r = el.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    o.w = Math.max(1, r.width); o.h = Math.max(1, r.height);
    el.width = Math.round(o.w * d); el.height = Math.round(o.h * d);
    o.g.setTransform(d, 0, 0, d, 0, 0);
  };
  fit();
  new ResizeObserver(fit).observe(el);
  return o;
}

const line = (g, pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); };

// ---------------- logo ----------------
const LOGO_PAL = { K: '#0b1b3a', W: '#f7faff', L: '#dbe6f6', M: '#a9bedd', D: '#6f8bb8', S: '#0b2a6b', s: '#08204f', B: '#3b82f6', C: '#7dd3fc', H: '#e0f2fe' };
const LOGO = [
  '........................', '...KKKKKKKKKKKKKKKKKK...', '..KWWWWWWWWWWWWWWWWWLK..', '..KWKKKKKKKKKKKKKKKWLMK.',
  '..KWKSSSSSSSSSSSSSKWLMK.', '..KWKSssssssssssSSKWLMK.', '..KWKSssssssssssSSKWLMK.', '..KWKSssssssssssSSKWLMK.',
  '..KWKSssssssssssSSKWLMK.', '..KWKSssssssssssSSKWLMK.', '..KWKSssssssssssSSKWLMK.', '..KWKSSSSSSSSSSSSSKWLMK.',
  '..KWKKKKKKKKKKKKKKKWLMK.', '..KWWWWWWWWWWWWWWWWWLMK.', '..KWBWCWWWWWWLLLLWWWLMK.', '..KLLLLLLLLLLLLLLLLLLDK.',
  '...KKKKKKKMMMMMKKKKKKK..', '.........KDMMMDK........', '...KKKKKKKKKKKKKKKKKKK..', '...KWWWWWWWWWWWWWWWWWK..',
  '...KWLWLWLWLWLWLWLWLWK..', '...KLLLLLLLLLLLLLLLLLK..', '....KKKKKKKKKKKKKKKKK...', '........................',
];
export function drawLogo(cv, t) {
  const { g, w, h } = cv;
  g.clearRect(0, 0, w, h);
  const gr = g.createRadialGradient(w * 0.44, h * 0.34, 2, w * 0.44, h * 0.34, w * 0.5);
  gr.addColorStop(0, 'rgba(56,189,248,0.28)'); gr.addColorStop(1, 'rgba(56,189,248,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const d = window.devicePixelRatio || 1, s = Math.max(1, Math.floor((w / 24) * d)) / d;
  const grid = LOGO.map((r) => r.split(''));
  const put = (x, y, c) => { grid[y][x] = c; };
  put(6, 5, 'C'); put(7, 6, 'C'); put(6, 7, 'C');
  if (Math.floor(t * 2) % 2 === 0) put(9, 7, 'H');
  const base = [1, 1, 2, 3, 4, 6];
  for (let i = 0; i < 6; i++) {
    const hh = clamp(base[i] + (Math.sin(t * 2.4 - i * 0.9) > 0.55 ? 1 : 0), 1, 6);
    for (let j = 0; j < hh; j++) put(11 + i, 10 - j, j === hh - 1 ? 'C' : 'B');
  }
  if (Math.floor(t * 1.5) % 2 === 1) put(4, 14, 'C');
  const x0 = (w - 24 * s) / 2, y0 = (h - 24 * s) / 2;
  grid.forEach((row, j) => row.forEach((c, i) => { if (c !== '.') { g.fillStyle = LOGO_PAL[c]; g.fillRect(x0 + i * s, y0 + j * s, s, s); } }));
}

// ---------------- header sparkline ----------------
export function drawSpark(cv, values, max) {
  const { g, w, h } = cv;
  g.clearRect(0, 0, w, h);
  const N = 32, bw = w / N, vals = values.slice(-N);
  vals.forEach((v, j) => {
    const x = (N - vals.length + j) * bw, bh = Math.max(1, (v / max) * (h - 2));
    g.fillStyle = j >= vals.length - 2 ? C.royal : hexA(C.royal, 0.25 + 0.45 * (j / vals.length));
    g.fillRect(x + 0.5, h - bh, bw - 1.2, bh);
  });
}

// ---------------- evolution ring ----------------
export function drawRing(cv, { stage, sp, pos, gen, cycle, flash }) {
  const { g, w, h } = cv;
  g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2 + 4, r = Math.max(30, Math.min(h / 2 - 26, 82));
  const A = (k) => -Math.PI / 2 + k * (Math.PI / 3);
  g.lineWidth = 2; g.strokeStyle = C.line; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.setLineDash([2, 4]); g.lineWidth = 1; g.strokeStyle = '#c9d7ec'; g.beginPath(); g.arc(cx, cy, r - 16, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  const ang = -Math.PI / 2 + pos * Math.PI * 2;
  g.lineWidth = 3; g.strokeStyle = hexA(C.royal, 0.35); g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, ang); g.stroke();
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const a1 = ang - i * 0.035;
    g.strokeStyle = hexA(C.royal, (1 - i / 26) * 0.95); g.lineWidth = 4.5 - i * 0.1;
    g.beginPath(); g.arc(cx, cy, r, a1 - 0.04, a1); g.stroke();
  }
  g.lineCap = 'butt';
  const hx = cx + Math.cos(ang) * r, hy = cy + Math.sin(ang) * r;
  const hg = g.createRadialGradient(hx, hy, 0, hx, hy, 14); hg.addColorStop(0, 'rgba(56,189,248,0.8)'); hg.addColorStop(1, 'rgba(56,189,248,0)');
  g.fillStyle = hg; g.beginPath(); g.arc(hx, hy, 14, 0, Math.PI * 2); g.fill();
  for (let k = 0; k < 6; k++) {
    const a = A(k), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, act = k === stage, done = k < stage;
    if (act) { const pr = 13 + 7 * (0.5 + 0.5 * Math.sin(sp * Math.PI * 2)); g.fillStyle = hexA(C.royal, 0.14); g.beginPath(); g.arc(x, y, pr + 4, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.arc(x, y, act ? 12 : 9.5, 0, Math.PI * 2);
    g.fillStyle = act ? C.royal : done ? C.navy : C.white; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = act || done ? C.navy : '#b8c8e0'; g.stroke();
    g.fillStyle = act || done ? C.white : C.mute; g.font = '700 9px "JetBrains Mono"'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(k + 1), x, y + 0.5);
    const lr = r + 18, c = Math.cos(a), vertical = Math.abs(c) < 0.2;
    const lx = cx + c * lr, ly = cy + Math.sin(a) * lr + (vertical ? (Math.sin(a) < 0 ? 6 : -6) : 0);
    g.textAlign = vertical ? 'center' : c > 0 ? 'left' : 'right';
    g.textBaseline = vertical ? (Math.sin(a) < 0 ? 'bottom' : 'top') : 'middle';
    g.font = (act ? '700 ' : '500 ') + '9.5px "JetBrains Mono"';
    g.fillStyle = act ? C.royal : done ? C.ink : C.mute;
    g.fillText(STAGES[k], lx, ly);
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = C.mute; g.font = '500 8.5px "JetBrains Mono"'; g.fillText('GENERATION', cx, cy - 22);
  g.fillStyle = flash > 0 ? C.royal : C.navy; g.font = '700 30px "Space Grotesk"'; g.fillText(String(gen), cx, cy + 1);
  g.fillStyle = C.mute; g.font = '500 8.5px "JetBrains Mono"'; g.fillText('CYCLE ' + cycle.toFixed(1) + 'S', cx, cy + 23);
}

// ---------------- fitness history ----------------
export function drawFitness(cv, hist, gf) {
  const { g, w, h } = cv;
  g.clearRect(0, 0, w, h);
  if (hist.length < 2) return;
  const W = Math.min(38, Math.max(4, gf)), g0 = gf - W;
  const padL = 4, padR = 50, padT = 14, padB = 16;
  const at = (key, x) => { x = clamp(x, 0, hist.length - 1); const a = Math.floor(x), b = Math.min(hist.length - 1, a + 1); return lerp(hist[a][key], hist[b][key], x - a); };
  let lo = Infinity, hi = -Infinity;
  for (let k = Math.max(0, Math.floor(g0)); k < hist.length; k++) { lo = Math.min(lo, hist[k].mean); hi = Math.max(hi, hist[k].best); }
  const span = Math.max(0.02, hi - lo); lo -= span * 0.12; hi += span * 0.18;
  const X = (k) => padL + ((k - g0) / W) * (w - padL - padR), Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  g.font = '500 8.5px "JetBrains Mono"'; g.textBaseline = 'middle'; g.textAlign = 'left';
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3, y = Y(v);
    g.strokeStyle = '#e6edf7'; g.lineWidth = 1; g.setLineDash([3, 4]); line(g, [[padL, y], [w - padR + 4, y]]); g.stroke(); g.setLineDash([]);
    g.fillStyle = C.mute; g.fillText(v.toFixed(3), w - padR + 10, y);
  }
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const step = W > 20 ? 5 : 2;
  for (let k = Math.max(0, Math.ceil(g0 / step) * step); k <= gf; k += step) { g.fillStyle = C.grey; g.fillText('G' + k, X(k), h - 3); }
  const pts = [], mpts = [];
  for (let k = Math.max(0, Math.floor(g0)); k <= Math.floor(gf); k++) { pts.push([X(k), Y(at('best', k))]); mpts.push([X(k), Y(at('mean', k))]); }
  pts.push([X(gf), Y(at('best', gf))]); mpts.push([X(gf), Y(at('mean', gf))]);
  g.save(); g.beginPath(); g.rect(padL, 0, w - padL - padR, h); g.clip();
  line(g, pts); for (let i = mpts.length - 1; i >= 0; i--) g.lineTo(mpts[i][0], mpts[i][1]);
  const bg = g.createLinearGradient(0, padT, 0, h); bg.addColorStop(0, 'rgba(37,99,235,0.20)'); bg.addColorStop(1, 'rgba(37,99,235,0.02)');
  g.fillStyle = bg; g.fill();
  g.strokeStyle = C.sky; g.lineWidth = 1.2; g.setLineDash([4, 3]); line(g, mpts); g.stroke(); g.setLineDash([]);
  g.strokeStyle = C.royal; g.lineWidth = 2.2; g.lineJoin = 'round'; line(g, pts); g.stroke();
  for (let k = Math.max(0, Math.ceil(g0)); k <= Math.floor(gf); k++) { g.fillStyle = C.white; g.strokeStyle = C.royal; g.lineWidth = 1.2; g.beginPath(); g.arc(X(k), Y(at('best', k)), 2.2, 0, Math.PI * 2); g.fill(); g.stroke(); }
  g.restore();
  const [hx, hy] = pts[pts.length - 1], pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
  g.fillStyle = hexA(C.sky, 0.25 + 0.2 * pulse); g.beginPath(); g.arc(hx, hy, 8 + 3 * pulse, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.royal; g.beginPath(); g.arc(hx, hy, 4, 0, Math.PI * 2); g.fill();
  const val = at('best', gf).toFixed(4), tw = 52, ty = hy < 36 ? hy + 8 : hy - 24;
  g.fillStyle = C.navy; g.beginPath(); g.roundRect(hx - tw - 10, ty, tw, 16, 4); g.fill();
  g.fillStyle = C.white; g.font = '700 9.5px "JetBrains Mono"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(val, hx - tw / 2 - 10, ty + 8.5);
  g.textAlign = 'left'; g.font = '500 8.5px "JetBrains Mono"';
  g.fillStyle = C.royal; g.fillRect(padL + 2, 3, 14, 2.2); g.fillStyle = C.mute; g.fillText('BEST', padL + 20, 4);
  g.strokeStyle = C.sky; g.setLineDash([4, 3]); g.lineWidth = 1.2; line(g, [[padL + 56, 4], [padL + 70, 4]]); g.stroke(); g.setLineDash([]);
  g.fillText('POPULATION MEAN', padL + 74, 4);
}

// ---------------- gene pool graph ----------------
export function nodeXY(n, t, w, h) {
  return [n.x * w + Math.sin(t * 0.5 + n.ph) * 3, n.y * h + Math.cos(t * 0.42 + n.ph * 1.3) * 2.5];
}

export function drawMesh(cv, { nodes, edges, lineage, ct, t, leaderId, inspectId, hoverId, births, deaths }) {
  const { g, w, h } = cv;
  g.clearRect(0, 0, w, h);
  const P = new Map();
  nodes.forEach((n) => P.set(n.id, nodeXY(n, t, w, h)));
  SPECIES.forEach((sp) => {
    const x = sp.cx * w, y = sp.cy * h, rad = Math.min(w, h) * 0.38;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, hexA(sp.color, 0.08)); gr.addColorStop(1, hexA(sp.color, 0));
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  });
  const vis = (n) => n.alpha > 0.02;
  // similarity edges
  g.lineWidth = 0.7;
  edges.forEach(([a, b, cross]) => {
    const na = nodes.get(a), nb = nodes.get(b); if (!na || !nb || !vis(na) || !vis(nb)) return;
    const pa = P.get(a), pb = P.get(b), al = Math.min(na.alpha, nb.alpha);
    g.strokeStyle = cross ? `rgba(11,42,107,${0.07 * al})` : hexA(SPECIES[na.fam].color, 0.26 * al);
    g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke();
  });
  // lineage pulses: parent → child, drawn while the child is being born
  lineage.forEach(({ from, to, t0 }) => {
    const na = nodes.get(from), nb = nodes.get(to); if (!na || !nb) return;
    const k = (ct - t0) / 0.6; if (k < 0 || k > 1.6) return;
    const pa = P.get(from), pb = P.get(to), col = SPECIES[nb.fam].color, e = ease(Math.min(1, k));
    const x = lerp(pa[0], pb[0], e), y = lerp(pa[1], pb[1], e), fade = k > 1 ? 1 - (k - 1) / 0.6 : 1;
    g.strokeStyle = hexA(col, 0.5 * fade); g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(x, y); g.stroke(); g.lineCap = 'butt';
    if (k < 1) {
      const hg = g.createRadialGradient(x, y, 0, x, y, 11); hg.addColorStop(0, 'rgba(56,189,248,0.9)'); hg.addColorStop(1, 'rgba(56,189,248,0)');
      g.fillStyle = hg; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
    }
  });
  // nodes
  nodes.forEach((n) => {
    if (!vis(n)) return;
    const [x, y] = P.get(n.id), col = SPECIES[n.fam].color;
    const rr = n.r * n.scale;
    g.globalAlpha = n.alpha;
    if (n.halo) { g.fillStyle = hexA(col, 0.14); g.beginPath(); g.arc(x, y, rr + 5 + 2 * Math.sin(t * 2 + n.ph), 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.arc(x, y, Math.max(0.5, rr), 0, Math.PI * 2);
    if (n.dying) { g.fillStyle = C.white; g.fill(); g.strokeStyle = C.grey; g.lineWidth = 1.2; g.stroke(); }
    else { g.fillStyle = hexA(col, 0.92); g.fill(); g.strokeStyle = C.white; g.lineWidth = 0.8; g.stroke(); }
    g.globalAlpha = 1;
  });
  // birth / death rings
  const ring = (id, k, color, label) => {
    const n = nodes.get(id); if (!n) return;
    const [x, y] = P.get(id);
    g.strokeStyle = hexA(color, 1 - k); g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, n.r + 4 + k * 24, 0, Math.PI * 2); g.stroke();
    if (label && k < 0.7) {
      g.globalAlpha = 1 - k / 0.7; g.font = '700 8.5px "JetBrains Mono"'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = color === C.sky ? C.royal : '#7d8fae'; g.fillText(label, x + n.r + 7, y - 9 - k * 8); g.globalAlpha = 1;
    }
  };
  births.forEach(([id, k, lab]) => ring(id, k, C.sky, lab));
  deaths.forEach(([id, k, lab]) => ring(id, k, '#8a9bb8', lab));
  // leader + inspected markers
  const mark = (id, label, color, dashed) => {
    const n = nodes.get(id); if (!n || !vis(n)) return;
    const [x, y] = P.get(id), rr = n.r * n.scale + 7;
    g.strokeStyle = color; g.lineWidth = 1.6; if (dashed) g.setLineDash([3, 3]);
    g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.font = '700 9px "JetBrains Mono"'; const tw = g.measureText(label).width + 12;
    const lx = clamp(x - tw / 2, 2, w - tw - 2), ly = y - rr - 22 < 2 ? y + rr + 4 : y - rr - 20;
    g.fillStyle = color; g.beginPath(); g.roundRect(lx, ly, tw, 16, 4); g.fill();
    g.fillStyle = C.white; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, lx + tw / 2, ly + 8.5);
  };
  if (hoverId && hoverId !== inspectId && hoverId !== leaderId) { const n = nodes.get(hoverId); if (n) mark(hoverId, 'g' + hoverId, C.mute, true); }
  if (inspectId && inspectId !== leaderId) mark(inspectId, 'INSPECT g' + inspectId, C.royal, true);
  if (leaderId) mark(leaderId, 'LIVE g' + leaderId, C.navy, false);
  return P;
}

// ---------------- kelly ----------------
export function drawKelly(cv, { W, R, t }) {
  const { g, w, h } = cv;
  g.clearRect(0, 0, w, h);
  const f = Math.max(0, W - (1 - W) / R);
  const G = (x) => W * Math.log(1 + x * R) + (1 - W) * Math.log(1 - x);
  const fx = clamp(Math.max(0.3, f * 2.4), 0.3, 0.95), top = Math.max(0.004, G(f)), lo = -top * 0.8;
  const X = (x) => 6 + (x / fx) * (w - 12), Y = (v) => 10 + (1 - (v - lo) / (top * 1.3 - lo)) * (h - 24);
  g.strokeStyle = C.line; g.lineWidth = 1; line(g, [[6, Y(0)], [w - 6, Y(0)]]); g.stroke();
  const pts = []; for (let i = 0; i <= 80; i++) { const x = (i / 80) * fx; pts.push([X(x), Y(Math.max(lo, G(x)))]); }
  line(g, [[X(0), Y(0)], ...pts, [X(fx), Y(0)]]); g.closePath();
  const ag = g.createLinearGradient(0, 0, 0, h); ag.addColorStop(0, 'rgba(37,99,235,0.18)'); ag.addColorStop(1, 'rgba(37,99,235,0)'); g.fillStyle = ag; g.fill();
  line(g, pts); g.strokeStyle = C.royal; g.lineWidth = 2; g.stroke();
  g.font = '700 8.5px "JetBrains Mono"';
  if (f > 0) {
    const hx = X(f / 2);
    g.setLineDash([3, 3]); g.strokeStyle = C.sky; g.lineWidth = 1.2; line(g, [[hx, Y(G(f / 2))], [hx, Y(0) + 4]]); g.stroke(); g.setLineDash([]);
    g.fillStyle = C.sky; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('½K', hx, Y(0) + 13);
    const px = X(f), py = Y(G(f)), pul = 0.5 + 0.5 * Math.sin(t * 4);
    g.fillStyle = hexA(C.royal, 0.18 + 0.12 * pul); g.beginPath(); g.arc(px, py, 9 + 3 * pul, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.royal; g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.navy; g.textAlign = px > w - 60 ? 'right' : 'left'; g.fillText('f* ' + Math.round(f * 100) + '%', px + (px > w - 60 ? -12 : 12), py - 4);
  } else {
    g.fillStyle = C.mute; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NO EDGE · DO NOT BET', w / 2, h / 2);
  }
  g.fillStyle = C.mute; g.font = '500 8px "JetBrains Mono"'; g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillText('BET FRACTION f → GROWTH', w - 6, h - 1);
}
