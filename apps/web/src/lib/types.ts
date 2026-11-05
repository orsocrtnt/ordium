import type { Portfolio, PortfolioValuation } from "@ordium/portfolio";

/** Réponse API d'un portefeuille valorisé (miroir de apps/api). */
export interface PortfolioPayload {
  portfolio: Portfolio;
  valuation: PortfolioValuation;
  firstTransactionDate: string | null;
  dataErrors: string[];
  /** `imported` = chiffres broker ; `market` = cours live. */
  valuationSource?: "imported" | "market";
}
