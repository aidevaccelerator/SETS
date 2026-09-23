// SETS MACHINE controller: runs the evolution, animates each generation stage by stage,
// and renders the frozen-cohort forward test (the only place real new bars are traded).

import { CANDLES as BTC_CANDLES, META as BTC_META } from './data/candles.BTCUSDT.js';
import { CANDLES as ETH_CANDLES, META as ETH_META } from './data/candles.ETHUSDT.js';
import { CANDLES as SOL_CANDLES, META as SOL_META } from './data/candles.SOLUSDT.js';
import { SNAPSHOT as BTC_SNAP } from './data/snapshot.BTCUSDT.js';
import { SNAPSHOT as ETH_SNAP } from './data/snapshot.ETHUSDT.js';
import { SNAPSHOT as SOL_SNAP } from './data/snapshot.SOLUSDT.js';
import { makeSeries, volatility } from './engine/series.js';
import { signal, FAMILIES } from './engine/bot.js';
import { Evolution, GENES } from './engine/evolution.js';
import { fetchCandles, runForward } from './engine/forward.js';
import * as D from './ui/draw.js';
import { drawForward, drawUnderwater, maxUnderwater, FW_COLORS, BH_COLOR } from './ui/forward.js';

const TAPE = {
  BTC: { candles: BTC_CANDLES, meta: BTC_META, snapshot: BTC_SNAP },
  ETH: { candles: ETH_CANDLES, meta: ETH_META, snapshot: ETH_SNAP },
  SOL: { candles: SOL_CANDLES, meta: SOL_META, snapshot: SOL_SNAP },
};

