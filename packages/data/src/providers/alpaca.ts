import type { AssetSeries, Candle } from "@ordium/engine";
import { SymbolNotSupportedError, type FetchQuery, type MarketDataProvider } from "../types.js";

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface AlpacaBarsResponse {
  bars?: AlpacaBar[] | null;
  next_page_token?: string | null;
  symbol?: string;
}

interface AlpacaMultiBarsResponse {
  bars?: Record<string, AlpacaBar[]>;
  next_page_token?: string | null;
}

/**
 * Alpaca Market Data — API officielle, plan Basic gratuit (feed IEX).
 * Couvre actions & ETF **US** en historique + quasi temps réel.
 * Les tickers EU (MC.PA, IWDA.AS…) → null → le routeur bascule sur Yahoo.
 *
 * Clés : ALPACA_API_KEY + ALPACA_API_SECRET
 * Compte paper gratuit : https://app.alpaca.markets/signup
 */
export function createAlpacaProvider(apiKey: string, apiSecret: string): MarketDataProvider {
  const headers = {
    "APCA-API-KEY-ID": apiKey,
    "APCA-API-SECRET-KEY": apiSecret,
  };

  return {
    id: "alpaca",
    capabilities: {
      assetTypes: ["stock", "etf"],
      timeframes: ["1d", "1h"],
      license: "commercial",
      rateLimits: { perMinute: 200 },
      priority: 15, // avant Yahoo (20), après les exchanges crypto
    },

    resolveSymbol(query: FetchQuery): string | null {
      const s = query.symbol.trim().toUpperCase();
      // Pas de places européennes / indices Yahoo sur le feed stocks US free.
      if (s.includes(".") || s.startsWith("^") || s.includes("/")) return null;
      if (!/^[A-Z]{1,5}$/.test(s)) return null;
      return s;
    },

    async fetchCandles(query: FetchQuery): Promise<AssetSeries> {
      const symbol = this.resolveSymbol(query);
      if (!symbol) {
        throw new SymbolNotSupportedError("alpaca", query.symbol, "hors couverture US free");
      }

      const tf = query.timeframe === "1h" ? "1Hour" : "1Day";
      // end doit être ≥ 15 min dans le passé pour le free tier selon les feeds.
      const end = new Date(Date.parse(`${query.to}T23:59:59Z`));
      const cutoff = new Date(Date.now() - 20 * 60_000);
      const endIso = (end > cutoff ? cutoff : end).toISOString();
      const startIso = `${query.from}T00:00:00Z`;

      const candles: Candle[] = [];
      let page: string | null = null;
      do {
        const params = new URLSearchParams({
          timeframe: tf,
          start: startIso,
          end: endIso,
          adjustment: "split",
          feed: "iex",
          limit: "10000",
          sort: "asc",
        });
        if (page) params.set("page_token", page);

        const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?${params}`;
        const res = await fetch(url, { headers });
        if (res.status === 404 || res.status === 422) {
          throw new SymbolNotSupportedError("alpaca", symbol, `HTTP ${res.status}`);
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            "Alpaca : clés invalides ou non autorisées (ALPACA_API_KEY / ALPACA_API_SECRET).",
          );
        }
        if (!res.ok) {
          throw new Error(`Alpaca a répondu ${res.status} pour ${symbol}.`);
        }
        const data = (await res.json()) as AlpacaBarsResponse;
        for (const b of data.bars ?? []) {
          candles.push({
            date: query.timeframe === "1h" ? new Date(b.t).toISOString() : b.t.slice(0, 10),
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
            volume: b.v,
          });
        }
        page = data.next_page_token ?? null;
      } while (page);

      if (candles.length === 0) {
        throw new SymbolNotSupportedError("alpaca", symbol, "aucune barre sur la plage");
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
        quote: "USD",
        interval: query.timeframe,
        source: "alpaca",
        assetType: query.assetType,
        candles: closed,
      };
    },
  };
}

/** Derniers cours US via Alpaca (snapshot) — pour le refresh live du portefeuille. */
export async function fetchAlpacaLatestPrices(
  symbols: string[],
  apiKey: string,
  apiSecret: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const us = [
    ...new Set(
      symbols
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{1,5}$/.test(s) && !s.includes(".")),
    ),
  ];
  if (us.length === 0) return out;

  const headers = {
    "APCA-API-KEY-ID": apiKey,
    "APCA-API-SECRET-KEY": apiSecret,
  };

  // Batches de 50 (limite pratique).
  for (let i = 0; i < us.length; i += 50) {
    const batch = us.slice(i, i + 50);
    const params = new URLSearchParams({
      symbols: batch.join(","),
      feed: "iex",
    });
    const url = `https://data.alpaca.markets/v2/stocks/snapshots?${params}`;
    const res = await fetch(url, { headers });
    if (!res.ok) continue;
    const data = (await res.json()) as Record<
      string,
      { latestTrade?: { p: number }; dailyBar?: { c: number }; prevDailyBar?: { c: number } }
    >;
    for (const [sym, snap] of Object.entries(data)) {
      const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? snap.prevDailyBar?.c;
      if (price != null && Number.isFinite(price)) out.set(sym.toUpperCase(), price);
    }
  }
  return out;
}

/** @internal — typage exporté pour les tests multi-bars. */
export type { AlpacaMultiBarsResponse };
