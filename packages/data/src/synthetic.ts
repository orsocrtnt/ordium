import type { AssetSeries, Candle } from "@ordium/engine";
import { canonicalMarketSymbol } from "./symbols.js";

function isWeekend(date: string): boolean {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Série journalière à prix constant — pour actifs non cotés (SpaceX…)
 * ou secours quand le marché ne répond pas mais qu'on a un cours importé.
 */
export function buildFlatPriceSeries(opts: {
  symbol: string;
  price: number;
  quote: string;
  from: string;
  to: string;
  source?: string;
  assetType?: string;
}): AssetSeries {
  const symbol = canonicalMarketSymbol(opts.symbol);
  const price = opts.price;
  if (!(price > 0) || !Number.isFinite(price)) {
    throw new Error(`Prix invalide pour série plate ${symbol}.`);
  }
  const candles: Candle[] = [];
  let d = opts.from;
  const end = opts.to;
  while (d <= end) {
    // Actifs non cotés : pas de séance le week-end (aligné sur actions / ETF).
    if (!isWeekend(d)) {
      candles.push({ date: d, open: price, high: price, low: price, close: price, volume: 0 });
    }
    d = addDays(d, 1);
  }
  if (candles.length === 0) {
    candles.push({
      date: end,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
    });
  }
  return {
    symbol,
    quote: opts.quote.toUpperCase(),
    interval: "1d",
    source: opts.source ?? "imported",
    assetType: opts.assetType ?? "stock",
    candles,
  };
}