const { clamp, ease, fmt, money } = D;
const $ = (id) => document.getElementById(id);
const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
const setHTML = (el, s) => { if (el.__h !== s) { el.innerHTML = s; el.__h = s; } };
const pct = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
const tapeTime = (sec) => { const d = new Date(sec * 1000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`; };

const STAGE = 0.8, CYCLE = STAGE * 6, START_CASH = 10000;
const GI = Object.fromEntries(GENES.map((G) => [G.key, G]));
const norm = (key, v) => (v - GI[key].min) / (GI[key].max - GI[key].min);
const q = new URLSearchParams(location.search);

let symKey, CANDLES, META, S, snapshot; // current tape — rebound by loadTape()
let fw = { status: 'loading', at: 0 }, fwBusy = false, fwQueued = false, fwSel = 0;
let fwGen = 0;
const runs = { BTC: null, ETH: null, SOL: null }; // { run, live, at, err } per market
const edges = { BTC: null, ETH: null, SOL: null }; // { pp, bars } per market
const GB_SORT = {
  id: { def: 1, label: 'ID' },
  family: { def: 1, label: 'SPECIES' },
  fit: { def: -1, label: 'FIT' },
  oos: { def: -1, label: 'OOS' },
  dd: { def: 1, label: 'DD' },
  trades: { def: -1, label: '×' },
};
let gbSort = { key: 'fit', dir: -1 }, gbFam = -1;

function loadTape(key) {
  const t = TAPE[key] || TAPE.BTC;
  symKey = TAPE[key] ? key : 'BTC';
  CANDLES = t.candles;
  META = t.meta;
  snapshot = t.snapshot;
  S = makeSeries(CANDLES);
  fwSel = 0;
  const cached = runs[symKey];
  if (cached && cached.run) {
    fw = { status: cached.live ? 'live' : 'bundled only', run: cached.run, at: cached.at, err: cached.err || null };
  } else {
    fw = { status: 'loading', at: 0 };
  }
  document.querySelectorAll('[data-sym]').forEach((b) => b.classList.toggle('on', b.dataset.sym === symKey));
  document.querySelectorAll('[data-edge-sym]').forEach((b) => b.classList.toggle('on', b.dataset.edgeSym === symKey));
  $('sym').textContent = META.symbol;
  setText($('fwdSym'), symKey);
  setText($('meta'), `${META.symbol} ${META.interval} · ${fmt(META.count)} candles · ${tapeTime(META.from)} → ${tapeTime(META.to)} UTC · train 70% / out-of-sample 30%`);
  renderEdgeStrip();
}

const cv = {};
['logo', 'spark', 'ring', 'fit', 'kelly', 'fwChart', 'fwDD'].forEach((id) => { cv[id] = D.sized($(id)); });

let st; // whole simulation state; rebuilt on restart

function restart(seed, warm = 0) {
  const evo = new Evolution(S, { seed });
  for (let k = 0; k < warm; k++) evo.step();
  st = {
    seed, evo, ct: CYCLE * 0.999, t: 0, rep: evo.last,
    shown: null, pending: null, geneFlash: null,
    inspect: null,
  };
  if (evo.leader) promote(evo.leader);
  $('seed').value = seed;
  syncUrl();
}

// ---------------- generations ----------------
function startGeneration() {
  const rep = st.evo.step();
  st.rep = rep;
  if (st.inspect != null && !st.evo.byId(st.inspect)) st.inspect = null;
  st.pending = rep.promoted ? rep.leader : null;
  st.deployed = false;
}

function deploy() {
  st.deployed = true;
  if (st.pending) { promote(st.pending); st.pending = null; }
}

// Promote only feeds the Genome / Kelly panels — the forward cohort is frozen at T0.
function promote(leader) {
  const prev = st.shown;
  st.shown = leader;
  if (prev) st.geneFlash = { keys: GENES.filter((G) => G.int ? prev.genome[G.key] !== leader.genome[G.key] : Math.abs(prev.genome[G.key] - leader.genome[G.key]) > 1e-9).map((G) => G.key), t: st.t };
}

// ---------------- frame ----------------
let running = !q.has('paused'), speed = [1, 2, 4, 8].includes(+q.get('speed')) ? +q.get('speed') : 1, last = performance.now();

function update(dt) {
  st.t += dt;
  st.ct += dt;
  if (st.ct >= STAGE * 5 && !st.deployed) deploy();
  if (st.ct >= CYCLE) { if (!st.deployed) deploy(); st.ct -= CYCLE; if (st.ct >= CYCLE) st.ct = 0; startGeneration(); }
}

function stageText(stage) {
  const r = st.rep, evo = st.evo, off = r.offspring[0] ? evo.byId(r.offspring[0]) : null;
  const vol = volatility(S, S.n - 1) * 100;
  return [
    `tape σ ${vol.toFixed(2)}%/h · ${evo.split - evo.trainFrom} h train · ${evo.valTo - evo.valFrom} h out-of-sample`,
    `${r.immigrants.length} random immigrants injected into the pool`,
    off && off.parents.length ? `crossover g${off.parents[0]} × g${off.parents[1]} → ${r.offspring.length} offspring · p(mut) 0.18` : `${r.offspring.length} offspring bred`,
    `${r.immigrants.length + r.offspring.length} backtests on real ${META.symbol} ${META.interval} candles`,
    `gate passed ${r.survivors}/${evo.N} · ${r.died.length} killed · ${evo.N - r.died.length} elites kept`,
    r.leader ? (st.pending || r.promoted ? `g${r.leader.id} promoted · genome & Kelly panels updated` : `leader g${r.leader.id} defends the title`) : 'no survivor yet · no leader genome',
  ][stage];
}

// Live table of every config that currently passes the out-of-sample gate.
// Rows feed the Genome panel via st.inspect — the old gene-pool canvas in DOM form.
const gbVal = (ind, key) => {
  if (key === 'id') return ind.id;
  if (key === 'family') return ind.genome.family;
  if (key === 'oos') return ind.val.ret;
  if (key === 'dd') return ind.val.maxDD;
  if (key === 'trades') return ind.val.trades;
  return ind.fit;
};

function gatePassers() {
  const evo = st.evo;
  const all = evo.pop.filter((x) => x.pass);
  const pass = gbFam < 0 ? all : all.filter((x) => x.genome.family === gbFam);
  const { key, dir } = gbSort;
  pass.sort((a, b) => dir * (gbVal(a, key) - gbVal(b, key)));
  return { all, pass };
}

function renderGateBoard() {
  const evo = st.evo;
  const { all, pass } = gatePassers();
  setText($('gateCount'), gbFam < 0 ? `${pass.length} / ${evo.N} PASSED` : `${pass.length} / ${all.length} SHOWN`);
  setText($('gateMeta'), `GEN ${st.rep.gen} · BORN ${fmt(evo.born)} · KILLED ${fmt(evo.killed)}`);
  setText($('gateSortLab'), `SORT ${GB_SORT[gbSort.key].label} ${gbSort.dir < 0 ? '↓ DESC' : '↑ ASC'}`);
  document.querySelectorAll('#gateHead [data-sort]').forEach((b) => {
    const on = b.dataset.sort === gbSort.key;
    b.classList.toggle('sorted', on);
    b.setAttribute('aria-sort', on ? (gbSort.dir < 0 ? 'descending' : 'ascending') : 'none');
  });
  if (!pass.length) {
    setHTML($('gateRows'), all.length
      ? '<div class="gbempty">No config matches this filter.</div>'
      : '<div class="gbempty">No config has passed the out-of-sample gate yet.</div>');
    return;
  }
  const leadId = st.shown ? st.shown.id : -1;
  setHTML($('gateRows'), pass.map((ind) => {
    const g = ind.genome, col = D.SPECIES[g.family].color;
    const role = ind.id === leadId ? 'LEADER' : ind.id === st.inspect ? 'INSPECT' : 'PASS';
    return (
      `<div class="gbdata${ind.id === st.inspect ? ' sel' : ''}${ind.id === leadId ? ' lead' : ''}" data-id="${ind.id}" role="button" tabindex="0">` +
      `<span class="fid"><i style="background:${col}"></i>g${ind.id}</span>` +
      `<span class="fsp">${FAMILIES[g.family]}</span>` +
      `<span>${ind.fit.toFixed(4)}</span>` +
      `<span class="${ind.val.ret >= 0 ? 'pos' : 'neg'}">${pct(ind.val.ret, 1)}</span>` +
      `<span>${(ind.val.maxDD * 100).toFixed(1)}%</span>` +
      `<span>${ind.val.trades}</span>` +
      `<span class="grole">${role}</span></div>`
    );
  }).join(''));
}

// Reigns of past leaders derived from evo.history[].leaderId.
function renderTurnover() {
  const reigns = [];
  for (const h of st.evo.history) {
    if (h.leaderId == null) continue;
    const last = reigns[reigns.length - 1];
    if (last && last.id === h.leaderId) last.to = h.gen;
    else reigns.push({ id: h.leaderId, from: h.gen, to: h.gen });
  }
  if (!reigns.length) {
    setHTML($('turnover'), '<label>LEADERS</label><span class="tvnone">NO LEADER YET</span>');
    return;
  }
  const show = reigns.slice(-5);
  setHTML(
    $('turnover'),
    '<label>LEADERS</label>' +
      show
        .map((r, i) => {
          const cur = i === show.length - 1;
          const span = r.from === r.to ? `#${r.from}` : `#${r.from}–${cur ? 'NOW' : r.to}`;
          return `<span class="tchip${cur ? ' now' : ''}"><b>g${r.id}</b> ${span}</span>`;
        })
        .join('<i>→</i>'),
  );
}

