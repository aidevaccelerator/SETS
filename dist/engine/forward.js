// Forward paper test: replay a frozen cohort on candles the evolution never saw.
// Stateless — every refresh re-fetches bars after snapshot.forwardFrom and replays from T0,
// so the same snapshot + same tape always produce the same curve.

import { GridBot, FEE } from './bot.js';
import { makeSeries } from './series.js';

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

async function getJson(path) {
  let last = null;
  for (const host of HOSTS) {
    try {
      const r = await fetch(host + path, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error('unreachable');
}

// Hourly klines from startTime to endTime (inclusive of completed candles only).
export async function fetchCandles({ symbol = 'BTCUSDT', startTime, endTime = Date.now() }) {
  const rows = [];
  let start = startTime;
  for (let page = 0; page < 50; page++) {
    let q = `/api/v3/klines?symbol=${symbol}&interval=1h&limit=1000&startTime=${start}&endTime=${endTime}`;
    const batch = await getJson(q);
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < 1000) break;
    start = batch[batch.length - 1][0] + 3600000;
  }
  // drop the still-open candle (close time in the future)
  while (rows.length && rows[rows.length - 1][6] > Date.now()) rows.pop();
  return rows.map((r) => [Math.floor(r[0] / 1000), +r[1], +r[2], +r[3], +r[4], Math.round(+r[5] * 1000) / 1000]);
}

// Replay the cohort from T0 through the last completed bar.
// `candles` must start warmupBars hours before forwardFrom and run contiguously to now.
export function runForward(snapshot, candles, startCash = 10000) {
  const s = makeSeries(candles);
  const fromIdx = candles.findIndex((c) => c[0] >= snapshot.forwardFrom);
  const runners = snapshot.survivors.map((sur) => ({
    sur,
    bot: new GridBot({ ...sur.genome }, startCash),
    events: [], // every fill/exit on the forward tape, with bar time
  }));
  if (fromIdx < 0) return { series: s, fromIdx: -1, runners, curve: [], startCash };

  // buy & hold with the same entry fee the bots pay
  const bhQty = (startCash * (1 - FEE)) / s.open[fromIdx];
  const curve = [];
  for (let i = fromIdx; i < s.n; i++) {
    for (const r of runners) {
      for (const e of r.bot.step(s, i)) r.events.push({ ...e, t: s.time[i] });
    }
    curve.push({
      t: s.time[i],
      eqs: runners.map((r) => r.bot.equity(s.close[i])),
      bh: bhQty * s.close[i],
    });
  }
  const lastClose = s.close[s.n - 1];
  for (const r of runners) r.equity = r.bot.equity(lastClose);
  return {
    series: s,
    fromIdx,
    runners,
    curve,
    startCash,
    bh: bhQty * lastClose,
    price: lastClose,
    open: s.open[fromIdx],
    bars: s.n - fromIdx,
  };
}
