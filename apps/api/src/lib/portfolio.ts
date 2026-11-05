import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildFlatPriceSeries,
  canonicalMarketSymbol,
  defaultDataDir,
  fetchAlpacaLatestPrices,
  getHistoricalPrices,
  isUnlistedMarketSymbol,
} from "@ordium/data";
import type { AssetSeries } from "@ordium/engine";
import {
  valuePortfolio,
  type Portfolio,
  type PortfolioValuation,
} from "@ordium/portfolio";

/** Le portefeuille vit à côté du cache de bougies : data/portfolios/{user}.json */
function portfolioFile(userKey: string): string {
  const key = sanitizeUserKey(userKey);
  return path.join(path.dirname(defaultDataDir()), "portfolios", `${key}.json`);
}

function legacyDefaultFile(): string {
  return path.join(path.dirname(defaultDataDir()), "portfolios", "default.json");
}

function sanitizeUserKey(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "anon") return "anon";
  if (s === "demo") return "demo";
  return (
    s
      .replace(/@/g, "_at_")
      .replace(/[^a-z0-9._+-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 80) || "anon"
  );
}

export async function loadPortfolio(userKey = "anon"): Promise<Portfolio | null> {
  const key = sanitizeUserKey(userKey);
  const tryRead = async (file: string): Promise<Portfolio | null> => {
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as Portfolio;
      return rewriteKnownTickers(raw, key);
    } catch {
      return null;
    }
  };

  const primary = await tryRead(portfolioFile(key));
  if (primary) return primary;

  // Migration : l’ancien fichier unique default.json → compte démo uniquement.
  if (key === "demo") {
    return tryRead(legacyDefaultFile());
  }
  return null;
}

/** Corrige les tickers tronqués / inventés déjà sauvegardés (TAKE → TTWO, AINF.PA → AIAG.L…). */
function rewriteKnownTickers(portfolio: Portfolio, userKey: string): Portfolio {
  const mapAsset = (asset: string) => canonicalMarketSymbol(asset);
  let changed = false;
  const holdings = portfolio.holdings.map((h) => {
    const asset = mapAsset(h.asset);
    if (asset !== h.asset) changed = true;
    return asset === h.asset
      ? h
      : {
          ...h,
          asset,
          name:
            h.name ??
            (asset === "AIAG.L"
              ? "AI & Big Data"
              : asset === "URNM"
                ? "Uranium And Nuclear Tech"
                : h.name),
        };
  });
  const transactions = portfolio.transactions.map((t) => {
    const asset = mapAsset(t.asset);
    if (asset !== t.asset) changed = true;
    return asset === t.asset ? t : { ...t, asset };
  });
  if (!changed) return portfolio;
  const next = { ...portfolio, holdings, transactions };
  void savePortfolio(next, userKey);
  return next;
}

export async function savePortfolio(portfolio: Portfolio, userKey = "anon"): Promise<void> {
  const file = portfolioFile(userKey);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(portfolio, null, 2));
}

