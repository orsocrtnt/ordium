import type { AssetSeries } from "@ordium/engine";
import type { Portfolio, Transaction } from "./types.js";

export interface PositionValuation {
  asset: string;
  quantity: number;
  /** Dernier cours connu (null si aucune donnée de marché fournie). */
  lastPrice: number | null;
  value: number | null;
  weightPct: number | null;
  /** Coût moyen pondéré (méthode du coût moyen), null si inconnu. */
  avgCost: number | null;
  invested: number | null;
  plPct: number | null;
}

export interface PortfolioValuation {
  currency: string;
  totalValue: number;
  /** Montant net investi (achats − ventes), null si les montants manquent. */
  netInvested: number | null;
  plPct: number | null;
  positions: PositionValuation[];
  /** Actifs sans données de marché (non valorisés). */
  missingData: string[];
}

/** Montant d'une transaction : explicite, sinon quantité × prix. */
export function transactionAmount(t: Transaction): number | null {
  if (t.amount != null) return t.amount;
  if (t.price != null) return t.quantity * t.price;
  return null;
}

interface CostBasis {
  quantity: number;
  cost: number;
  complete: boolean;
}

/** Coût moyen par actif (les ventes sortent au coût moyen courant). */
export function costBasisByAsset(transactions: Transaction[]): Map<string, CostBasis> {
  const basis = new Map<string, CostBasis>();
  for (const t of [...transactions].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const b = basis.get(t.asset) ?? { quantity: 0, cost: 0, complete: true };
    const amount = transactionAmount(t);
    if (t.side === "buy") {
      b.quantity += t.quantity;
      if (amount != null) b.cost += amount;
      else b.complete = false;
    } else {
      if (b.quantity > 1e-12) {
        b.cost -= b.cost * Math.min(1, t.quantity / b.quantity);
      }
      b.quantity = Math.max(0, b.quantity - t.quantity);
    }
    basis.set(t.asset, b);
  }
  return basis;
}

/**
 * Valorise un portefeuille avec les séries de prix fournies par le
 * Market Data Engine. Fonction pure : aucune requête réseau ici.
 */
export function valuePortfolio(portfolio: Portfolio, series: AssetSeries[]): PortfolioValuation {
  const lastCloseBySymbol = new Map<string, number>();
  for (const s of series) {
    const last = s.candles[s.candles.length - 1];
    if (last) lastCloseBySymbol.set(s.symbol.toUpperCase(), last.close);
  }

  const basis = costBasisByAsset(portfolio.transactions);
  const missingData: string[] = [];

  const positions: PositionValuation[] = portfolio.holdings.map((h) => {
    const marketPrice = lastCloseBySymbol.get(h.asset.toUpperCase()) ?? null;
    const lastPrice = marketPrice ?? h.price ?? null;
    if (marketPrice == null && h.value == null && h.price == null) missingData.push(h.asset);
    const value =
      marketPrice != null
        ? h.quantity * marketPrice
        : (h.value ?? (h.price != null ? h.quantity * h.price : null));
    const b = basis.get(h.asset);
    const investedFromTx = b && b.complete && b.quantity > 1e-12 ? b.cost : null;
    const invested = investedFromTx ?? h.invested ?? null;
    const avgCost =
      investedFromTx != null && b!.quantity > 1e-12
        ? b!.cost / b!.quantity
        : (h.avgPrice ?? (invested != null && h.quantity > 0 ? invested / h.quantity : null));
    const plPct =
      value != null && invested != null && invested > 0
        ? ((value - invested) / invested) * 100
        : (h.pnlPct ?? null);
    return {
      asset: h.asset,
      quantity: h.quantity,
      lastPrice,
      value,
      weightPct: null, // rempli après le total
      avgCost,
      invested,
      plPct,
    };
  });

  const totalValue = positions.reduce((s, p) => s + (p.value ?? 0), 0);
  for (const p of positions) {
    p.weightPct = p.value != null && totalValue > 0 ? (p.value / totalValue) * 100 : null;
  }

  let netInvested: number | null = 0;
  for (const t of portfolio.transactions) {
    const amount = transactionAmount(t);
    if (amount == null) {
      netInvested = null;
      break;
    }
    netInvested += t.side === "buy" ? amount : -amount;
  }
  if (portfolio.transactions.length === 0) {
    const fromHoldings = portfolio.holdings.reduce(
      (acc, h) => {
        if (acc == null) return null;
        if (h.invested == null) return null;
        return acc + h.invested;
      },
      0 as number | null,
    );
    netInvested = fromHoldings;
  }

  return {
    currency: portfolio.currency,
    totalValue,
    netInvested,
    plPct:
      netInvested != null && netInvested > 0
        ? ((totalValue - netInvested) / netInvested) * 100
        : null,
    positions: positions.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    missingData,
  };
}
