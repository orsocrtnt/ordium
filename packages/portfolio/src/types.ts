export type TransactionSide = "buy" | "sell";

/** Une transaction normalisée, quelle que soit la source d'import. */
export interface Transaction {
  /** YYYY-MM-DD (UTC). */
  date: string;
  side: TransactionSide;
  /** Symbole canonique de l'actif : BTC, ETH, AAPL… */
  asset: string;
  quantity: number;
  /** Prix unitaire dans la devise de la transaction. */
  price?: number;
  /** Montant total (frais inclus) ; reconstruit depuis quantity×price si absent. */
  amount?: number;
  fee?: number;
  /** Devise du montant (EUR, USD, USDT…). */
  currency?: string;
}

/** Une position actuelle. */
export interface Holding {
  /** Ticker canonique : NVDA, AAPL, IWDA… */
  asset: string;
  quantity: number;
  /** Nom complet affiché (ex. "NVIDIA"), issu de l'import. */
  name?: string;
  /** Dernier cours unitaire vu à l'import. */
  price?: number;
  /** Prix de revient unitaire (PRU). */
  avgPrice?: number;
  /** Montant investi / coût d'acquisition. */
  invested?: number;
  /** Valeur de marché actuelle. */
  value?: number;
  /** Plus/moins-value absolue (value − invested). */
  pnl?: number;
  /** Plus/moins-value en pourcentage. */
  pnlPct?: number;
}

export type PortfolioSource =
  | "csv"
  | "xlsx"
  | "binance"
  | "kraken"
  | "coinbase"
  | "alpaca"
  | "trading212"
  | "ibkr"
  | "manual";

/**
 * Le portefeuille recréé dans Ordium. Deux niveaux de richesse :
 * avec transactions (dates + montants) → comparaison complète au backtest ;
 * avec positions seules → valorisation + répartition uniquement.
 */
export interface Portfolio {
  name: string;
  /** Devise de référence pour la valorisation. */
  currency: string;
  source: PortfolioSource;
  importedAt: string;
  transactions: Transaction[];
  holdings: Holding[];
  /** Avertissements d'import (lignes ignorées, trésorerie exclue…). */
  warnings: string[];
}

/** Devises/stablecoins traités comme de la trésorerie, pas comme des actifs. */
export const CASH_ASSETS = new Set([
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "USDT",
  "USDC",
  "BUSD",
  "DAI",
  "TUSD",
  "EURC",
]);

/** Reconstruit les positions actuelles depuis l'historique de transactions. */
export function holdingsFromTransactions(transactions: Transaction[]): Holding[] {
  const qty = new Map<string, number>();
  for (const t of transactions) {
    const current = qty.get(t.asset) ?? 0;
    qty.set(t.asset, current + (t.side === "buy" ? t.quantity : -t.quantity));
  }
  return [...qty.entries()]
    .filter(([, q]) => q > 1e-9)
    .map(([asset, quantity]) => ({ asset, quantity }))
    .sort((a, b) => a.asset.localeCompare(b.asset));
}
