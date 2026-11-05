import type { ExecutionBroker } from "./types.js";

export type { ExecutionBroker };

/**
 * Cryptos Spot Binance connues (base sans quote).
 * Tout le reste (actions, ETF, indices…) → Alpaca.
 */
const CRYPTO_BASES = new Set([
  "BTC",
  "ETH",
  "BNB",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "DOT",
  "LINK",
  "MATIC",
  "POL",
  "UNI",
  "LTC",
  "ATOM",
  "NEAR",
  "APT",
  "ARB",
  "OP",
  "SUI",
  "PEPE",
  "SHIB",
  "TRX",
  "TON",
  "BCH",
  "XLM",
  "ALGO",
  "FIL",
  "ICP",
  "AAVE",
  "MKR",
  "CRV",
  "FTM",
  "EGLD",
  "HBAR",
  "VET",
  "INJ",
  "SEI",
  "TIA",
  "WLD",
  "RENDER",
  "FET",
  "IMX",
]);

/** Normalise un ticker pour le routage broker (suffixes quote / exchange). */
export function normalizeRouteSymbol(symbol: string): string {
  let s = symbol.trim().toUpperCase();
  // IWDA.AS, AAPL.US, BTC-EUR, BTC/USDT…
  s = s.replace(/[-/]/g, "");
  s = s.replace(/\.[A-Z]{1,4}$/g, "");
  s = s.replace(/(USDT|USDC|BUSD|FDUSD|TUSD|EUR|USD)$/g, "");
  return s || symbol.trim().toUpperCase();
}

/** Route un symbole vers un broker MVP. Crypto → Binance ; sinon Alpaca. */
export function routeBrokerForSymbol(symbol: string): ExecutionBroker {
  const s = symbol.trim().toUpperCase();
  const base = normalizeRouteSymbol(s);
  if (CRYPTO_BASES.has(base) || CRYPTO_BASES.has(s) || /(USDT|USDC)$/.test(s)) {
    return "binance";
  }
  return "alpaca";
}

export type StrategyAllocationLike = {
  allocation?: Array<{ asset?: string; weight?: number; pct?: number }>;
};

export type BrokerCompatResult = {
  ok: boolean;
  broker: ExecutionBroker;
  /** Actifs de l’allocation avec poids > 0. */
  assets: string[];
  /** Actifs incompatibles avec ce broker. */
  incompatible: string[];
  message?: string;
};

function allocationWeight(row: { weight?: number; pct?: number }): number {
  const w = Number(row.weight);
  if (Number.isFinite(w) && w > 0) return w;
  const pct = Number(row.pct);
  if (Number.isFinite(pct) && pct > 0) return pct > 1 ? pct / 100 : pct;
  return 0;
}

/**
 * Une strat n’est activable sur un broker que si TOUS ses actifs
 * (poids > 0) y sont négociables. Ex. Binance = crypto only.
 */
export function checkStrategyBrokerCompatibility(
  strategy: StrategyAllocationLike | null | undefined,
  broker: ExecutionBroker,
): BrokerCompatResult {
  const assets = (strategy?.allocation ?? [])
    .filter((a) => a && allocationWeight(a) > 0 && typeof a.asset === "string" && a.asset.trim())
    .map((a) => a.asset!.trim().toUpperCase());

  const unique = [...new Set(assets)];
  if (unique.length === 0) {
    return {
      ok: false,
      broker,
      assets: [],
      incompatible: [],
      message: "Allocation vide — ajoute des actifs avant d’activer.",
    };
  }

  const incompatible = unique.filter((a) => routeBrokerForSymbol(a) !== broker);
  if (incompatible.length === 0) {
    return { ok: true, broker, assets: unique, incompatible: [] };
  }

  const brokerLabel = broker === "binance" ? "Binance (crypto)" : "Alpaca (actions / ETF)";
  const hint =
    broker === "binance"
      ? "Sur Binance paper, seules les strats 100 % crypto sont activables."
      : "Sur Alpaca, seules les strats actions / ETF sont activables.";

  return {
    ok: false,
    broker,
    assets: unique,
    incompatible,
    message: `Incompatible avec ${brokerLabel} : ${incompatible.join(", ")}. ${hint}`,
  };
}
