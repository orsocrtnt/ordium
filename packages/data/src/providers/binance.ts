import type { AssetSeries, Candle } from "@ordium/engine";
import { SymbolNotSupportedError, type FetchQuery, type MarketDataProvider } from "../types.js";

type Kline = [number, string, string, string, string, string, number];

/**
 * API publique Binance (sans clé) : le meilleur historique crypto gratuit.
 * Historique complet depuis le listing, paginé par 1 000 bougies.
 * Limite officielle : 6 000 « weights »/min par IP ; on reste très en dessous.
 */
export const binanceProvider: MarketDataProvider = {
  id: "binance",
  capabilities: {
    assetTypes: ["crypto"],
    timeframes: ["1d", "1h"],
    license: "libre",
    rateLimits: { perSecond: 10, perMinute: 1_000 },
    priority: 10,
  },

  resolveSymbol(query: FetchQuery): string {
    return `${query.symbol}${query.quote ?? "EUR"}`.toUpperCase();
  },

  async fetchCandles(query: FetchQuery): Promise<AssetSeries> {
    const pair = this.resolveSymbol(query)!;
    const interval = query.timeframe === "1h" ? "1h" : "1d";
    let startTime = Date.parse(`${query.from}T00:00:00Z`);
    const endTime = Date.parse(`${query.to}T23:59:59Z`);
    const candles: Candle[] = [];

    for (;;) {
      const url =
        `https://api.binance.com/api/v3/klines?symbol=${pair}` +
        `&interval=${interval}&limit=1000&startTime=${startTime}&endTime=${endTime}`;
      const res = await fetch(url);
      if (res.status === 400 || res.status === 404) {
        throw new SymbolNotSupportedError("binance", pair, `HTTP ${res.status}`);
      }
      if (!res.ok) {
        throw new Error(`Binance a répondu ${res.status} pour ${pair} : ${await res.text()}`);
      }
      const rows = (await res.json()) as Kline[];
      if (rows.length === 0) break;
      for (const r of rows) {
        const openMs = r[0];
        candles.push({
          date:
            interval === "1h"
              ? new Date(openMs).toISOString()
              : new Date(openMs).toISOString().slice(0, 10),
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
          volume: Number(r[5]),
        });
      }
      if (rows.length < 1000) break;
      startTime = rows[rows.length - 1]![6] + 1;
    }

    const now = Date.now();
    const closed =
      interval === "1h"
        ? candles.filter((c) => Date.parse(c.date) + 3_600_000 <= now)
        : (() => {
            const today = new Date().toISOString().slice(0, 10);
            return candles.filter((c) => c.date < today);
          })();

    return {
      symbol: query.symbol.toUpperCase(),
      quote: (query.quote ?? "EUR").toUpperCase(),
      interval: query.timeframe,
      source: "binance",
      assetType: query.assetType,
      candles: closed,
    };
  },
};
