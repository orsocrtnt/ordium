import type { AssetSeries, Candle } from "@ordium/engine";
import { SymbolNotSupportedError, type FetchQuery, type MarketDataProvider } from "../types.js";

/** [time, low, high, open, close, volume], du plus récent au plus ancien. */
type CoinbaseCandle = [number, number, number, number, number, number];

const DAY_MS = 86_400_000;
/** L'API Coinbase limite chaque réponse à 300 bougies. */
const CHUNK_DAYS = 300;

/**
 * API publique Coinbase Exchange (sans clé). Fallback crypto derrière
 * Binance : ~250 paires (bonnes paires EUR/USD), historique complet mais
 * pagination plus lente (300 bougies par requête).
 */
export const coinbaseProvider: MarketDataProvider = {
  id: "coinbase",
  capabilities: {
    assetTypes: ["crypto"],
    timeframes: ["1d"],
    license: "libre",
    rateLimits: { perSecond: 5 },
    priority: 12,
  },

  resolveSymbol(query: FetchQuery): string {
    return `${query.symbol}-${query.quote ?? "EUR"}`.toUpperCase();
  },

  async fetchCandles(query: FetchQuery): Promise<AssetSeries> {
    const product = this.resolveSymbol(query)!;
    const startMs = Date.parse(`${query.from}T00:00:00Z`);
    const endMs = Date.parse(`${query.to}T23:59:59Z`);
    const candles: Candle[] = [];

    for (let chunkStart = startMs; chunkStart <= endMs; chunkStart += CHUNK_DAYS * DAY_MS) {
      const chunkEnd = Math.min(chunkStart + (CHUNK_DAYS - 1) * DAY_MS, endMs);
      const url =
        `https://api.exchange.coinbase.com/products/${product}/candles` +
        `?granularity=86400&start=${new Date(chunkStart).toISOString()}` +
        `&end=${new Date(chunkEnd).toISOString()}`;
      const res = await fetch(url, { headers: { "User-Agent": "ordium/0.1" } });
      if (res.status === 404) {
        throw new SymbolNotSupportedError("coinbase", product, "HTTP 404");
      }
      if (!res.ok) {
        throw new Error(`Coinbase a répondu ${res.status} pour ${product} : ${await res.text()}`);
      }
      const rows = (await res.json()) as CoinbaseCandle[];
      for (const [time, low, high, open, close, volume] of rows) {
        candles.push({
          date: new Date(time * 1000).toISOString().slice(0, 10),
          open,
          high,
          low,
          close,
          volume,
        });
      }
    }

    candles.sort((a, b) => (a.date < b.date ? -1 : 1));

    // On écarte la bougie du jour, encore incomplète.
    const today = new Date().toISOString().slice(0, 10);
    return {
      symbol: query.symbol.toUpperCase(),
      quote: (query.quote ?? "EUR").toUpperCase(),
      interval: "1d",
      source: "coinbase",
      assetType: query.assetType,
      candles: candles.filter((c) => c.date < today),
    };
  },
};
