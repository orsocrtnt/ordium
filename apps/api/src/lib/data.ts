import type { AssetSeries } from "@ordium/engine";
import {
  ASSET_TYPES,
  buildFlatPriceSeries,
  canonicalMarketSymbol,
  defaultDataDir,
  getHistoricalPrices,
  isUnlistedMarketSymbol,
  listAssets as listStoredAssets,
  type AssetInfo,
  type AssetType,
} from "@ordium/data";
import { loadPortfolio } from "./portfolio.js";

export type { AssetInfo };

/** Inventaire des séries en cache (pour l'éditeur de stratégie). */
export async function listAssets(): Promise<AssetInfo[]> {
  return listStoredAssets(defaultDataDir());
}

/**
 * Télécharge l'historique d'un actif via le Market Data Engine (fournisseur
 * gratuit choisi par le routeur) et le met en cache. Retourne son inventaire.
 */
export async function fetchAsset(
  symbol: string,
  assetType: string | undefined,
  preferredQuote: string,
): Promise<AssetInfo> {
  const type =
    assetType && (ASSET_TYPES as string[]).includes(assetType)
      ? (assetType as AssetType)
      : undefined;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const trimmed = symbol.trim();
  const canonical = canonicalMarketSymbol(trimmed);

  if (isUnlistedMarketSymbol(canonical)) {
    const fallback = await fallbackPriceFor(canonical);
    if (fallback == null) {
      throw new Error(
        `${canonical} n'est pas coté en bourse (marché privé). Importez un cours dans le portefeuille pour l'inclure au backtest.`,
      );
    }
    const series = buildFlatPriceSeries({
      symbol: canonical,
      price: fallback,
      quote: preferredQuote,
      from: "2015-01-01",
      to: yesterday,
      source: "imported",
    });
    return infoFromSeries(series);
  }

  const series = await getHistoricalPrices(trimmed, type, "1d", "2015-01-01", yesterday, {
    quote: preferredQuote,
    strictQuote: type === "crypto",
  });
  return infoFromSeries(series);
}

function infoFromSeries(series: AssetSeries): AssetInfo {
  return {
    symbol: series.symbol,
    quote: series.quote,
    source: series.source,
    assetType: series.assetType,
    firstDate: series.candles[0]!.date,
    lastDate: series.candles[series.candles.length - 1]!.date,
    candleCount: series.candles.length,
  };
}

/** Marge d'historique avant le début du backtest (SMA / RSI). */
export function warmupFrom(from: string, lookbackDays = 600): string {
  const days = Math.max(120, Math.ceil(lookbackDays));
  return new Date(Date.parse(`${from}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

async function fallbackPriceFor(symbol: string): Promise<number | null> {
  const portfolio = await loadPortfolio();
  if (!portfolio) return null;
  const target = canonicalMarketSymbol(symbol);
  for (const h of portfolio.holdings) {
    if (canonicalMarketSymbol(h.asset) !== target) continue;
    const px =
      h.price ??
      (h.value != null && h.quantity > 0 ? h.value / h.quantity : undefined) ??
      h.avgPrice;
    if (px != null && px > 0) return px;
  }
  return null;
}

export async function fallbackPricesFromPortfolio(): Promise<Record<string, number>> {
  const portfolio = await loadPortfolio();
  const out: Record<string, number> = {};
  if (!portfolio) return out;
  for (const h of portfolio.holdings) {
    const key = canonicalMarketSymbol(h.asset);
    const px =
      h.price ??
      (h.value != null && h.quantity > 0 ? h.value / h.quantity : undefined) ??
      h.avgPrice;
    if (px != null && px > 0) out[key] = px;
  }
  return out;
}

/**
 * Charge les séries des actifs demandés en privilégiant la devise du budget.
 * Actifs non cotés / introuvables : série plate depuis le cours importé si dispo.
 */
export async function loadSeriesForAssets(
  symbols: string[],
  preferredQuote: string,
  from: string,
  to: string,
  opts?: { fallbackPrices?: Record<string, number>; warmupDays?: number },
): Promise<AssetSeries[]> {
  const fallbacks = opts?.fallbackPrices ?? (await fallbackPricesFromPortfolio());
  const warmFrom = warmupFrom(from, opts?.warmupDays ?? 600);

  return Promise.all(
    symbols.map(async (symbol) => {
      const canonical = canonicalMarketSymbol(symbol);
      const fallback = fallbacks[canonical];

      if (isUnlistedMarketSymbol(canonical)) {
        if (fallback == null) {
          throw new Error(
            `${canonical} n'est pas coté : ajoutez un cours importé pour l'inclure au backtest.`,
          );
        }
        return buildFlatPriceSeries({
          symbol: canonical,
          price: fallback,
          quote: preferredQuote,
          from: warmFrom,
          to,
          source: "imported",
        });
      }

      const equityHint =
        /\.|^(AAPL|MSFT|NVDA|AMZN|GOOGL|META|TSLA|AVGO|ASML|TTE|KO|JNJ|PG|V|MA|CVX|CEG|TTWO|TSCO|D)$/i.test(
          symbol,
        ) || /^(IWDA|CSPX|SGLD|EIMI|BLCN|URNM|AIAG|HEAL|ENRG)/i.test(symbol);
      const type: AssetType | undefined = equityHint ? "stock" : undefined;

      try {
        return await getHistoricalPrices(symbol, type, "1d", warmFrom, to, {
          quote: preferredQuote,
        });
      } catch (err) {
        if (fallback != null && fallback > 0) {
          return buildFlatPriceSeries({
            symbol: canonical,
            price: fallback,
            quote: preferredQuote,
            from: warmFrom,
            to,
            source: "imported",
          });
        }
        throw err;
      }
    }),
  );
}
