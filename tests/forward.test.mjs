import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSeries } from '../dist/engine/series.js';
import { GridBot, FEE } from '../dist/engine/bot.js';
import { runForward, fetchCandles } from '../dist/engine/forward.js';
import { SNAPSHOT } from '../dist/data/snapshot.js';
import { SNAPSHOT as ETH_SNAP } from '../dist/data/snapshot.ETHUSDT.js';
import { SNAPSHOT as SOL_SNAP } from '../dist/data/snapshot.SOLUSDT.js';
import { GENES } from '../dist/engine/evolution.js';

const hourly = (from, n, path) =>
  Array.from({ length: n }, (_, i) => {
    const p = path(i);
    return [(from + i * 3600) * 1000 / 1000, p, p * 1.01, p * 0.99, p, 1];
  });

for (const [name, snap] of [
  ['BTCUSDT', SNAPSHOT],
  ['ETHUSDT', ETH_SNAP],
  ['SOLUSDT', SOL_SNAP],
]) {
  test(`snapshot is well formed and genomes stay in bounds: ${name}`, () => {
    assert.equal(snap.version, 1);
    assert.equal(snap.symbol, name);
    assert.ok(snap.survivors.length >= 1);
    assert.ok(snap.forwardFrom > snap.bundledTo);
    assert.equal(snap.forwardFrom, snap.bundledTo + 3600);
    for (const s of snap.survivors) {
      for (const G of GENES) {
        const v = s.genome[G.key];
        assert.ok(v >= G.min && v <= G.max, `${s.id}.${G.key}`);
        if (G.int) assert.ok(Number.isInteger(v), `${s.id}.${G.key}`);
      }
      assert.ok(s.train && s.val && Number.isFinite(s.fit));
    }
    const ids = new Set(snap.survivors.map((s) => s.id));
    assert.equal(ids.size, snap.survivors.length);
  });
}

test('runForward: empty when no bars past T0', () => {
  const snap = { ...SNAPSHOT, forwardFrom: 2_000_000_000 };
  const candles = hourly(1_900_000_000, 300, () => 100);
  const run = runForward(snap, candles, 10000);
  assert.equal(run.fromIdx, -1);
  assert.equal(run.curve.length, 0);
  assert.equal(run.runners.length, snap.survivors.length);
});

test('runForward: curve matches bots and buy & hold, deterministic', () => {
  const snap = {
    ...SNAPSHOT,
    forwardFrom: 1_000_000_000,
    survivors: SNAPSHOT.survivors.slice(0, 3).map((s, i) => ({
      ...s,
      // deterministic, always-in-position-friendly genomes (one per family where possible)
      genome: { ...s.genome, family: i % 4, lookback: 10, entryZ: 0.2, levels: 2, spacing: 0.003, tp: 0.04, stop: 0.12 },
    })),
  };
  const warm = snap.warmupBars;
  const path = (i) => 100 + Math.sin(i / 5) * 10 + i * 0.05;
  const candles = hourly(snap.forwardFrom - warm * 3600, warm + 80, path);

  const a = runForward(snap, candles, 10000);
  const b = runForward(snap, candles, 10000);
  assert.equal(a.fromIdx, warm);
  assert.equal(a.curve.length, 80);
  assert.equal(a.bars, 80);
  // deterministic replay
  assert.deepEqual(a.curve, b.curve);
  // curve rows align with runner count
  for (const row of a.curve) assert.equal(row.eqs.length, snap.survivors.length);
  // buy & hold: same fee-adjusted entry as the bots
  const s = makeSeries(candles);
  const bhQty = (10000 * (1 - FEE)) / s.open[warm];
  assert.ok(Math.abs(a.bh - bhQty * s.close[s.n - 1]) < 1e-9);
  assert.ok(Math.abs(a.curve.at(-1).bh - a.bh) < 1e-9);
  // each bot's last curve equity equals its marked equity
  a.runners.forEach((r, k) => {
    assert.ok(Math.abs(r.equity - a.curve.at(-1).eqs[k]) < 1e-9);
    assert.equal(r.bot.g.family, snap.survivors[k].genome.family);
  });
  // returns derived from start cash
  const ret = a.bh / a.startCash - 1;
  assert.ok(Number.isFinite(ret));
});

test('runForward: bots only trade after T0 (warmup never stepped)', () => {
  const snap = {
    ...SNAPSHOT,
    forwardFrom: 1_000_000_000,
    survivors: [{ id: 1, family: 'X', genome: { ...SNAPSHOT.survivors[0].genome, family: 1, entryZ: 0.2, lookback: 10 } }],
  };
  const warm = snap.warmupBars;
  // dump before T0, rally after — a mean-revert bot should be able to open only post-T0
  const candles = Array.from({ length: warm + 40 }, (_, i) => {
    const t = snap.forwardFrom - warm * 3600 + i * 3600;
    const p = i < warm ? 100 + Math.sin(i / 3) * 15 : 100 + (i - warm) * 2;
    return [t, p, p * 1.02, p * 0.98, p, 1];
  });
  const run = runForward(snap, candles, 10000);
  const bot = run.runners[0].bot;
  // openedAt is an absolute index into the series; must be >= fromIdx if it ever opened
  if (bot.openedAt >= 0) assert.ok(bot.openedAt >= run.fromIdx, 'opened during warmup');
  assert.ok(bot.bars <= run.bars, 'bot only stepped post-T0');
});

test('fetchCandles is a function with the expected signature', () => {
  assert.equal(typeof fetchCandles, 'function');
  assert.equal(fetchCandles.length >= 1, true);
});

test('GridBot is what the forward runner instantiates', () => {
  const snap = { ...SNAPSHOT, forwardFrom: 1_000_000_000, survivors: SNAPSHOT.survivors.slice(0, 1) };
  const candles = hourly(snap.forwardFrom - 300 * 3600, 310, () => 50);
  const run = runForward(snap, candles, 10000);
  assert.ok(run.runners[0].bot instanceof GridBot);
});
