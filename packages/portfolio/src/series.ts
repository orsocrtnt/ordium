import type { AssetSeries } from "@ordium/engine";
import { transactionAmount } from "./valuation.js";
import type { Portfolio } from "./types.js";

export interface RealSeriesPoint {
  date: string;
  /** Valeur des positions au cours de clôture du jour. */
  value: number;
  /** Argent net investi jusqu'à ce jour (achats − ventes). */
  contributed: number;
  /** Mark-to-market et coût par actif. */
  assets?: Record<string, { value: number; invested: number }>;
}

export interface RealAssetResult {
  asset: string;
  quantity: number;
  invested: number;
  value: number;
  plPct: number | null;
}

export interface RealPortfolioSeries {
  points: RealSeriesPoint[];
  /** Date de la première transaction. */
  firstDate: string;
  netInvested: number;
  finalValue: number;
  roiPct: number;
  /** Snapshot final par actif. */
  perAsset: RealAssetResult[];
  /** Actifs du portefeuille sans données de marché (exclus de la valeur). */
  missingData: string[];
}

/**
 * Reconstruit jour par jour la valeur du portefeuille réel à partir de ses
 * transactions et des bougies du Market Data Engine — la même hypothèse de
 * valorisation au cours de clôture que le backtest, pour une comparaison
 * honnête. Fonction pure.
 */
export function buildRealSeries(
  portfolio: Portfolio,
  series: AssetSeries[],
  from: string,
  to: string,
): RealPortfolioSeries {
  if (portfolio.transactions.length === 0) {
    throw new Error(
      "Ce portefeuille n'a pas d'historique de transactions : la comparaison nécessite les dates d'achat.",
    );
  }

  const candlesBySymbol = new Map(series.map((s) => [s.symbol.toUpperCase(), s.candles]));
  const missingData = [
    ...new Set(
      portfolio.transactions
        .map((t) => t.asset.toUpperCase())
        .filter((a) => !candlesBySymbol.has(a)),
    ),
  ];

  // Union des jours de cotation dans [from, to].
  const datesSet = new Set<string>();
  for (const candles of candlesBySymbol.values()) {
    for (const c of candles) {
      if (c.date >= from && c.date <= to) datesSet.add(c.date);
    }
  }
  const dates = [...datesSet].sort();
  if (dates.length === 0) {
    throw new Error(`Aucune bougie disponible sur [${from}, ${to}] pour ce portefeuille.`);
  }

  const transactions = [...portfolio.transactions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const qty = new Map<string, number>();
  const investedByAsset = new Map<string, number>();
  let contributed = 0;
  let txIdx = 0;
  const applyTransactionsUpTo = (date: string) => {
    while (txIdx < transactions.length && transactions[txIdx]!.date <= date) {
      const t = transactions[txIdx]!;
      const asset = t.asset.toUpperCase();
      const sign = t.side === "buy" ? 1 : -1;
      const amount = transactionAmount(t) ?? 0;
      const prevQty = qty.get(asset) ?? 0;
      const nextQty = prevQty + sign * t.quantity;
      qty.set(asset, nextQty);
      if (t.side === "buy") {
        investedByAsset.set(asset, (investedByAsset.get(asset) ?? 0) + amount);
      } else if (prevQty > 1e-12) {
        // Réduit le coût au prorata des quantités vendues.
        const prevInv = investedByAsset.get(asset) ?? 0;
        const soldFrac = Math.min(1, t.quantity / prevQty);
        investedByAsset.set(asset, Math.max(0, prevInv * (1 - soldFrac)));
      }
      contributed += sign * amount;
      txIdx++;
    }
  };

  const lastClose = new Map<string, number>();
  const cursor = new Map<string, number>();
  const points: RealSeriesPoint[] = [];

  const snapshotAssets = (): Record<string, { value: number; invested: number }> => {
    const out: Record<string, { value: number; invested: number }> = {};
    for (const [asset, q] of qty) {
      if (q <= 1e-12) continue;
      out[asset] = {
        value: q * (lastClose.get(asset) ?? 0),
        invested: investedByAsset.get(asset) ?? 0,
      };
    }
    return out;
  };

  // Prend en compte tout ce qui s'est passé avant `from`.
  applyTransactionsUpTo(dates[0]!);

  for (const date of dates) {
    applyTransactionsUpTo(date);
    for (const [symbol, candles] of candlesBySymbol) {
      let p = cursor.get(symbol) ?? 0;
      while (p < candles.length && candles[p]!.date <= date) {
        lastClose.set(symbol, candles[p]!.close);
        p++;
      }
      cursor.set(symbol, p);
    }
    let value = 0;
    for (const [asset, q] of qty) {
      if (q > 1e-12) value += q * (lastClose.get(asset) ?? 0);
    }
    points.push({ date, value, contributed, assets: snapshotAssets() });
  }

  const netInvested = points[points.length - 1]!.contributed;
  const finalValue = points[points.length - 1]!.value;
  const perAsset: RealAssetResult[] = [...qty.entries()]
    .filter(([, q]) => q > 1e-12)
    .map(([asset, quantity]) => {
      const invested = investedByAsset.get(asset) ?? 0;
      const value = quantity * (lastClose.get(asset) ?? 0);
      return {
        asset,
        quantity,
        invested,
        value,
        plPct: invested > 0 ? ((value - invested) / invested) * 100 : null,
      };
    })
    .sort((a, b) => b.value - a.value);

  return {
    points,
    firstDate: transactions[0]!.date,
    netInvested,
    finalValue,
    roiPct: netInvested > 0 ? ((finalValue - netInvested) / netInvested) * 100 : 0,
    perAsset,
    missingData,
  };
}
