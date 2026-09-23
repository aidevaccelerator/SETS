// Forward-test equity: cohort survivors vs buy & hold, in return % from T0.

export const FW_COLORS = ['#2563eb', '#0891b2', '#0b2a6b', '#60a5fa', '#7c3aed', '#0d9488', '#b45309', '#be123c'];
export const BH_COLOR = '#94a3b8';

const line = (g, pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); };

export function drawForward(cv, { curve, startCash, runners, bhColor = BH_COLOR }) {
  const { g, w, h } = cv;
  g.clearRect(0, 0, w, h);
  if (!curve || curve.length < 2) {
    g.fillStyle = '#6b7c99';
    g.font = '700 10.5px "JetBrains Mono"';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('WAITING FOR THE FIRST FORWARD BAR', w / 2, h / 2);
    return null;
  }
  const padL = 6, padR = 108, padT = 10, padB = 18;
  const n = curve.length;
  const series = runners.map((_, k) => curve.map((p) => p.eqs[k] / startCash - 1));
  const bh = curve.map((p) => p.bh / startCash - 1);
  let lo = 0, hi = 0;
  for (const arr of [...series, bh]) for (const v of arr) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = Math.max(0.02, hi - lo);
  lo -= span * 0.1; hi += span * 0.12;
  const X = (i) => padL + (i / (n - 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);

  g.font = '500 8.5px "JetBrains Mono"';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4, y = Y(v);
    g.strokeStyle = '#e6edf7';
    g.lineWidth = 1;
    g.setLineDash([3, 4]);
    line(g, [[padL, y], [w - padR + 4, y]]);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#9fb0c9';
    g.fillText((v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%', padL + 4, y - 6);
  }
  // zero line
  const y0 = Y(0);
  g.strokeStyle = '#c9d7ec';
  g.lineWidth = 1;
  line(g, [[padL, y0], [w - padR + 4, y0]]);
  g.stroke();

  // x labels: first / mid / last
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#9fb0c9';
  const tLabel = (t) => {
    const d = new Date(t * 1000);
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  g.fillText(tLabel(curve[0].t), X(0) + 12, h - 4);
  if (n > 2) g.fillText(tLabel(curve[Math.floor(n / 2)].t), X(Math.floor(n / 2)), h - 4);
  g.fillText(tLabel(curve[n - 1].t), X(n - 1) - 12, h - 4);

  // buy & hold under the cohort
  g.strokeStyle = bhColor;
  g.lineWidth = 1.5;
  g.setLineDash([5, 4]);
  line(g, bh.map((v, i) => [X(i), Y(v)]));
  g.stroke();
  g.setLineDash([]);

  const ends = [];
  series.forEach((arr, k) => {
    const col = FW_COLORS[k % FW_COLORS.length];
    g.strokeStyle = col;
    g.lineWidth = 1.8;
    g.lineJoin = 'round';
    line(g, arr.map((v, i) => [X(i), Y(v)]));
    g.stroke();
    const last = arr[arr.length - 1];
    ends.push({ y: Y(last), v: last, col, label: 'g' + runners[k].sur.id });
  });
  ends.push({ y: Y(bh[n - 1]), v: bh[n - 1], col: bhColor, label: 'B&H', dash: true });
  // declutter end labels
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  ends.forEach((e) => {
    const x = w - padR + 8;
    g.fillStyle = e.col;
    g.font = (e.dash ? '500 ' : '700 ') + '9px "JetBrains Mono"';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${e.label} ${(e.v >= 0 ? '+' : '−')}${Math.abs(e.v * 100).toFixed(1)}%`, x, clampY(e.y, padT, h - padB));
  });
  return { lo, hi };
}

const clampY = (y, a, b) => Math.max(a, Math.min(b, y));

// Drawdown from running peak (always ≤ 0). Selected runner as a filled ribbon, B&H dashed.
export function drawUnderwater(cv, { curve, startCash, k, runners, bhColor = BH_COLOR }) {
  const { g, w, h } = cv;
  g.clearRect(0, 0, w, h);
  if (!curve || curve.length < 2 || k < 0) {
    g.fillStyle = '#6b7c99';
    g.font = '700 10.5px "JetBrains Mono"';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('WAITING FOR THE FIRST FORWARD BAR', w / 2, h / 2);
    return null;
  }
  const padL = 6, padR = 108, padT = 8, padB = 4;
  const n = curve.length;
  const underwater = (vals) => {
    let peak = -Infinity;
    return vals.map((v) => { peak = Math.max(peak, v); return v / peak - 1; });
  };
  const series = underwater(curve.map((p) => p.eqs[k]));
  const bh = underwater(curve.map((p) => p.bh));
  let lo = -0.01;
  for (const v of series) lo = Math.min(lo, v);
  for (const v of bh) lo = Math.min(lo, v);
  lo *= 1.15;
  const X = (i) => padL + (i / (n - 1)) * (w - padL - padR);
  const Y = (v) => padT + (Math.min(0, v) / lo) * (h - padT - padB); // v=0 → top, v=lo → bottom

  // gridlines at 0 / mid / lo
  g.font = '500 8.5px "JetBrains Mono"';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (const v of [0, lo / 2, lo]) {
    const y = Y(v);
    g.strokeStyle = v === 0 ? '#c9d7ec' : '#e6edf7';
    g.lineWidth = 1;
    g.setLineDash(v === 0 ? [] : [3, 4]);
    line(g, [[padL, y], [w - padR + 4, y]]);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#9fb0c9';
    g.fillText((v * 100).toFixed(1) + '%', padL + 4, Math.min(h - 5, y + (v === 0 ? 7 : -6)));
  }

  // selected ribbon: fill down from zero
  g.beginPath();
  series.forEach((v, i) => { const x = X(i), y = Y(v); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.lineTo(X(n - 1), Y(0));
  g.lineTo(X(0), Y(0));
  g.closePath();
  g.fillStyle = 'rgba(37, 99, 235, 0.14)';
  g.fill();
  g.strokeStyle = '#2563eb';
  g.lineWidth = 1.5;
  g.lineJoin = 'round';
  line(g, series.map((v, i) => [X(i), Y(v)]));
  g.stroke();

  // B&H under it
  g.strokeStyle = bhColor;
  g.lineWidth = 1.3;
  g.setLineDash([4, 3]);
  line(g, bh.map((v, i) => [X(i), Y(v)]));
  g.stroke();
  g.setLineDash([]);

  // end labels
  const ends = [
    { y: Y(series[n - 1]), v: series[n - 1], col: '#2563eb', label: runners && runners[k] ? 'g' + runners[k].sur.id : 'g', bold: true },
    { y: Y(bh[n - 1]), v: bh[n - 1], col: bhColor, label: 'B&H', bold: false },
  ];
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  ends.forEach((e) => {
    g.fillStyle = e.col;
    g.font = (e.bold ? '700 ' : '500 ') + '9px "JetBrains Mono"';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${e.label} ${(e.v * 100).toFixed(1)}%`, w - padR + 8, clampY(e.y, padT, h - padB));
  });
  return { lo, series, bh };
}

// Max drawdown from running peak over an equity path (≤ 0).
export function maxUnderwater(eqs) {
  let peak = -Infinity, m = 0;
  for (const v of eqs) {
    if (v > peak) peak = v;
    if (peak > 0) m = Math.min(m, v / peak - 1);
  }
  return m;
}
