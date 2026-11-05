import type { AssetSeries } from "@ordium/engine";

/** Classes d'actifs couvertes par le Market Data Engine. */
export type AssetType = "crypto" | "stock" | "etf" | "index" | "forex" | "commodity";

export const ASSET_TYPES: AssetType[] = ["crypto", "stock", "etf", "index", "forex", "commodity"];

/** Journalier + horaire (charts live MVP). */
export type Timeframe = "1d" | "1h";

/** Statut de licence du fournisseur — voir la conception Market Data Engine. */
export type ProviderLicense = "libre" | "grise" | "non_commercial" | "commercial";

/**
 * Limites de débit réelles du fournisseur, à toutes les granularités.
 * Les fenêtres courtes (seconde, minute) provoquent une attente ;
 * les fenêtres longues (heure, jour, mois) provoquent un passage au
 * fournisseur suivant (quota épuisé).
 */
export interface RateLimits {
  perSecond?: number;
  perMinute?: number;
  perHour?: number;
  perDay?: number;
  perMonth?: number;
}

export interface ProviderCapabilities {
  assetTypes: AssetType[];
  timeframes: Timeframe[];
  /**
   * Classes que ce fournisseur sert uniquement en secours explicite,
   * jamais quand la classe d'actif est devinée (voir RouterFetchOptions).
   */
  fallbackOnly?: AssetType[];
  license: ProviderLicense;
  rateLimits: RateLimits;
  /** Plus petit = essayé en premier parmi les fournisseurs capables. */
  priority: number;
}

/** Requête de bougies telle que la voit un fournisseur. */
export interface FetchQuery {
  /** Symbole canonique : BTC, SPY, MC.PA, ^GSPC, EUR/USD… */
  symbol: string;
  assetType: AssetType;
  timeframe: Timeframe;
  /** Début inclus, YYYY-MM-DD. */
  from: string;
  /** Fin incluse, YYYY-MM-DD. */
  to: string;
  /** Devise de cotation souhaitée (surtout pour la crypto). */
  quote?: string;
}

/**
 * Un fournisseur de données de marché. Chaque adaptateur (~80 lignes)
 * implémente cette interface ; le reste du système ne connaît qu'elle.
 * Ajouter un fournisseur payant plus tard = un adaptateur de plus.
 */
export interface MarketDataProvider {
  id: string;
  capabilities: ProviderCapabilities;
  /**
   * Traduit le symbole canonique dans le vocabulaire du fournisseur
   * (BTC → "BTCEUR" chez Binance, or → "GC=F" chez Yahoo).
   * Retourne null si le fournisseur ne sait pas servir cet actif.
   */
  resolveSymbol(query: FetchQuery): string | null;
  /** Récupère les bougies. Doit exclure la bougie du jour, incomplète. */
  fetchCandles(query: FetchQuery): Promise<AssetSeries>;
}

/** Métadonnées d'une série en cache (éditeur de stratégie, CLI). */
export interface AssetInfo {
  symbol: string;
  quote: string;
  source?: string;
  assetType?: string;
  firstDate: string;
  lastDate: string;
  candleCount: number;
}

/** Quota longue durée épuisé : le routeur passe au fournisseur suivant. */
export class QuotaExceededError extends Error {
  constructor(providerId: string, window: string) {
    super(`Quota ${window} épuisé pour ${providerId}.`);
    this.name = "QuotaExceededError";
  }
}

/**
 * Le fournisseur ne connaît pas ce symbole (400, 404, réponse vide).
 * Le routeur passe au suivant sans pénaliser le circuit breaker :
 * un symbole inconnu n'est pas une panne.
 */
export class SymbolNotSupportedError extends Error {
  constructor(providerId: string, symbol: string, detail?: string) {
    super(`${providerId} ne connaît pas ${symbol}${detail ? ` (${detail})` : ""}.`);
    this.name = "SymbolNotSupportedError";
  }
}
