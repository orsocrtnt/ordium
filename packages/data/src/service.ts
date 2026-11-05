import type { AssetSeries, Candle } from "@ordium/engine";
import { binanceProvider } from "./providers/binance.js";
import { coinbaseProvider } from "./providers/coinbase.js";
import { krakenProvider } from "./providers/kraken.js";
import { createAlpacaProvider } from "./providers/alpaca.js";
import { createPolygonProvider } from "./providers/polygon.js";
import { yahooProvider } from "./providers/yahoo.js";
import { DataRouter } from "./router.js";
import { defaultDataDir, loadSeries, saveSeries } from "./store.js";
import { canonicalMarketSymbol } from "./symbols.js";
import { ASSET_TYPES, type AssetType, type Timeframe } from "./types.js";

export { canonicalMarketSymbol } from "./symbols.js";

let sharedRouter: DataRouter | undefined;

/**
 * Routeur par défaut — APIs officielles en priorité :
 * - Crypto : Binance → Coinbase → Kraken
 * - Actions/ETF US : Alpaca (si clés) → Polygon (si clé) → Yahoo (secours EU / sans clé)
 */
export function defaultRouter(): DataRouter {
  if (!sharedRouter) {
    const providers = [binanceProvider, coinbaseProvider, krakenProvider];

    const alpacaKey = process.env.ALPACA_API_KEY?.trim();
    const alpacaSecret = process.env.ALPACA_API_SECRET?.trim();
    if (alpacaKey && alpacaSecret) {
      providers.push(createAlpacaProvider(alpacaKey, alpacaSecret));
    }

    const polygonKey = process.env.POLYGON_API_KEY?.trim();
    if (polygonKey) providers.push(createPolygonProvider(polygonKey));

    // Secours pour ETF EU (MC.PA, IWDA.AS…) et si aucune clé Alpaca/Polygon.
    providers.push(yahooProvider);

    sharedRouter = new DataRouter(providers);
  }
  return sharedRouter;
}

/** Invalide le singleton (tests / reload env). */
export function resetDefaultRouter(): void {
  sharedRouter = undefined;
}

export interface GetPricesOptions {
  /** Devise de cotation souhaitée (détermine la paire pour la crypto). */
  quote?: string;
  /**
   * true : exige une série dans la devise `quote` (nouvelle série sinon).
   * false (défaut) : accepte une série en cache dans une autre devise —
   * le moteur gère la conversion via son garde-fou de devise.
   */
  strictQuote?: boolean;
  dataDir?: string;
  router?: DataRouter;
}

