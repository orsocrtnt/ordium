import type { Condition, RuleDocument } from "@ordium/engine";

/** Quels overlays / panneaux afficher selon les règles de la stratégie. */
export type ChartSignals = {
  sma: boolean;
  bollinger: boolean;
  rsi: boolean;
  macd: boolean;
  fearGreed: boolean;
  dip: boolean;
  ath: boolean;
  drawdown: boolean;
  /** Seuils RSI à tracer sur le panneau. */
  rsiLevels: number[];
  /** Seuils Fear & Greed (gate / scale). */
  fearGreedLevels: number[];
  /** Libellés courts pour la légende. */
  labels: string[];
};

function emptySignals(): ChartSignals {
  return {
    sma: false,
    bollinger: false,
    rsi: false,
    macd: false,
    fearGreed: false,
    dip: false,
    ath: false,
    drawdown: false,
    rsiLevels: [],
    fearGreedLevels: [],
    labels: [],
  };
}

function walk(condition: Condition | undefined, acc: ChartSignals): void {
  if (!condition) return;
  if ("all" in condition) {
    for (const c of condition.all) walk(c, acc);
    return;
  }
  if ("any" in condition) {
    for (const c of condition.any) walk(c, acc);
    return;
  }
  if ("not" in condition) {
    walk(condition.not, acc);
    return;
  }

  switch (condition.type) {
    case "rsi": {
      acc.rsi = true;
      if (Number.isFinite(condition.value)) acc.rsiLevels.push(condition.value);
      break;
    }
    case "macd":
      acc.macd = true;
      break;
    case "bollinger":
      acc.bollinger = true;
      break;
    case "price_vs_sma":
      acc.sma = true;
      break;
    case "fear_greed": {
      acc.fearGreed = true;
      if (Number.isFinite(condition.value)) acc.fearGreedLevels.push(condition.value);
      break;
    }
    case "dip":
      acc.dip = true;
      break;
    case "new_ath":
      acc.ath = true;
      break;
    case "drawdown":
    case "rise":
      acc.drawdown = true;
      break;
    default:
      break;
  }
}

function uniqSorted(nums: number[]): number[] {
  return [...new Set(nums.map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b);
}

/**
 * Déduit les indicateurs à afficher à partir du document de règles compilé
 * (présent sur `BacktestResult.rules`).
 */
export function signalsFromRules(doc: RuleDocument | null | undefined): ChartSignals {
  const acc = emptySignals();
  if (!doc?.rules?.length) return acc;

  for (const rule of doc.rules) {
    walk(rule.if, acc);
  }

  acc.rsiLevels = uniqSorted(acc.rsiLevels);
  acc.fearGreedLevels = uniqSorted(acc.fearGreedLevels);

  const labels: string[] = [];
  if (acc.rsi) {
    labels.push(
      acc.rsiLevels.length
        ? `RSI (${acc.rsiLevels.map((v) => String(v)).join(" / ")})`
        : "RSI",
    );
  }
  if (acc.macd) labels.push("MACD");
  if (acc.bollinger) labels.push("Bollinger");
  if (acc.sma) labels.push("SMA");
  if (acc.fearGreed) {
    labels.push(
      acc.fearGreedLevels.length
        ? `Fear & Greed (${acc.fearGreedLevels.join(" / ")})`
        : "Fear & Greed",
    );
  }
  if (acc.dip) labels.push("Dip");
  if (acc.ath) labels.push("ATH");
  if (acc.drawdown) labels.push("Drawdown / hausse");
  acc.labels = labels;
  return acc;
}

/** Au moins un indicateur technique ou sentiment à afficher sur le chart. */
export function hasChartSignals(s: ChartSignals): boolean {
  return (
    s.sma ||
    s.bollinger ||
    s.rsi ||
    s.macd ||
    s.fearGreed ||
    s.dip ||
    s.ath ||
    s.drawdown
  );
}

/** Overlays prix : SMA / Bollinger utiles aussi pour dip / ATH / drawdown. */
export function overlaysForSignals(s: ChartSignals): {
  sma: boolean;
  bollinger: boolean;
  rsi: boolean;
  macd: boolean;
} {
  return {
    sma: s.sma || s.dip || s.ath || s.drawdown,
    bollinger: s.bollinger,
    rsi: s.rsi,
    macd: s.macd,
  };
}
