import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSeries, rolling, zscore } from '../dist/engine/series.js';
import { GridBot, backtest, signal, FEE } from '../dist/engine/bot.js';
import { Evolution, GENES, randomGenome, mutate, passesGate } from '../dist/engine/evolution.js';
import { mulberry32 } from '../dist/engine/rng.js';
import { CANDLES, META } from '../dist/data/candles.js';
import { CANDLES as ETH_C, META as ETH_M } from '../dist/data/candles.ETHUSDT.js';
import { CANDLES as SOL_C, META as SOL_M } from '../dist/data/candles.SOLUSDT.js';

const flat = (n, p = 100) => Array.from({ length: n }, (_, i) => [i * 3600, p, p, p, p, 1]);

for (const [name, candles, meta] of [
  ['BTCUSDT', CANDLES, META],
  ['ETHUSDT', ETH_C, ETH_M],
  ['SOLUSDT', SOL_C, SOL_M],
]) {
  test(`bundled data is sane: ${name}`, () => {
    assert.equal(meta.symbol, name);
    assert.equal(candles.length, meta.count);
    assert.ok(candles.length >= 2000, 'enough bars to evolve on');
    for (let i = 1; i < candles.length; i++) assert.equal(candles[i][0] - candles[i - 1][0], 3600, `gap at ${i}`);
    for (const [, o, h, l, c] of candles) { assert.ok(h >= Math.max(o, c) && l <= Math.min(o, c) && l > 0); }
  });
}

test('rolling stats are causal and correct', () => {
  const c = flat(50); c[30][4] = 130; c[30][2] = 130;
  const s = makeSeries(c), r = rolling(s, 10);
  assert.ok(Number.isNaN(r.mean[8]));
  assert.equal(r.mean[29], 100);            // bar 30 not visible yet
  assert.equal(r.mean[30], 103);            // (9*100 + 130) / 10
  assert.equal(r.hh[30], 100);              // breakout high excludes the current bar
  assert.equal(r.hh[31], 130);
  assert.ok(zscore(s, 10, 30) > 2.9);
});

test('grid bot: fills levels, takes profit, pays fees', () => {
  // price opens at 100, dips to 98 (fills L2 at 99, L3 at 98), then rallies to 110
  const c = flat(40);
  const path = [100, 99.5, 98.8, 98, 98.5, 100, 103, 110];
  path.forEach((p, k) => { const i = 20 + k; c[i] = [i * 3600, p, Math.max(p, path[k - 1] ?? p), Math.min(p, path[k - 1] ?? p), p, 1]; });
  const s = makeSeries(c);
  const g = { family: 1, lookback: 5, entryZ: 99, levels: 3, spacing: 0.01, mult: 1, tp: 0.02, stop: 0.1 };
  const bot = new GridBot(g, 3000);
  const ev = [];
  bot._open(100, 20, ev);                   // force an entry to test mechanics only
  for (let i = 21; i < 40; i++) ev.push(...bot.step(s, i));
  const buys = ev.filter((e) => e.type === 'BUY').map((e) => e.level);
  assert.deepEqual(buys, ['L1', 'L2', 'L3']);
  const tp = ev.find((e) => e.type === 'TP');
  assert.ok(tp, 'take profit hit');
  const avg = 3000 / ((1000 / 100 + 1000 / 99 + 1000 / 98) * (1 - FEE));
  assert.ok(Math.abs(tp.price - avg * 1.02) < 1e-6);
  assert.ok(bot.cash > 3000 && bot.cash < 3000 * 1.02);
  assert.equal(bot.qty, 0);
});

test('grid bot: stop loss closes the whole position', () => {
  const c = flat(30);
  for (let i = 21; i < 30; i++) { const p = 100 - (i - 20) * 3; c[i] = [i * 3600, p + 3, p + 3, p, p, 1]; }
  const s = makeSeries(c);
  const g = { family: 1, lookback: 5, entryZ: 99, levels: 2, spacing: 0.02, mult: 1, tp: 0.05, stop: 0.05 };
  const bot = new GridBot(g, 1000), ev = [];
  bot._open(100, 20, ev);
  for (let i = 21; i < 30; i++) ev.push(...bot.step(s, i));
  const st = ev.find((e) => e.type === 'STOP');
  assert.ok(st);
  assert.ok(Math.abs(st.price - 98 * 0.95) < 1e-9);
  assert.ok(bot.cash < 1000);
  assert.equal(bot.trades.length, 1);
});

test('signals only use closed bars', () => {
  const s = makeSeries(CANDLES);
  const g = { family: 1, lookback: 48, entryZ: 1, levels: 4, spacing: 0.01, mult: 1.3, tp: 0.01, stop: 0.05 };
  const before = signal(g, s, 500);
  const copy = CANDLES.map((r) => r.slice()); copy[501][4] *= 0.5; copy[501][3] *= 0.5;
  assert.deepEqual(signal(g, makeSeries(copy), 500), before);
});

test('genomes stay inside bounds after mutation', () => {
  const r = mulberry32(1);
  for (let k = 0; k < 500; k++) {
    const { genome } = mutate(randomGenome(r), r, 0.9, 0.5);
    for (const G of GENES) {
      assert.ok(genome[G.key] >= G.min && genome[G.key] <= G.max, G.key);
      if (G.int) assert.ok(Number.isInteger(genome[G.key]), G.key);
    }
  }
});

test('evolution is deterministic per seed and keeps every species alive', () => {
  const s = makeSeries(CANDLES);
  const a = new Evolution(s, { seed: 42 }), b = new Evolution(s, { seed: 42 });
  for (let k = 0; k < 12; k++) { a.step(); b.step(); }
  assert.deepEqual(a.history, b.history);
  assert.equal(a.pop.length, 96);
  for (let f = 0; f < 4; f++) assert.ok(a.pop.some((x) => x.genome.family === f), 'family ' + f);
  // elitism: the best train fitness never goes down
  for (let k = 1; k < a.history.length; k++) assert.ok(a.history[k].best >= a.history[k - 1].best - 1e-12);
  if (a.leader) assert.ok(passesGate(a.leader.val));
});

test('leader backtest is reproducible', () => {
  const s = makeSeries(CANDLES);
  const e = new Evolution(s, { seed: 3 });
  for (let k = 0; k < 5; k++) e.step();
  const L = e.leader;
  assert.ok(L);
  assert.deepEqual(backtest(L.genome, s, e.valFrom, e.valTo), L.val);
});
