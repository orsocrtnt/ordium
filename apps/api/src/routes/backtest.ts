import type { FastifyInstance } from "fastify";
import { parseStrategy, runBacktest, toClassicDca, type BacktestResult } from "@ordium/engine";
import { fetchFearGreedHistory } from "@ordium/data";
import { buildRealSeries, type RealPortfolioSeries } from "@ordium/portfolio";
import { loadSeriesForAssets } from "../lib/data.js";
import { loadPortfolio, seriesForPortfolio } from "../lib/portfolio.js";

function strategyNeedsFearGreed(strategy: {
  timing_rules?: Array<{ type: string; trigger?: string }>;
}): boolean {
  return (strategy.timing_rules ?? []).some(
    (r) =>
      r.type === "fear_greed_below" ||
      (r.type === "extra_buy" && r.trigger === "fear_greed"),
  );
}

/** Garde ~maxPts points ; n'embarque `assets` que sur un sous-échantillon (détail scénario). */
function slimValueSeries<T extends { valueSeries: Array<{ date: string; value: number; contributed: number; assets?: unknown }> }>(
  r: T,
  maxPts = 280,
): T {
  const vs = r.valueSeries;
  const step = vs.length <= maxPts ? 1 : Math.ceil(vs.length / maxPts);
  const picked = vs.filter((_, i) => i % step === 0 || i === vs.length - 1);
  // 1 point sur ~5 avec breakdown actif → payload ~5× plus léger.
  const assetEvery = Math.max(1, Math.ceil(picked.length / 56));
  return {
    ...r,
    valueSeries: picked.map((p, i) => {
      if (i % assetEvery === 0 || i === picked.length - 1) return p;
      const { assets: _a, ...rest } = p;
      return rest;
    }),
  };
}

function slimReal(r: RealPortfolioSeries | null, maxPts = 280): RealPortfolioSeries | null {
  if (!r) return null;
  const pts = r.points;
  const step = pts.length <= maxPts ? 1 : Math.ceil(pts.length / maxPts);
  const picked = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const assetEvery = Math.max(1, Math.ceil(picked.length / 56));
  return {
    ...r,
    points: picked.map((p, i) => {
      if (i % assetEvery === 0 || i === picked.length - 1) return p;
      const { assets: _a, ...rest } = p;
      return rest;
    }),
  };
}

export async function backtestRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      strategy: unknown;
      from: string;
      to: string;
      feePct?: number;
      includePortfolio?: boolean;
    };
  }>("/api/backtest", async (req, reply) => {
    try {
      const body = req.body;
      // Budget = montant déclaré dans la stratégie (pas de calage netInvested).
      const strategy = parseStrategy(body.strategy);

      const smaPeriod = strategy.regime_adjustment?.sma_period ?? 200;
      // Jours calendaires ≈ 1.6 × jours de cotation pour couvrir la SMA.
      const warmupDays = Math.max(600, Math.ceil(smaPeriod * 1.7) + 40);

      const needFg = strategyNeedsFearGreed(strategy);
      const wantReal = Boolean(body.includePortfolio);
      const allocationSymbols = strategy.allocation.map((a) => a.asset);
      const referenceSymbol = strategy.regime_adjustment?.reference_asset?.trim() || null;

      // Charge toujours d'abord les actifs réellement achetés.
      // Si l'indice de référence externe échoue, on replie sans casser le backtest.
      const [baseSeries, fearGreedByDate, portfolio] = await Promise.all([
        loadSeriesForAssets(allocationSymbols, strategy.budget.currency, body.from, body.to, {
          warmupDays,
        }),
        needFg
          ? fetchFearGreedHistory(0).catch((e) => {
              console.warn("Fear & Greed history unavailable:", (e as Error).message);
              return undefined;
            })
          : Promise.resolve(undefined),
        wantReal ? loadPortfolio() : Promise.resolve(null),
      ]);
      let series = baseSeries;
      if (referenceSymbol && !allocationSymbols.includes(referenceSymbol)) {
        try {
          const [referenceSeries] = await loadSeriesForAssets(
            [referenceSymbol],
            strategy.budget.currency,
            body.from,
            body.to,
            { warmupDays },
          );
          if (referenceSeries) series = [...baseSeries, referenceSeries];
        } catch (e) {
          console.warn(
            `Reference asset ${referenceSymbol} unavailable, fallback to allocation:`,
            (e as Error).message,
          );
        }
      }

      const opts = {
        from: body.from,
        to: body.to,
        feePct: body.feePct ?? 0.1,
        fearGreedByDate,
      };
      const result = runBacktest(strategy, series, opts);
      const baseline = runBacktest(toClassicDca(strategy), series, opts);

      let real: RealPortfolioSeries | null = null;
      let realError: string | null = null;
      if (wantReal) {
        if (!portfolio) {
          realError = "Aucun portefeuille importé.";
        } else if (portfolio.transactions.length === 0) {
          realError =
            "Ce portefeuille n'a que des positions (pas de dates d'achat) : " +
            "importez un export de transactions pour activer la comparaison.";
        } else {
          try {
            // Fenêtre = période du backtest (pas depuis la 1ʳᵉ tx) + réutilise les séries déjà chargées.
            const { series: portfolioSeries } = await seriesForPortfolio(portfolio, body.from, {
              seed: series,
            });
            real = buildRealSeries(portfolio, portfolioSeries, body.from, body.to);
          } catch (err) {
            realError = (err as Error).message;
          }
        }
      }

      return {
        result: slimValueSeries(result) as BacktestResult,
        baseline: slimValueSeries(baseline) as BacktestResult,
        real: slimReal(real),
        realError,
        calibration: null,
      };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