// Cross-market cohort edge (best runner vs B&H), pp.
function edgeOf(run) {
  if (!run || !run.curve.length) return { pp: null, bars: run ? run.bars : 0 };
  let best = -Infinity;
  for (const r of run.runners) best = Math.max(best, r.equity ?? run.startCash);
  const pp = (best / run.startCash - 1 - (run.bh / run.startCash - 1)) * 100;
  return { pp, bars: run.bars };
}

function renderEdgeStrip() {
  for (const key of ['BTC', 'ETH', 'SOL']) {
    const el = $('e' + key);
    if (!el) continue;
    const e = edges[key];
    const txt = !e || e.pp == null ? '—' : (e.pp >= 0 ? '+' : '−') + Math.abs(e.pp).toFixed(1) + 'pp';
    setText(el, txt);
    el.classList.toggle('pos', !!e && e.pp != null && e.pp >= 0);
    el.classList.toggle('neg', !!e && e.pp != null && e.pp < 0);
    const seg = el.closest('[data-edge-sym]');
    if (seg) seg.classList.toggle('on', key === symKey);
  }
}

function render() {
  const evo = st.evo, rep = st.rep, ct = st.ct, stage = Math.min(5, Math.floor(ct / STAGE)), sp = (ct - stage * STAGE) / STAGE;
  const t = st.t;
  // header
  setText($('sGen'), '#' + rep.gen);
  setText($('sTested'), fmt(evo.tested));
  setText($('sKill'), (evo.born ? (evo.killed / evo.born) * 100 : 0).toFixed(1) + '%');
  setText($('sSurv'), `${rep.survivors}/${evo.N}`);
  setText($('clock'), new Date().toLocaleTimeString('en-GB'));
  document.querySelector('.pill i').style.opacity = (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2))).toFixed(2);
  setText($('lat'), running ? `PAPER · ${speed}×` : 'PAUSED');
  D.drawLogo(cv.logo, t);
  D.drawSpark(cv.spark, evo.history.map((h) => h.survivors), evo.N);
  // ring + fitness
  D.drawRing(cv.ring, { stage, sp, pos: ct / CYCLE, gen: rep.gen, cycle: CYCLE / speed, flash: ct < 0.5 });
  const gf = Math.max(0, evo.history.length - 2 + clamp(ct / CYCLE, 0, 1));
  D.drawFitness(cv.fit, evo.history, gf);
  const H = evo.history, cur = H[H.length - 1], old = H[Math.max(0, H.length - 11)];
  setText($('fitNow'), 'BEST ' + cur.best.toFixed(4));
  setText($('fPop'), String(evo.N));
  setText($('fOff'), String(rep.offspring.length + rep.immigrants.length));
  setText($('fElite'), String(evo.N - rep.offspring.length - rep.immigrants.length));
  setText($('fDelta'), (cur.best - old.best >= 0 ? '+' : '−') + Math.abs(cur.best - old.best).toFixed(4));
  setText($('stName'), D.STAGES[stage]);
  setText($('stText'), stageText(stage));
  renderGateBoard();
  renderTurnover();
  renderGenome(); renderSelection(stage, sp); renderKelly(t);
}