function addDays(date: string, days: number): string {
  const day = date.slice(0, 10);
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

/** Borne basse inclusive pour slice (from = YYYY-MM-DD). */
function sliceFromBound(from: string): string {
  return from.length <= 10 ? `${from.slice(0, 10)}T00:00:00.000Z` : from;
}

/** Borne haute inclusive pour slice (to = YYYY-MM-DD). */
function sliceToBound(to: string): string {
  return to.length <= 10 ? `${to.slice(0, 10)}T23:59:59.999Z` : to;
}

/** Fusionne deux jeux de bougies (les nouvelles écrasent les anciennes par date). */
function mergeCandles(oldCandles: Candle[], newCandles: Candle[]): Candle[] {
  const byDate = new Map<string, Candle>();
  for (const c of oldCandles) byDate.set(c.date, c);
  for (const c of newCandles) byDate.set(c.date, c);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function slice(series: AssetSeries, from: string, to: string): AssetSeries {
  if (series.interval === "1h") {
    const lo = sliceFromBound(from);
    const hi = sliceToBound(to);
    return {
      ...series,
      candles: series.candles.filter((c) => c.date >= lo && c.date <= hi),
    };
  }
  return { ...series, candles: series.candles.filter((c) => c.date >= from && c.date <= to) };
}

/** Classes d'actifs à essayer quand l'appelant ne connaît pas le type. */
function looksLikeEquitySymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  if (s.includes(".") || s.startsWith("^") || s.endsWith("=X") || s.endsWith("=F")) return true;
  if (/\.(PA|L|AS|DE|MI|MC|SW|HK|T)$/.test(s)) return true;
  // Alias connu ou ticker US courant (évite Binance sur TAKE/TTWO/AAPL…).
  if (canonicalMarketSymbol(s) !== s) return true;
  if (
    /^(AAPL|MSFT|NVDA|AMZN|GOOGL|META|TSLA|AVGO|ASML|TTE|KO|JNJ|PG|V|MA|CVX|CEG|TTWO|TSCO|BLCN|URNM|SPY|QQQ|AIAG)$/.test(
      s,
    )
  ) {
    return true;
  }
  return false;
}

function typesToTry(assetType: AssetType | undefined, cached: AssetSeries | null, symbol: string): AssetType[] {
  if (assetType) return [assetType];
  if (cached?.assetType && (ASSET_TYPES as string[]).includes(cached.assetType)) {
    return [cached.assetType as AssetType];
  }
  // Cache hérité de la phase 0 : la source trahit la classe.
  if (cached?.source === "binance") return ["crypto"];
  if (cached?.source === "yahoo") return ["stock"];
  // Actions/ETF (MC.PA, IWDA.AS…) : Yahoo d'abord, pas Binance.
  if (looksLikeEquitySymbol(symbol)) return ["stock", "etf", "crypto"];
  return ["crypto", "stock"];
}

/**
 * La seule porte d'entrée du moteur et des apps vers les données de marché.
 *
 * Lecture "read-through" : store local d'abord, puis fetch du delta manquant
 * via le routeur (fournisseurs gratuits avec fallback automatique), fusion et
 * sauvegarde. L'appelant ne sait jamais quel fournisseur a servi la donnée.
 */
export async function getHistoricalPrices(
  symbol: string,
  assetType: AssetType | undefined,
  timeframe: Timeframe,
  from: string,
  to: string,
  opts: GetPricesOptions = {},
): Promise<AssetSeries> {
  const canonical = canonicalMarketSymbol(symbol);
  const dir = opts.dataDir ?? defaultDataDir();
  const router = opts.router ?? defaultRouter();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = addDays(today, -1);
  // Daily : jusqu’à hier (bougie du jour incomplète). Hourly : jusqu’à aujourd’hui (filtre côté provider).
  const end = timeframe === "1h" ? (to < today ? to : today) : to < yesterday ? to : yesterday;

  let cached = await loadSeries(dir, canonical, opts.quote, timeframe);
  if (cached && opts.strictQuote && opts.quote && cached.quote !== opts.quote.toUpperCase()) {
    cached = null;
  }
  // Ne pas mélanger TF dans le cache.
  if (cached && cached.interval !== timeframe) cached = null;

  // Cache complet pour la plage demandée : zéro appel API.
  if (cached && cached.candles.length > 0) {
    const first = cached.candles[0]!.date;
    const last = cached.candles[cached.candles.length - 1]!.date;
    const coverFrom = timeframe === "1h" ? sliceFromBound(from) : from;
    const coverTo = timeframe === "1h" ? sliceToBound(end) : end;
    if (first <= coverFrom && last >= coverTo) return slice(cached, from, to);
  }

  // Delta à récupérer : tout si le cache ne remonte pas assez loin,
  // sinon uniquement les bougies postérieures au cache.
  const cachedFirst = cached?.candles[0]?.date;
  const cachedLast = cached?.candles[cached.candles.length - 1]?.date;
  let fetchFrom = from;
  if (cached && cachedFirst && cachedLast) {
    const coverFrom = timeframe === "1h" ? sliceFromBound(from) : from;
    if (cachedFirst <= coverFrom) {
      fetchFrom =
        timeframe === "1h"
          ? addHours(cachedLast, 1).slice(0, 10)
          : addDays(cachedLast.slice(0, 10), 1);
    }
  }

  const errors: string[] = [];
  const types = typesToTry(assetType, cached, canonical);
  // Plusieurs classes candidates = pure hypothèse : le routeur écarte alors
  // les fournisseurs qui ne servent une classe qu'en secours explicite.
  const guessed = types.length > 1;
  for (const type of types) {
    try {
      const fetched = await router.fetch(
        {
          symbol: canonical,
          assetType: type,
          timeframe,
          from: fetchFrom,
          to: end,
          // On prolonge une série existante dans SA devise, jamais dans une autre.
          quote: cached?.quote ?? opts.quote,
        },
        { guessed },
      );
      const merged: AssetSeries = cached
        ? {
            ...cached,
            symbol: canonical,
            interval: timeframe,
            assetType: cached.assetType ?? type,
            candles: mergeCandles(cached.candles, fetched.candles),
          }
        : { ...fetched, symbol: canonical, interval: timeframe };
      if (merged.candles.length === 0) {
        throw new Error(`Aucune bougie récupérée pour ${canonical} sur [${fetchFrom} → ${end}].`);
      }
      await saveSeries(dir, merged);
      return slice(merged, from, to);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  // Les fournisseurs n'ont rien de plus (ex. week-end) : on sert le cache.
  if (cached && cached.candles.length > 0) return slice(cached, from, to);
  const label =
    canonical !== symbol.toUpperCase() ? `${canonical} (depuis ${symbol})` : canonical;
  throw new Error(`Impossible de récupérer ${label} :\n- ${errors.join("\n- ")}`);
}
