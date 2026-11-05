import type { AssetSeries, Candle } from "@ordium/engine";
import { SymbolNotSupportedError, type FetchQuery, type MarketDataProvider } from "../types.js";

/** [time, open, high, low, close, vwap, volume, count] */
type KrakenOhlc = [number, string, string, string, string, string, string, number];

interface KrakenResponse {
  error: string[];
  result?: Record<string, KrakenOhlc[] | number>;
}

/** Vocabulaire Kraken : quelques actifs portent un autre code. */
const KRAKEN_ALIASES: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };

/**
 * L'endpoint OHLC de Kraken ne conserve que les ~720 dernières bougies par
 * timeframe : parfait pour les mises à jour quotidiennes, inutilisable pour
 * l'historique profond (le routeur passe alors au fournisseur suivant).
 */
const MAX_HISTORY_DAYS = 700;

/**
 * API publique Kraken (sans clé). Fallback crypto pour les données récentes,
 * avec de bonnes paires EUR. Limite structurelle : ~720 bougies journalières.
 */
export const krakenProvider: MarketDataProvider = {
  id: "kraken",
  capabilities: {
    assetTypes: ["crypto"],
    timeframes: ["1d"],
    license: "libre",
    rateLimits: { perSecond: 1 },
    priority: 14,
  },

  resolveSymbol(query: FetchQuery): string {
    const base = query.symbol.toUpperCase();
    return `${KRAKEN_ALIASES[base] ?? base}${(query.quote ?? "EUR").toUpperCase()}`;
  },

  async fetchCandles(query: FetchQuery): Promise<AssetSeries> {
    const pair = this.resolveSymbol(query)!;
    const oldestAvailable = Date.now() - MAX_HISTORY_DAYS * 86_400_000;
    if (Date.parse(`${query.from}T00:00:00Z`) < oldestAvailable) {
      throw new SymbolNotSupportedError(
        "kraken",
        pair,
        `l'OHLC Kraken ne remonte qu'à ~${MAX_HISTORY_DAYS} jours`,
      );
    }

    const since = Math.floor(Date.parse(`${query.from}T00:00:00Z`) / 1000) - 1;
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1440&since=${since}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Kraken a répondu ${res.status} pour ${pair}.`);
    }
    const data = (await res.json()) as KrakenResponse;
    if (data.error.length > 0) {
      const message = data.error.join(", ");
      if (message.includes("Unknown asset pair")) {
        throw new SymbolNotSupportedError("kraken", pair, message);
      }
      throw new Error(`Kraken a renvoyé une erreur pour ${pair} : ${message}`);
    }

    const rows = Object.entries(data.result ?? {}).find(([k]) => k !== "last")?.[1];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new SymbolNotSupportedError("kraken", pair, "réponse vide");
    }

    const endDate = query.to;
    const candles: Candle[] = rows.map((r) => ({
      date: new Date(r[0] * 1000).toISOString().slice(0, 10),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[6]),
    }));

    // On écarte la bougie du jour, encore incomplète.
    const today = new Date().toISOString().slice(0, 10);
    return {
      symbol: query.symbol.toUpperCase(),
      quote: (query.quote ?? "EUR").toUpperCase(),
      interval: "1d",
      source: "kraken",
      assetType: query.assetType,
      candles: candles.filter((c) => c.date < today && c.date >= query.from && c.date <= endDate),
    };
  },
};