function renderGenome() {
  let ind = st.shown, inspecting = false;
  if (st.inspect != null) {
    const x = st.evo.byId(st.inspect);
    if (x) { ind = x; inspecting = true; } else st.inspect = null;
  }
  setText($('genomeTitle'), inspecting ? 'GENOME · INSPECTING' : 'GENOME · LIVE LEADER');
  setText($('genomeSub'), inspecting ? 'PRESS ESC OR CLICK THE ROW AGAIN TO RETURN TO THE LEADER' : 'DNA OF THE CURRENT LEADER · CHOSEN BY THE OUT-OF-SAMPLE GATE');
  if (!ind) { setHTML($('genes'), '<div class="sig">No config has passed the out-of-sample gate yet.</div>'); setText($('genomeId'), ''); setHTML($('genomeFoot'), ''); return; }
  setText($('genomeId'), `g${ind.id} · BORN GEN ${ind.gen}`);
  const flash = !inspecting && st.geneFlash && st.t - st.geneFlash.t < 2.2 ? st.geneFlash.keys : [];
  setHTML($('genes'), GENES.map((G) => {
    const v = ind.genome[G.key], on = Math.round((G.key === 'family' ? (v + 1) / 4 : norm(G.key, v)) * 22);
    let segs = ''; for (let s = 0; s < 22; s++) segs += s < on ? '<i class="on"></i>' : '<i></i>';
    return `<div class="gene${flash.includes(G.key) ? ' mut' : ''}"><span class="n">${G.label}</span><span class="segs">${segs}</span><span class="v">${G.fmt(v)}</span></div>`;
  }).join(''));
  setHTML($('genomeFoot'), `<span>TRAIN <b>${pct(ind.train.ret)}</b> DD ${(ind.train.maxDD * 100).toFixed(1)}% · ${ind.train.trades}×</span><span>OOS <b>${pct(ind.val.ret)}</b> DD ${(ind.val.maxDD * 100).toFixed(1)}% · ${ind.val.trades}×</span>`);
}

function renderSelection(stage, sp) {
  const r = st.rep, N = st.evo.N, fresh = r.immigrants.length + r.offspring.length;
  const rows = [
    ['GENERATED', fresh, stage < 1 ? 0 : stage === 1 ? ease(sp) * (r.immigrants.length / fresh) : stage === 2 ? r.immigrants.length / fresh + ease(sp) * (r.offspring.length / fresh) : 1, stage === 1 || stage === 2],
    ['BACKTESTED', fresh, stage < 3 ? 0 : stage === 3 ? ease(sp) : 1, stage === 3],
    ['PASSED GATE', r.survivors, stage < 4 ? 0 : stage === 4 ? ease(sp / 0.6) : 1, stage === 4 && sp < 0.6],
    ['ELITE KEPT', N - fresh, stage < 4 ? 0 : stage === 4 ? ease((sp - 0.5) / 0.5) : 1, stage === 4 && sp >= 0.5],
    ['DEPLOYED', r.leader ? 1 : 0, stage < 5 ? 0 : ease(sp / 0.5), stage === 5],
  ];
  setHTML($('funnel'), rows.map(([name, v, f, act]) => {
    const wv = (Math.log(v + 1) / Math.log(N + 1)) * 100;
    return `<div class="fr${act ? ' act' : ''}"><span class="n">${name}</span><span class="v${f > 0 ? '' : ' dim'}">${fmt(f > 0 ? v * f : v)}</span>` +
      `<span class="bar"><i class="p" style="width:${wv.toFixed(1)}%"></i><i class="c" style="width:${(wv * f).toFixed(1)}%"></i></span></div>`;
  }).join(''));
  setText($('selGen'), 'GEN ' + r.gen);
}