export async function deletePortfolio(userKey = "anon"): Promise<void> {
  await rm(portfolioFile(userKey), { force: true });
  // Si démo lisait encore default.json, on le retire aussi pour un vrai reset.
  if (sanitizeUserKey(userKey) === "demo") {
    await rm(legacyDefaultFile(), { force: true });
  }
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** True si on peut valoriser uniquement avec les chiffres du broker (pas de fetch marché). */
export function canUseImportedValuation(portfolio: Portfolio): boolean {
  if (portfolio.transactions.length > 0) return false;
  if (portfolio.holdings.length === 0) return false;
  return portfolio.holdings.every(
    (h) => (h.value != null && h.value > 0) || (h.price != null && h.quantity > 0),
  );
}

/**
 * Séries de prix pour les actifs du portefeuille, via le Market Data Engine.
 * Les actifs introuvables sont ignorés plutôt que de faire échouer tout l'appel.
 *
 * `lookbackDays` : fenêtre courte pour un snapshot — évite 10 ans d'historique à chaque import.
 * `seed` : séries déjà chargées (ex. stratégie) — on ne re-télécharge pas ces symboles.
 */
export async function seriesForPortfolio(
  portfolio: Portfolio,
  from: string,
  opts?: { lookbackDays?: number; seed?: AssetSeries[] },
): Promise<{ series: AssetSeries[]; errors: string[] }> {
  const assets = [
    ...new Set([
      ...portfolio.holdings.map((h) => h.asset),
      ...portfolio.transactions.map((t) => t.asset),
    ]),
  ];
  const yesterday = daysAgoIso(1);
  const lookbackFrom = opts?.lookbackDays != null ? daysAgoIso(opts.lookbackDays) : from;
  const effectiveFrom = lookbackFrom > from ? lookbackFrom : from;

  const seeded = new Map<string, AssetSeries>();
  for (const s of opts?.seed ?? []) {
    seeded.set(canonicalMarketSymbol(s.symbol), s);
  }

  const errors: string[] = [];
  const results = await Promise.all(
    assets.map(async (asset) => {
      const key = canonicalMarketSymbol(asset);
      const existing = seeded.get(key);
      if (existing) return existing;

      try {
        if (isUnlistedMarketSymbol(asset)) {
          const h = portfolio.holdings.find(
            (x) => canonicalMarketSymbol(x.asset) === canonicalMarketSymbol(asset),
          );
          const px =
            h?.price ??
            (h?.value != null && h.quantity > 0 ? h.value / h.quantity : undefined) ??
            h?.avgPrice;
          if (px == null || !(px > 0)) {
            errors.push(`${asset} : non coté et sans cours importé`);
            return null;
          }
          return buildFlatPriceSeries({
            symbol: asset,
            price: px,
            quote: portfolio.currency,
            from: effectiveFrom,
            to: yesterday,
            source: "imported",
          });
        }
        return await getHistoricalPrices(asset, undefined, "1d", effectiveFrom, yesterday, {
          quote: portfolio.currency,
        });
      } catch (err) {
        const h = portfolio.holdings.find(
          (x) => canonicalMarketSymbol(x.asset) === canonicalMarketSymbol(asset),
        );
        const px =
          h?.price ??
          (h?.value != null && h.quantity > 0 ? h.value / h.quantity : undefined) ??
          h?.avgPrice;
        if (px != null && px > 0) {
          return buildFlatPriceSeries({
            symbol: asset,
            price: px,
            quote: portfolio.currency,
            from: effectiveFrom,
            to: yesterday,
            source: "imported",
          });
        }
        errors.push(`${asset} : ${(err as Error).message.split("\n")[0]}`);
        return null;
      }
    }),
  );
  return { series: results.filter((s): s is AssetSeries => s != null), errors };
}

export interface PortfolioPayload {
  portfolio: Portfolio;
  valuation: PortfolioValuation;
  /** Date de première transaction (null si photo de positions). */
  firstTransactionDate: string | null;
  dataErrors: string[];
  /**
   * `imported` = totaux du broker/screenshot (rapide, cohérent avec la revue).
   * `market` = recalculé avec les cours live (plus lent, peut différer).
   */
  valuationSource: "imported" | "market";
}

export type PortfolioPayloadOpts = {
  /** Forcer le mode marché même si des valeurs d'import existent. */
  preferMarket?: boolean;
};

/**
 * Portefeuille + valorisation prêt pour l'UI.
 * Par défaut : si l'import fournit déjà valeur/cours, on les utilise sans Market Data
 * (évite 30+ fetchs × 10 ans qui bloquaient « Valider »).
 */
export async function portfolioPayload(
  portfolio: Portfolio,
  opts?: PortfolioPayloadOpts,
): Promise<PortfolioPayload> {
  const firstTx = portfolio.transactions[0]?.date ?? null;
  const useImported = !opts?.preferMarket && canUseImportedValuation(portfolio);

  if (useImported) {
    return {
      portfolio,
      valuation: valuePortfolio(portfolio, []),
      firstTransactionDate: firstTx,
      dataErrors: [],
      valuationSource: "imported",
    };
  }

  const from = firstTx ?? daysAgoIso(45);
  const { series, errors } = await seriesForPortfolio(portfolio, from, {
    lookbackDays: firstTx ? undefined : 45,
  });

  // Overlay cours live Alpaca (US) si clés présentes — le reste reste sur les bougies.
  const alpacaKey = process.env.ALPACA_API_KEY?.trim();
  const alpacaSecret = process.env.ALPACA_API_SECRET?.trim();
  let seriesForValuation = series;
  if (alpacaKey && alpacaSecret) {
    try {
      const live = await fetchAlpacaLatestPrices(
        portfolio.holdings.map((h) => h.asset),
        alpacaKey,
        alpacaSecret,
      );
      if (live.size > 0) {
        const today = new Date().toISOString().slice(0, 10);
        seriesForValuation = series.map((s) => {
          const px = live.get(s.symbol.toUpperCase());
          if (px == null) return s;
          const candles = [...s.candles];
          const last = candles[candles.length - 1];
          if (last && last.date >= today) {
            candles[candles.length - 1] = { ...last, close: px, high: Math.max(last.high, px), low: Math.min(last.low, px) };
          } else {
            candles.push({
              date: today,
              open: px,
              high: px,
              low: px,
              close: px,
              volume: 0,
            });
          }
          return { ...s, candles, source: "alpaca" };
        });
        // Actifs US absents des séries historiques mais cotés live.
        for (const [sym, px] of live) {
          if (seriesForValuation.some((s) => s.symbol.toUpperCase() === sym)) continue;
          seriesForValuation.push({
            symbol: sym,
            quote: "USD",
            interval: "1d",
            source: "alpaca",
            assetType: "stock",
            candles: [{ date: today, open: px, high: px, low: px, close: px, volume: 0 }],
          });
        }
      }
    } catch (err) {
      errors.push(`Alpaca live : ${(err as Error).message.split("\n")[0]}`);
    }
  }

  return {
    portfolio,
    valuation: valuePortfolio(portfolio, seriesForValuation),
    firstTransactionDate: firstTx,
    dataErrors: errors,
    valuationSource: "market",
  };
}
