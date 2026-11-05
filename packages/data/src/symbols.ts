/**
 * Tickers mal formés / tronqués (OCR, Gemini) → symbole coté.
 * Module pur (pas de Node) — utilisable côté web et API.
 */
const MARKET_SYMBOL_ALIASES: Record<string, string> = {
  TAKE: "TTWO",
  TAKETWO: "TTWO",
  TRACTOR: "TSCO",
  IWDA: "IWDA.AS",
  CSPX: "CSPX.L",
  SGLD: "SGLD.L",
  EIMI: "EIMI.L",
  AINF: "AIAG.L",
  "AINF.PA": "AIAG.L",
  /** Nom produit / OCR → ETF Sprott Uranium Miners. */
  URANIUM: "URNM",
};

/**
 * Actifs sans cotation publique (marché privé, SPV broker…).
 * Pas de Yahoo/Binance : on utilise le cours importé en série plate.
 */
const UNLISTED_MARKET_SYMBOLS = new Set(["SPACEX"]);

export function canonicalMarketSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return MARKET_SYMBOL_ALIASES[s] ?? s;
}

/** True si l'actif n'a pas de ticker public (ex. SpaceX). */
export function isUnlistedMarketSymbol(symbol: string): boolean {
  return UNLISTED_MARKET_SYMBOLS.has(canonicalMarketSymbol(symbol));
}