// Small samples lie, so both inputs are shrunk: W towards 50% (Beta(2,2) prior) and, when a config
// has never lost, R falls back to what its own geometry implies (take-profit vs. a typical stopped loss).
function kellyInputs(ind) {
  const a = ind.train, b = ind.val, n = a.trades + b.trades, g = ind.genome;
  const wins = Math.round(a.winRate * a.trades) + Math.round(b.winRate * b.trades);
  const structural = g.tp / ((g.spacing * (g.levels - 1)) / 2 + g.stop);
  const seen = a.payoff > 0 && a.payoff < 9 ? a.payoff : b.payoff > 0 && b.payoff < 9 ? b.payoff : structural;
  return { W: (wins + 2) / (n + 4), R: clamp(Math.min(seen, Math.max(structural, seen * 0.5)), 0.2, 4), n };
}

function renderKelly(t) {
  const ind = st.shown;
  if (!ind) { setText($('kPct'), '—'); ['kW', 'kR', 'kH', 'kE'].forEach((id) => setText($(id), '—')); setText($('kN'), 'NO LEADER'); D.drawKelly(cv.kelly, { W: 0.5, R: 1, t }); return; }
  const { W, R, n } = kellyInputs(ind), f = Math.max(0, W - (1 - W) / R);
  setText($('kPct'), Math.round(f * 100) + '%');
  setText($('kW'), Math.round(W * 100) + '%'); setText($('kR'), R.toFixed(2));
  setText($('kH'), Math.round(f * 50) + '%'); setText($('kE'), (W * R - (1 - W) >= 0 ? '+' : '−') + Math.abs(W * R - (1 - W)).toFixed(2));
  setText($('kN'), `${n} TRADES · SHRUNK`);
  D.drawKelly(cv.kelly, { W, R, t });
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (running) update(dt * speed);
  render();
  renderForward();
  requestAnimationFrame(frame);
}

// ---------------- forward test (frozen cohort on live bars) ----------------
function renderFwHeader(run) {
  const bars = $('sFwdBars');
  if (!run || !run.curve.length) setText(bars, run ? '0' : '—');
  else setText(bars, String(run.bars));
}

// Fetch one market's tape and replay its frozen cohort. Returns { run, live, err }.
async function computeRun(key) {
  const t = TAPE[key];
  const mySnap = t.snapshot;
  if (!mySnap) return null;
  const warmup = mySnap.warmupBars || 220;
  const start = mySnap.forwardFrom - warmup * 3600;
  const [live, bundled] = await Promise.all([
    fetchCandles({ symbol: mySnap.symbol, startTime: start * 1000 }).catch(() => []),
    Promise.resolve(t.candles.filter((c) => c[0] >= start)),
  ]);
  const past = bundled.filter((c) => c[0] >= mySnap.forwardFrom).length;
  const candles = live.length ? mergeCandles(bundled, live) : bundled;
  const run = runForward(mySnap, candles, START_CASH);
  return {
    run,
    live: live.length > 0,
    past,
    err: live.length ? null : past ? 'Binance unreachable — showing bundled bars only' : null,
    at: Date.now(),
    symbol: mySnap.symbol,
  };
}

async function refreshForward() {
  if (fwBusy) { fwQueued = true; return; }
  fwBusy = true;
  const gen = ++fwGen;
  const myKey = symKey;
  try {
    if (runs[myKey] == null || !runs[myKey].run) fw = { ...fw, status: 'fetching…', run: null };
    const keys = ['BTC', 'ETH', 'SOL'];
    const results = await Promise.all(keys.map(async (key) => {
      try { return [key, await computeRun(key)]; }
      catch { return [key, null]; }
    }));
    if (gen !== fwGen) { fwBusy = false; return; } // a newer refresh owns the UI
    for (const [key, res] of results) {
      if (!res) continue;
      runs[key] = res;
      edges[key] = edgeOf(res.run);
    }
    renderEdgeStrip();
    const res = runs[myKey];
    if (symKey === myKey && res) {
      const status = res.live ? 'live' : res.past ? 'bundled only' : 'waiting';
      fw = { status, run: res.run, at: res.at, symbol: res.symbol, err: res.err };
    }
  } catch (e) {
    if (symKey === myKey) fw = { ...fw, status: 'error', err: String(e.message || e), at: Date.now() };
  }
  fwBusy = false;
  if (fwQueued) { fwQueued = false; refreshForward(); return; }
  renderForward();
}

