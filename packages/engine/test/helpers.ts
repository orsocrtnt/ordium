import { addDays } from "../src/calendar.js";
import type { AssetSeries, Candle } from "../src/types.js";
import type { Strategy } from "../src/schema.js";
import { parseStrategy } from "../src/schema.js";

/** Série synthétique quotidienne : close = priceFn(i), open = close de la veille. */
export function makeSeries(
  symbol: string,
  start: string,
  days: number,
  priceFn: (i: number) => number,
  quote = "EUR",
): AssetSeries {
  const candles: Candle[] = [];
  let date = start;
  for (let i = 0; i < days; i++) {
    const close = priceFn(i);
    const open = i === 0 ? close : priceFn(i - 1);
    candles.push({
      date,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: 1000,
    });
    date = addDays(date, 1);
  }
  return { symbol, quote, interval: "1d", candles };
}

export function baseStrategy(overrides: Record<string, unknown> = {}): Strategy {
  return parseStrategy({
    name: "Test",
    budget: { amount: 300, currency: "EUR", period: "monthly" },
    window: { type: "day_of_month", from: 1, to: 7 },
    allocation: [{ asset: "AAA", weight: 1 }],
    ...overrides,
  });
}
