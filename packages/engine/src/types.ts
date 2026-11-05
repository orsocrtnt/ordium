/** Bougie OHLCV.
 * - `1d` : `date` = `YYYY-MM-DD` (UTC)
 * - `1h` : `date` = ISO datetime UTC (`2024-01-15T14:00:00.000Z`)
 */
export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Série de bougies pour un actif, dans une devise de cotation donnée. */
export interface AssetSeries {
  symbol: string;
  quote: string;
  interval: "1d" | "1h";
  source?: string;
  /** Classe d'actif (crypto, stock, etf…), renseignée par la couche data. */
  assetType?: string;
  candles: Candle[];
}

export type Regime = "bull" | "neutral" | "bear";

export type PurchaseKind = "trigger" | "scheduled" | "fallback" | "extra";

/**
 * Justificatif auditable d’un montant : pourquoi ce versement / cette part,
 * avec les variables figées au moment du calcul (règles inviolables).
 */
export interface AmountJustification {
  /** Phrase courte FR, ex. « 230 € = 200 × 1,15 (baissier) ». */
  summary: string;
  baseBudget: number;
  multiplier: number;
  regime: Regime;
  /** Budget de la fenêtre après régime (= base × mult), borné par l’enveloppe. */
  windowBudget: number;
  envelopeMin: number;
  envelopeMax: number;
  /** Poids de l’actif dans l’allocation (0–1), si part d’actif. */
  assetWeight?: number;
  /** Fraction de tranche (ex. 1/3), si fractionnement. */
  trancheFraction?: number;
  /** true si le montant a été réduit (réserve, plafond fenêtre…). */
  clipped?: boolean;
  formula: string;
}

/** Un achat exécuté, toujours rattaché à la règle qui l'a déclenché. */
export interface Purchase {
  date: string;
  asset: string;
  /** Montant dépensé en devise de cotation (frais inclus). */
  quoteAmount: number;
  fee: number;
  quantity: number;
  price: number;
  kind: PurchaseKind;
  reason: string;
  windowKey: string;
  /** Pourquoi ce montant (variables du moment). */
  justification?: AmountJustification;
}

export interface SkippedBuy {
  date: string;
  asset: string;
  plannedAmount: number;
  reason: string;
  windowKey: string;
}