// One frozen survivor's live order grid + its forward-tape fills.
function renderFwInspector(run, k) {
  const r = run.runners[k];
  if (!r) {
    setText($('fwInspH'), 'ORDER GRID');
    setHTML($('fwInsp'), '');
    setHTML($('fwEv'), '');
    return;
  }
  const bot = r.bot, g = bot.g, price = run.price;
  setText($('fwInspH'), `ORDER GRID · g${r.sur.id} · ${FAMILIES[g.family]}`);
  const rows = [];
  if (bot.inPos) {
    rows.push(`<div class="grow2 tp"><span class="l">TP</span><span>${money(bot.tp)}</span><span>100%</span><span class="s">${pct(bot.tp / price - 1, 2)} ↑</span></div>`);
    const next = bot.levels.find((L) => !L.filled);
    bot.levels.forEach((L) => {
      const cls = L.filled ? ' f' : L === next ? ' near' : '';
      const s = L.filled ? 'FILLED' : L === next ? ((price / L.price - 1) * 100).toFixed(2) + '% AWAY' : 'ARMED';
      rows.push(`<div class="grow2${cls}"><span class="l">${L.name}</span><span>${money(L.price)}</span><span>$${fmt(L.usd)}</span><span class="s">${s}</span></div>`);
    });
    rows.push(`<div class="grow2 ghost"><span class="l">SL</span><span>${money(bot.stop)}</span><span>ALL</span><span class="s">${pct(bot.stop / price - 1, 2)}</span></div>`);
    const unreal = bot.qty * price - bot.cost;
    rows.push(`<div class="sig">IN TRADE <b>${run.series.n - bot.openedAt} bars</b> · AVG ${money(bot.avg)} · UNREAL <b>${(unreal >= 0 ? '+$' : '−$') + Math.abs(unreal).toFixed(2)}</b></div>`);
  } else {
    let w = 0; for (let i = 0; i < g.levels; i++) w += Math.pow(g.mult, i);
    for (let i = 0; i < g.levels; i++) {
      rows.push(`<div class="grow2 ghost"><span class="l">L${i + 1}</span><span>${money(price * (1 - g.spacing * i))}</span><span>$${fmt((bot.cash / w) * Math.pow(g.mult, i))}</span><span class="s">PREVIEW</span></div>`);
    }
    const sg = signal(g, run.series, run.series.n - 1);
    rows.push(`<div class="sig">SIGNAL <b>${sg.ok ? 'FIRES NEXT BAR' : 'WAITING'}</b> · z ${sg.z.toFixed(2)}${sg.need ? ' · need ' + sg.need : ''}</div>`);
  }
  setHTML($('fwInsp'), rows.join(''));
  const evs = r.events.slice(-6);
  setHTML(
    $('fwEv'),
    evs.length
      ? evs.map((e) =>
          e.type === 'BUY'
            ? `<div><b>BUY</b>${tapeTime(e.t)} <span>${e.level} filled @ ${money(e.price)} · $${fmt(e.usd)}</span></div>`
            : `<div><b class="${e.type === 'TP' ? '' : 'bad'}">${e.type}</b>${tapeTime(e.t)} <span>closed @ ${money(e.price)} · ${e.pnl >= 0 ? '+' : '−'}$${Math.abs(e.pnl).toFixed(2)}</span></div>`,
        ).join('')
      : '<div><span>NO FILLS YET · ONLY REAL FORWARD BARS COUNT</span></div>',
  );
}

// keep bundled warmup bars and splice live bars on top (live wins on overlap)
function mergeCandles(base, live) {
  const byT = new Map();
  for (const c of base) byT.set(c[0], c);
  for (const c of live) byT.set(c[0], c);
  return [...byT.values()].sort((a, b) => a[0] - b[0]);
}

function utcTime(sec) {
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
}

