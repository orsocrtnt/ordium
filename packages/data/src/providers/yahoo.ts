import type { AssetSeries, Candle } from "@ordium/engine";
import { SymbolNotSupportedError, type FetchQuery, type MarketDataProvider } from "../types.js";

interface YahooChart {
  chart: {
    result?: {
      meta: { currency: string };
      timestamp?: number[];
      indicators: {
        quote: {
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }[];
      };
    }[];
    error?: { description?: string } | null;
  };
}

/**
 * Tickers « courts » (exports broker) → symbole Yahoo Finance.
 * Les exchanges EU exigent souvent un suffixe (.L Londres, .AS Amsterdam, .PA Paris).
 */
const YAHOO_SYMBOL_ALIASES: Record<string, string> = {
  IWDA: "IWDA.AS", // iShares Core MSCI World — Euronext Amsterdam (EUR)
  CSPX: "CSPX.L", // iShares Core S&P 500 — LSE
  SGLD: "SGLD.L", // Invesco Physical Gold
  EIMI: "EIMI.L", // iShares Core MSCI EM IMI
  ENRG: "ENRG.L",
  HEAL: "HEAL.L",
  // Proxys raisonnables si le ticker broker n'existe pas tel quel sur Yahoo
  AINF: "AIAG.L", // AI / Big Data UCITS (proxy)
  "AINF.PA": "AIAG.L",
};

/**
 * API chart publique de Yahoo Finance (non officielle, **sans clé API**).
 * C’est le fournisseur gratuit pour tout ce qui n’est pas sur Binance/Kraken :
 * actions mondiales, ETF UCITS, indices, forex, matières premières.
 * Zone grise de licence : ok pour le MVP / perso ; remplacer plus tard
 * (Finnhub free tier, Polygon…) pour un usage commercial.
 */
export const yahooProvider: MarketDataProvider = {
  id: "yahoo",
  capabilities: {
    assetTypes: ["stock", "etf", "index", "forex", "commodity", "crypto"],
    // En crypto, Yahoo ne répond qu'en secours explicite : deviner « crypto »
    // pour un ticker d'action matcherait des tokens homonymes (ex. QQQ-USD).
    fallbackOnly: ["crypto"],
    timeframes: ["1d", "1h"],
    license: "grise",
    rateLimits: { perSecond: 2, perMinute: 60 },
    priority: 20,
  },

  resolveSymbol(query: FetchQuery): string {
    const s = query.symbol.toUpperCase();
    if (query.assetType === "crypto") return `${s}-${(query.quote ?? "USD").toUpperCase()}`;
    if (query.assetType === "forex" && !s.endsWith("=X")) return `${s.replace("/", "")}=X`;
    return YAHOO_SYMBOL_ALIASES[s] ?? query.symbol;
  },

  async fetchCandles(query: FetchQuery): Promise<AssetSeries> {
    const symbol = this.resolveSymbol(query)!;
    const period1 = Math.floor(Date.parse(`${query.from}T00:00:00Z`) / 1000);
    const period2 = Math.floor(Date.parse(`${query.to}T23:59:59Z`) / 1000);
    const yInterval = query.timeframe === "1h" ? "60m" : "1d";
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=${yInterval}&period1=${period1}&period2=${period2}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (res.status === 404) {
      throw new SymbolNotSupportedError("yahoo", symbol, "HTTP 404");
    }
    if (!res.ok) {
      throw new Error(`Yahoo Finance a répondu ${res.status} pour ${symbol}.`);
    }
    const data = (await res.json()) as YahooChart;
    const result = data.chart.result?.[0];
    if (!result || !result.timestamp?.length) {
      throw new SymbolNotSupportedError(
        "yahoo",
        symbol,
        data.chart.error?.description ?? "aucune donnée — vérifie le symbole sur finance.yahoo.com",
      );
    }

    const quote = result.indicators.quote[0]!;
    const candles: Candle[] = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const open = quote.open[i];
      const close = quote.close[i];
      if (open == null || close == null) continue;
      const ts = result.timestamp[i]! * 1000;
      candles.push({
        date:
          query.timeframe === "1h"
            ? new Date(ts).toISOString()
            : new Date(ts).toISOString().slice(0, 10),
        open,
        high: quote.high[i] ?? Math.max(open, close),
        low: quote.low[i] ?? Math.min(open, close),
        close,
        volume: quote.volume[i] ?? 0,
      });
    }

    const now = Date.now();
    const closed =
      query.timeframe === "1h"
        ? candles.filter((c) => Date.parse(c.date) + 3_600_000 <= now)
        : (() => {
            const today = new Date().toISOString().slice(0, 10);
            return candles.filter((c) => c.date < today);
          })();

    return {
      symbol: query.symbol.toUpperCase(),
      quote: result.meta.currency.toUpperCase(),
      interval: query.timeframe,
      source: "yahoo",
      assetType: query.assetType,
      candles: closed,
    };
  },
};
