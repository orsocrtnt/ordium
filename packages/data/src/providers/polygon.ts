import type { AssetSeries, Candle } from "@ordium/engine";
import { SymbolNotSupportedError, type FetchQuery, type MarketDataProvider } from "../types.js";

interface PolygonAggs {
  status?: string;
  resultsCount?: number;
  results?: { t: number; o: number; h: number; l: number; c: number; v: number }[];
}

/**
 * Polygon.io — fournisseur licencié pour le commercial, activé par clé API
 * (variable d'environnement POLYGON_API_KEY). Plan gratuit : 5 req/min,
 * ~2 ans d'historique, données US ajustées des splits. Avec un plan payant,
 * il suffira de remonter sa priorité au-dessus de Yahoo : zéro changement
 * au moteur — c'est tout l'intérêt de l'architecture en adaptateurs.
 */
export function createPolygonProvider(apiKey: string): MarketDataProvider {
  return {
    id: "polygon",
    capabilities: {
      assetTypes: ["stock", "etf", "crypto", "forex"],
      // Comme Yahoo : la crypto et le forex ne servent qu'en demande explicite.
      fallbackOnly: ["crypto", "forex"],
      timeframes: ["1d"],
      license: "commercial",
      rateLimits: { perMinute: 5 },
      priority: 30,
    },

    resolveSymbol(query: FetchQuery): string {
      const s = query.symbol.toUpperCase();
      if (query.assetType === "crypto") return `X:${s}${(query.quote ?? "USD").toUpperCase()}`;
      if (query.assetType === "forex") return `C:${s.replace("/", "")}`;
      return s;
    },

    async fetchCandles(query: FetchQuery): Promise<AssetSeries> {
      const ticker = this.resolveSymbol(query)!;
      const url =
        `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}` +
        `/range/1/day/${query.from}/${query.to}` +
        `?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey}`;
      const res = await fetch(url);
      if (res.status === 404) {
        throw new SymbolNotSupportedError("polygon", ticker, "HTTP 404");
      }
      if (!res.ok) {
        throw new Error(`Polygon a répondu ${res.status} pour ${ticker}.`);
      }
      const data = (await res.json()) as PolygonAggs;
      if (!data.results?.length) {
        throw new SymbolNotSupportedError("polygon", ticker, "aucune donnée sur la plage");
      }

      const candles: Candle[] = data.results.map((r) => ({
        date: new Date(r.t).toISOString().slice(0, 10),
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
      }));

      // On écarte la bougie du jour, potentiellement incomplète.
      const today = new Date().toISOString().slice(0, 10);
      return {
        symbol: query.symbol.toUpperCase(),
        quote: query.assetType === "crypto" ? (query.quote ?? "USD").toUpperCase() : "USD",
        interval: "1d",
        source: "polygon",
        assetType: query.assetType,
        candles: candles.filter((c) => c.date < today),
      };
    },
  };
}