function renderForward() {
  renderFwHeader(fw.run);
  const stEl = $('fwStatus');
  if (!snapshot) {
    setText(stEl, 'NO SNAPSHOT');
    setHTML($('fwSub'), 'run <b>node tools/make_snapshot.mjs</b> to freeze a cohort');
    drawForward(cv.fwChart, { curve: null });
    drawUnderwater(cv.fwDD, { curve: null, k: -1 });
    setText($('fwDDMax'), '—');
    return;
  }
  if (!snapshot || !fw.run) {
    setText(stEl, fw.status === 'error' ? 'ERROR' : 'CONNECTING…');
    if (fw.err) setHTML($('fwSub'), fw.err);
    if (!fw.run) {
      drawForward(cv.fwChart, { curve: null });
      drawUnderwater(cv.fwDD, { curve: null, k: -1 });
      setText($('fwDDMax'), '—');
    }
    return;
  }
  const run = fw.run;
  const badge = { live: 'LIVE', fetching: 'FETCHING…', waiting: 'WAITING FOR BAR 1', error: 'ERROR', 'bundled only': 'OFFLINE · BUNDLED' }[fw.status] || fw.status.toUpperCase();
  setText(stEl, badge);
  setHTML(
    $('fwSub'),
    `FROZEN GEN ${snapshot.gen} · SEED ${snapshot.seed} · ${snapshot.survivors.length} SURVIVORS · T0 ${utcTime(snapshot.forwardFrom)} UTC · NO RE-EVOLUTION${fw.err ? ' · ' + fw.err : ''}`,
  );
  setText($('fwSince'), run.bars > 0 ? `FORWARD SINCE ${utcTime(run.series.time[run.fromIdx])} UTC · T0 ${utcTime(snapshot.forwardFrom)} UTC` : `T0 ${utcTime(snapshot.forwardFrom)} UTC · NO BARS YET`);
  setText($('fwBars'), run.bars ? `${fmt(run.bars)} HOURLY BARS · UPDATED ${new Date(fw.at).toLocaleTimeString('en-GB')}` : '');
  setText($('fwPrice'), run.bars ? `${META.symbol} ${money(run.price)} · B&H ENTRY ${money(run.open)}` : '');
  drawForward(cv.fwChart, { curve: run.curve, startCash: run.startCash, runners: run.runners, bhColor: BH_COLOR });
  const sel = clamp(fwSel, 0, run.runners.length - 1);
  fwSel = sel;
  drawUnderwater(cv.fwDD, { curve: run.curve, startCash: run.startCash, k: sel, runners: run.runners, bhColor: BH_COLOR });
  if (run.curve.length >= 2) {
    const r = run.runners[sel];
    const selDD = maxUnderwater(run.curve.map((p) => p.eqs[sel]));
    const bhDD = maxUnderwater(run.curve.map((p) => p.bh));
    const ddp = (v) => (Math.abs(v) < 0.0005 ? '0.0' : (v * 100).toFixed(1)) + '%';
    setText($('fwDDMax'), r ? `MAX DD · g${r.sur.id} ${ddp(selDD)} · B&H ${ddp(bhDD)}` : '—');
  } else setText($('fwDDMax'), '—');
  // cohort table — rows are click targets for the inspector
  const rows = run.runners.map((r, k) => {
    const bot = r.bot, col = FW_COLORS[k % FW_COLORS.length];
    const eq = r.equity ?? run.startCash;
    const ret = eq / run.startCash - 1;
    const dd = bot.maxDD;
    const state = bot.inPos ? `IN POS ${bot.levels.filter((L) => L.filled).length}/${bot.levels.length}` : 'FLAT';
    return (
      `<div class="fwdata${bot.inPos ? ' inpos' : ''}${k === sel ? ' sel' : ''}" data-idx="${k}" role="button" tabindex="0">` +
      `<span class="fid"><i style="background:${col}"></i>g${r.sur.id}</span>` +
      `<span class="fsp">${r.sur.family}</span>` +
      `<span class="${ret >= 0 ? 'pos' : 'neg'}">${pct(ret, 2)}</span>` +
      `<span>${(dd * 100).toFixed(1)}%</span>` +
      `<span>${bot.trades.length}</span>` +
      `<span>${state}</span></div>`
    );
  });
  const bh = run.bars ? run.bh / run.startCash - 1 : 0;
  rows.push(
    `<div class="fwdata bh"><span class="fid"><i style="background:${BH_COLOR}"></i>B&H</span>` +
      `<span class="fsp">BUY AND HOLD</span>` +
      `<span class="${bh >= 0 ? 'pos' : 'neg'}">${run.bars ? pct(bh, 2) : '—'}</span>` +
      `<span>—</span><span>${run.bars ? 1 : 0}</span><span>${run.bars ? 'HELD' : 'WAITING'}</span></div>`,
  );
  setHTML($('fwRows'), rows.join(''));
  renderFwInspector(run, sel);
}

