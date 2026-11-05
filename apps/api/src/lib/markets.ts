import {
  ASSET_TYPES,
  fetchFearGreedIndex,
  getHistoricalPrices,
  type AssetType,
  type Timeframe,
} from "@ordium/data";
import { computeIndicatorSeries, computeIndicatorSnapshot } from "@ordium/engine";

export type LiveSymbolRequest = {
  symbol: string;
  assetType?: string;
  quote?: string;
};

export type LiveSymbolAnalysis = {
  symbol: string;
  quote: string;
  assetType: string;
  asOf: string;
  indicators: ReturnType<typeof computeIndicatorSnapshot>;
  signals: string[];
};

export type ChartRequest = {
  symbol: string;
  timeframe?: Timeframe;
  assetType?: string;
  quote?: string;
};

export type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ChartResponse = {
  symbol: string;
  quote: string;
  assetType: string;
  timeframe: Timeframe;
  asOf: string;
  /** Overlays = helpers @ordium/engine (mêmes formules que les règles). */
  candles: ChartCandle[];
  indicators: {
    sma20: (number | null)[];
    sma50: (number | null)[];
    sma200: (number | null)[];
    rsi14: (number | null)[];
    bollinger: Array<{ mid: number; upper: number; lower: number } | null>;
    macd: Array<{ macd: number; signal: number; histogram: number } | null>;
  };
  snapshot: ReturnType<typeof computeIndicatorSnapshot>;
  signals: string[];
};

function inferType(symbol: string, explicit?: string): AssetType {
  if (explicit && (ASSET_TYPES as string[]).includes(explicit)) {
    return explicit as AssetType;
  }
  const s = symbol.toUpperCase();
  if (
    ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"].includes(s) ||
    /USDT$|USDC$/.test(s)
  ) {
    return "crypto";
  }
  if (s.includes(".") || s.endsWith(".PA") || s.endsWith(".L")) return "etf";
  return "stock";
}

function buildSignals(ind: ReturnType<typeof computeIndicatorSnapshot>): string[] {
  const out: string[] = [];
  if (ind.rsi14 != null) {
    if (ind.rsi14 < 30) out.push(`RSI ${ind.rsi14.toFixed(1)} — zone de survente (< 30)`);
    else if (ind.rsi14 > 70) out.push(`RSI ${ind.rsi14.toFixed(1)} — zone de surachat (> 70)`);
    else out.push(`RSI ${ind.rsi14.toFixed(1)} — neutre`);
  }
  if (ind.regime) out.push(`Régime vs SMA200 : ${ind.regime}`);
  if (ind.macd) {
    out.push(
      ind.macd.histogram >= 0
        ? "MACD histogramme ≥ 0 (momentum positif)"
        : "MACD histogramme < 0 (momentum négatif)",
    );
  }
  if (ind.bollinger) {
    if (ind.bollinger.pctB < 0.05) out.push("Prix près de la bande Bollinger basse");
    else if (ind.bollinger.pctB > 0.95) out.push("Prix près de la bande Bollinger haute");
  }
  if (ind.pctFromAth252 != null && ind.pctFromAth252 < -20) {
    out.push(`À ${ind.pctFromAth252.toFixed(1)} % du plus haut 1 an`);
  }
  return out;
}

function candleTimeUnix(date: string, timeframe: Timeframe): number {
  if (timeframe === "1h") {
    return Math.floor(Date.parse(date) / 1000);
  }
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

export async function analyzeLiveSymbols(
  requests: LiveSymbolRequest[],
): Promise<{ asOf: string; fearGreed: Awaited<ReturnType<typeof fetchFearGreedIndex>> | null; symbols: LiveSymbolAnalysis[] }> {
  const asOf = new Date().toISOString();
  let fearGreed: Awaited<ReturnType<typeof fetchFearGreedIndex>> | null = null;
  try {
    fearGreed = await fetchFearGreedIndex();
  } catch {
    fearGreed = null;
  }

  const symbols: LiveSymbolAnalysis[] = [];
  for (const req of requests) {
    const symbol = req.symbol.trim().toUpperCase();
    if (!symbol) continue;
    const assetType = inferType(symbol, req.assetType);
    const quote = (req.quote ?? (assetType === "crypto" ? "USDT" : "USD")).toUpperCase();
    const from = new Date(Date.now() - 800 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const series = await getHistoricalPrices(symbol, assetType, "1d", from, to, {
      quote,
      strictQuote: assetType === "crypto",
    });
    const closes = series.candles.map((c) => c.close);
    const indicators = computeIndicatorSnapshot(closes);
    symbols.push({
      symbol: series.symbol,
      quote: series.quote,
      assetType: series.assetType ?? assetType,
      asOf: series.candles[series.candles.length - 1]?.date ?? asOf,
      indicators,
      signals: buildSignals(indicators),
    });
  }

  return { asOf, fearGreed, symbols };
}

/**
 * Série chart : bougies + indicateurs (moteur @ordium/engine = règles).
 * Lookback : ~400 j (1d) / ~30 j (1h).
 */
export async function fetchChartSeries(req: ChartRequest): Promise<ChartResponse> {
  const symbol = req.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("Symbole requis");
  const timeframe: Timeframe = req.timeframe === "1h" ? "1h" : "1d";
  const assetType = inferType(symbol, req.assetType);
  const quote = (req.quote ?? (assetType === "crypto" ? "USDT" : "USD")).toUpperCase();

  const lookbackDays = timeframe === "1h" ? 30 : 400;
  const from = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const series = await getHistoricalPrices(symbol, assetType, timeframe, from, to, {
    quote,
    strictQuote: assetType === "crypto",
  });

  const closes = series.candles.map((c) => c.close);
  const indicators = computeIndicatorSeries(closes);
  const snapshot = computeIndicatorSnapshot(closes);

  const candles: ChartCandle[] = series.candles.map((c) => ({
    time: candleTimeUnix(c.date, timeframe),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  return {
    symbol: series.symbol,
    quote: series.quote,
    assetType: series.assetType ?? assetType,
    timeframe,
    asOf: series.candles[series.candles.length - 1]?.date ?? new Date().toISOString(),
    candles,
    indicators,
    snapshot,
    signals: buildSignals(snapshot),
  };
}