// ---------------- controls ----------------
function syncUrl() {
  const u = new URL(location.href);
  u.searchParams.set('seed', st.seed);
  u.searchParams.set('sym', symKey);
  if (speed !== 1) u.searchParams.set('speed', speed); else u.searchParams.delete('speed');
  u.searchParams.delete('warm');
  history.replaceState(null, '', u);
}
function setRunning(v) { running = v; const b = $('bPlay'); b.textContent = v ? '❚❚ PAUSE' : '▶ RUN'; b.setAttribute('aria-label', v ? 'Pause' : 'Run'); }
function setSpeed(v) { speed = v; document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === v)); if (st) syncUrl(); }
function step() {
  if (!st.deployed) deploy();
  startGeneration();
  st.ct = CYCLE * 0.999;
  deploy();
}

$('bPlay').onclick = () => setRunning(!running);
$('bStep').onclick = step;
$('fwRefresh').onclick = () => refreshForward();
function pickGateRow(e) {
  const row = e.target.closest('[data-id]');
  return row ? +row.dataset.id : null;
}
function inspectGateRow(e) {
  const id = pickGateRow(e);
  if (id == null) return;
  st.inspect = st.inspect === id ? null : id; // click again returns to the leader
  renderGateBoard();
  renderGenome();
}
$('gateRows').addEventListener('click', inspectGateRow);
$('gateRows').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  inspectGateRow(e);
});
$('gateHead').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]');
  if (!b) return;
  const key = b.dataset.sort;
  if (gbSort.key === key) gbSort.dir *= -1;
  else gbSort = { key, dir: GB_SORT[key].def };
  renderGateBoard();
});
$('gbFam').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fam]');
  if (!b) return;
  gbFam = +b.dataset.fam;
  document.querySelectorAll('#gbFam [data-fam]').forEach((x) => x.classList.toggle('on', +x.dataset.fam === gbFam));
  renderGateBoard();
});
$('fwRows').addEventListener('click', (e) => {
  const row = e.target.closest('[data-idx]');
  if (!row) return;
  fwSel = +row.dataset.idx;
  renderForward();
});
$('fwRows').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-idx]');
  if (!row) return;
  e.preventDefault();
  fwSel = +row.dataset.idx;
  renderForward();
});
document.querySelectorAll('[data-speed]').forEach((b) => { b.onclick = () => setSpeed(+b.dataset.speed); });
function switchMarket(key) {
  if (key === symKey || !TAPE[key]) return;
  loadTape(key);
  restart(st ? st.seed : 2026, 0);
  refreshForward();
}
document.querySelectorAll('[data-sym]').forEach((b) => { b.onclick = () => switchMarket(b.dataset.sym); });
$('mStrip').addEventListener('click', (e) => {
  const b = e.target.closest('[data-edge-sym]');
  if (b) switchMarket(b.dataset.edgeSym);
});
$('bSeed').onclick = () => restart(clamp(Math.round(+$('seed').value) || 1, 1, 999999));
$('bRand').onclick = () => restart(1 + Math.floor(Math.random() * 999999));
$('seed').onkeydown = (e) => { if (e.key === 'Enter') $('bSeed').click(); };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); setRunning(!running); }
  else if (e.key === 'ArrowRight') step();
  else if (e.key === 'Escape') { st.inspect = null; renderGateBoard(); renderGenome(); }
  else if ('1234'.includes(e.key)) setSpeed([1, 2, 4, 8][+e.key - 1]);
});

const initKey = (q.get('sym') || 'BTC').toUpperCase();
loadTape(TAPE[initKey] ? initKey : 'BTC');
setSpeed(speed);
setRunning(running);
restart(clamp(parseInt(q.get('seed'), 10) || 2026, 1, 999999), clamp(parseInt(q.get('warm'), 10) || 0, 0, 500));
refreshForward();
setInterval(refreshForward, 10 * 60 * 1000); // keep the forward tape fresh while the tab is open
requestAnimationFrame(frame);

// small read-only hook for debugging and automated checks
window.SETS = {
  get state() { return st; },
  get forward() { return fw; },
  get snapshot() { return snapshot; },
  get symbol() { return symKey; },
  get edges() { return edges; },
  step, setSpeed, setRunning, restart, advance(dt) { update(dt); render(); },
  refreshForward,
};
