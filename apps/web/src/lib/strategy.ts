/**
 * État de l'éditeur côté client, et sa conversion vers le document de stratégie
 * (la "recette" JSON interprétée par le moteur, cf. packages/engine).
 */

import { calibrateStrategyBudget, classicOff, horizonToDates, parseStrategy } from "@ordium/engine";
import { normalizeAsset } from "@ordium/portfolio/normalize";
import type { PortfolioPayload } from "./types";

/** Alias tickers côté client (évite les barrels Node : fs/crypto). */
function canonicalMarketSymbol(symbol: string): string {
  return normalizeAsset(symbol);
}

export interface AllocationRow {
  asset: string;
  pct: number;
}

export interface ScaleTierRow {
  gtePct: number;
  factor: number;
}

export interface ExtraBuyRow {
  trigger: "rsi_below" | "dip" | "fear_greed" | "macd" | "bollinger";
  value: number;
  pctOfBudget: number;
  cooldownDays: number;
}

export type BacktestHorizon = "1y" | "3y" | "since_first_buy" | "custom";

/** Mode d’un indicateur signal : off / acheter si / ajuster budget. */
export type IndicatorMode = "off" | "gate" | "scale";

export function indicatorMode(gateEnabled: boolean, scaleEnabled: boolean): IndicatorMode {
  if (scaleEnabled) return "scale";
  if (gateEnabled) return "gate";
  return "off";
}

/** Indice de référence du régime par défaut (hors allocation OK). */
export const DEFAULT_REGIME_REFERENCE = "IWDA.AS";
export const DEFAULT_REGIME_REFERENCE_LABEL = "MSCI World";

export interface EditorState {
  budgetAmount: number;
  currency: string;
  period: "weekly" | "monthly";
  windowFrom: number;
  windowTo: number;
  allocation: AllocationRow[];
  tranches: number;
  distribution: "equal" | "random";
  regimeEnabled: boolean;
  bullMult: number;
  bearMult: number;
  /** Multiplicateur en régime neutre (prix dans la bande). */
  neutralMult: number;
  /** Zone neutre autour de la SMA, en % (ex. 2 → ±2 %). */
  regimeBandPct: number;
  /** Période de la SMA pour détecter haussier / baissier. */
  regimeSmaPeriod: number;
  /**
   * `per_asset` : chaque actif juge sa propre SMA (défaut).
   * `reference` : un indice/actif unique pilote tout le portefeuille.
   */
  regimeScope: "per_asset" | "reference";
  /**
   * Actif de référence pour le régime (uniquement si regimeScope = reference).
   * Défaut : {@link DEFAULT_REGIME_REFERENCE} (MSCI World).
   * "" = utiliser le plus gros poids de l’allocation (choix explicite).
   */
  regimeReferenceAsset: string;
  /**
   * Fin de fenêtre sans signal : verser le budget neutre (souvent ×1),
   * pas le multiplicateur haussier/baissier.
   */
  fallbackNeutral: boolean;
  /**
   * Acheter uniquement si un déclencheur (gate) a matché — pas de rattrapage
   * silencieux en fin de fenêtre.
   */
  requireSignal: boolean;
  dipEnabled: boolean;
  dipPct: number;
  dipScaleEnabled: boolean;
  dipDeepGte: number;
  dipDeepFactor: number;
  dipCalmLt: number;
  dipCalmFactor: number;
  rsiEnabled: boolean;
  rsiValue: number;
  rsiScaleEnabled: boolean;
  rsiLowLte: number;
  rsiLowFactor: number;
  rsiHighGte: number;
  rsiHighFactor: number;
  fearGreedEnabled: boolean;
  fearGreedValue: number;
  /**
   * Module le budget selon Fear & Greed (pas un veto d’achat) :
   * ≤ low → ×lowFactor ; ≥ high → ×highFactor ; sinon ×1.
   */
  fearGreedScaleEnabled: boolean;
  fearGreedLowLte: number;
  fearGreedLowFactor: number;
  fearGreedHighGte: number;
  fearGreedHighFactor: number;
  macdEnabled: boolean;
  macdScaleEnabled: boolean;
  macdPosFactor: number;
  macdNegFactor: number;
  bollingerEnabled: boolean;
  bollingerPctB: number;
  bollingerScaleEnabled: boolean;
  bollingerLowLte: number;
  bollingerLowFactor: number;
  bollingerHighGte: number;
  bollingerHighFactor: number;
  smaBuyEnabled: boolean;
  smaBuyPeriod: number;
  smaScaleEnabled: boolean;
  smaBelowFactor: number;
  smaAboveFactor: number;
  athEnabled: boolean;
  athLookback: number;
  reserveEnabled: boolean;
  reservePct: number;
  /** Paliers de drawdown (depuis ATH) → multiplicateur budget. */
  ddTiersEnabled: boolean;
  ddTiers: ScaleTierRow[];
  /** Paliers de hausse (depuis plus bas) → multiplicateur budget. */
  riseTiersEnabled: boolean;
  riseTiers: ScaleTierRow[];
  tierLookback: number;
  /** Volatilité : veto / scale / gate (n’acheter que si vol basse). */
  volEnabled: boolean;
  volPeriod: number;
  volMaxPct: number;
  volMode: "veto" | "scale" | "gate";
  volScaleFactor: number;
  /** Achats exceptionnels répétés (hors DCA). */
  extraBuysEnabled: boolean;
  extraBuys: ExtraBuyRow[];
  from: string;
  to: string;
  feePct: number;
  /** Horizon backtest choisi dans le chat (null = pas encore fixé). */
  horizon: BacktestHorizon | null;
  /**
   * Réponse chat « mêmes actifs que le portefeuille ? ».
   * portfolio → quiz à la simulation ; custom → allocation chat, pas de quiz.
   */
  assetsChoice?: "portfolio" | "custom";
  /** Clarification montant unique multi-actifs : total vs par actif. */
  budgetSplit?: "total" | "per_asset";
  /** Montant cité avant ×n (si budgetSplit = per_asset). */
  budgetQuotedAmount?: number;
  allocationMode?: "replace" | "add";
  assetClassPolicy?: "mixed_ok" | "crypto_only" | "equity_only";
}

export const DEFAULT_STATE: EditorState = {
  budgetAmount: 1000,
  currency: "EUR",
  period: "monthly",
  windowFrom: 1,
  windowTo: 7,
  // Démo crypto uniquement s'il n'y a PAS encore de portefeuille importé.
  // Les nouvelles stratégies partent sans allocation forcée (questionnaire).
  allocation: [],
  tranches: 3,
  distribution: "equal",
  regimeEnabled: true,
  bullMult: 0.7,
  bearMult: 1.5,
  neutralMult: 1,
  regimeBandPct: 2,
  regimeSmaPeriod: 200,
  regimeScope: "per_asset",
  regimeReferenceAsset: DEFAULT_REGIME_REFERENCE,
  fallbackNeutral: true,
  requireSignal: false,
  dipEnabled: true,
  dipPct: 3,
  dipScaleEnabled: false,
  dipDeepGte: 3,
  dipDeepFactor: 2,
  dipCalmLt: 1,
  dipCalmFactor: 0.5,
  rsiEnabled: true,
  rsiValue: 40,
  rsiScaleEnabled: false,
  rsiLowLte: 30,
  rsiLowFactor: 2,
  rsiHighGte: 70,
  rsiHighFactor: 0.5,
  fearGreedEnabled: false,
  fearGreedValue: 25,
  fearGreedScaleEnabled: false,
  fearGreedLowLte: 35,
  fearGreedLowFactor: 2,
  fearGreedHighGte: 80,
  fearGreedHighFactor: 0.5,
  macdEnabled: false,
  macdScaleEnabled: false,
  macdPosFactor: 1.2,
  macdNegFactor: 0.8,
  bollingerEnabled: false,
  bollingerPctB: 0.05,
  bollingerScaleEnabled: false,
  bollingerLowLte: 0.05,
  bollingerLowFactor: 2,
  bollingerHighGte: 0.95,
  bollingerHighFactor: 0.5,
  smaBuyEnabled: false,
  smaBuyPeriod: 200,
  smaScaleEnabled: false,
  smaBelowFactor: 1.5,
  smaAboveFactor: 0.7,
  athEnabled: true,
  athLookback: 90,
  reserveEnabled: true,
  reservePct: 10,
  ddTiersEnabled: false,
  ddTiers: [
    { gtePct: 5, factor: 1.1 },
    { gtePct: 10, factor: 1.25 },
    { gtePct: 20, factor: 1.5 },
  ],
  riseTiersEnabled: false,
  riseTiers: [
    { gtePct: 15, factor: 0.85 },
    { gtePct: 30, factor: 0.6 },
  ],
  tierLookback: 365,
  volEnabled: false,
  volPeriod: 30,
  volMaxPct: 80,
  volMode: "veto",
  volScaleFactor: 0.5,
  extraBuysEnabled: false,
  extraBuys: [
    { trigger: "rsi_below", value: 30, pctOfBudget: 25, cooldownDays: 30 },
    { trigger: "dip", value: 5, pctOfBudget: 25, cooldownDays: 30 },
  ],
  from: monthsAgoIso(12),
  to: yesterdayIso(),
  feePct: 0.1,
  horizon: null,
};

/**
 * Page blanche pour chat / nouvelles stratégies :
 * DCA classique (aucune règle fantôme) + allocation / devise optionnelles.
 */
export function blankEditorState(
  keep?: Partial<Pick<EditorState, "allocation" | "currency" | "feePct">>,
): EditorState {
  const off = classicOff();
  return {
    ...DEFAULT_STATE,
    ...off,
    fearGreedEnabled: false,
    fearGreedScaleEnabled: false,
    dipScaleEnabled: false,
    rsiScaleEnabled: false,
    macdEnabled: false,
    macdScaleEnabled: false,
    bollingerEnabled: false,
    bollingerScaleEnabled: false,
    smaBuyEnabled: false,
    smaScaleEnabled: false,
    requireSignal: false,
    budgetAmount: 200,
    windowFrom: 1,
    windowTo: 7,
    period: "monthly",
    from: monthsAgoIso(12),
    to: yesterdayIso(),
    horizon: null,
    allocation: keep?.allocation?.length
      ? keep.allocation.map((a) => ({ ...a }))
      : [],
    currency: keep?.currency ?? "EUR",
    feePct: keep?.feePct ?? 0.1,
  };
}

/** Applique un horizon → from / to. */
export function applyHorizon(
  horizon: BacktestHorizon,
  firstTransactionDate?: string | null,
  customFrom?: string | null,
): Pick<EditorState, "horizon" | "from" | "to"> {
  return {
    horizon,
    ...horizonToDates(horizon, firstTransactionDate, customFrom),
  };
}

export function applyStartDate(
  from: string,
): Pick<EditorState, "horizon" | "from" | "to"> {
  return applyHorizon("custom", null, from);
}

export function horizonLabel(horizon: BacktestHorizon | null | undefined): string | null {
  if (horizon === "1y") return "1 an";
  if (horizon === "3y") return "3 ans";
  if (horizon === "since_first_buy") return "depuis le 1er achat";
  if (horizon === "custom") return null;
  return null;
}

export function isDefaultCryptoAllocation(allocation: AllocationRow[]): boolean {
  if (allocation.length !== 3) return false;
  const key = allocation
    .map((a) => a.asset)
    .sort()
    .join(",");
  return key === "BTC,ETH,SOL";
}

export function monthsAgoIso(months: number): string {
  const d = new Date(Date.now() - 86_400_000);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function yesterdayIso(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Budget périodique pour que N × budget ≈ netInvested (mêmes fenêtres que le moteur).
 */
export function budgetFromNetInvested(state: EditorState, netInvested: number): number {
  if (!(netInvested > 0)) return state.budgetAmount;
  try {
    const strategy = parseStrategy(toStrategyDocument({ ...state, budgetAmount: 1 }));
    return calibrateStrategyBudget(strategy, state.from, state.to, netInvested).budgetAmount;
  } catch {
    return state.budgetAmount;
  }
}

/**
 * Allocation = poids des positions du portefeuille (pour comparer équitablement).
 * Ne touche ni budget ni règles.
 * @param opts.maxAssets — optionnel : plafonne aux N plus grosses (déconseillé ;
 *   préférer le questionnaire utilisateur).
 */
export const BACKTEST_MAX_ASSETS = 20;

export function allocationFromPortfolio(
  payload: PortfolioPayload,
  opts?: { maxAssets?: number },
): AllocationRow[] | null {
  const patch = seedStateFromPortfolio(payload, {
    maxAssets: opts?.maxAssets,
    replacePeriod: false,
  });
  return patch.allocation?.length ? patch.allocation : null;
}

/** True si les deux allocations couvrent les mêmes actifs (ordre / poids ignorés). */
export function sameAssets(
  a: AllocationRow[],
  b: { asset: string }[],
): boolean {
  const sa = new Set(a.map((x) => x.asset.toUpperCase()).filter(Boolean));
  const sb = new Set(b.map((x) => x.asset.toUpperCase()).filter(Boolean));
  if (sa.size === 0 || sb.size === 0 || sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * Calque la stratégie sur le portefeuille importé :
 * positions (mêmes poids) + devise. N’écrase PAS le budget déclaré.
 */
export function seedStateFromPortfolio(
  payload: PortfolioPayload,
  opts?: { maxAssets?: number; replacePeriod?: boolean },
): Partial<EditorState> {
  const maxAssets = opts?.maxAssets ?? Number.POSITIVE_INFINITY;

  const ranked = [...payload.valuation.positions]
    .filter((p) => p.quantity > 0)
    .sort((a, b) => (b.weightPct ?? b.value ?? 0) - (a.weightPct ?? a.value ?? 0))
    .slice(0, Number.isFinite(maxAssets) ? maxAssets : undefined);

  const weightSum = ranked.reduce((s, p) => s + (p.weightPct ?? 0), 0);
  const valueSum = ranked.reduce((s, p) => s + (p.value ?? 0), 0);

  let allocation: AllocationRow[];

  if (ranked.length > 0 && weightSum > 0) {
    allocation = normalizeAllocationPct(
      ranked.map((p) => ({
        asset: canonicalMarketSymbol(p.asset),
        weight: (p.weightPct ?? 0) / weightSum,
      })),
    );
  } else if (ranked.length > 0 && valueSum > 0) {
    allocation = normalizeAllocationPct(
      ranked.map((p) => ({
        asset: canonicalMarketSymbol(p.asset),
        weight: (p.value ?? 0) / valueSum,
      })),
    );
  } else {
    const holdings = payload.portfolio.holdings
      .filter((h) => h.quantity > 0)
      .slice(0, Number.isFinite(maxAssets) ? maxAssets : undefined);
    if (holdings.length === 0) return { currency: payload.portfolio.currency };
    const w = 1 / holdings.length;
    allocation = normalizeAllocationPct(
      holdings.map((h) => ({ asset: canonicalMarketSymbol(h.asset), weight: w })),
    );
  }

  const to = yesterdayIso();
  const from = payload.firstTransactionDate ?? monthsAgoIso(12);

  return {
    allocation,
    currency: payload.portfolio.currency,
    ...(opts?.replacePeriod !== false ? { from, to } : {}),
  };
}

/** Poids relatifs → pourcentages qui totalisent 100 (2 décimales), tickers dédupliqués. */
function normalizeAllocationPct(
  rows: { asset: string; weight: number }[],
): AllocationRow[] {
  if (rows.length === 0) return [];

  const merged = new Map<string, number>();
  for (const r of rows) {
    merged.set(r.asset, (merged.get(r.asset) ?? 0) + Math.max(0, r.weight));
  }
  const entries = [...merged.entries()].map(([asset, weight]) => ({ asset, weight }));
  const totalW = entries.reduce((s, r) => s + r.weight, 0);
  if (totalW <= 0) {
    const even = 1 / entries.length;
    return normalizeAllocationPct(entries.map((e) => ({ ...e, weight: even })));
  }

  const raw = entries.map((r) => ({
    asset: r.asset,
    pct: Math.round((r.weight / totalW) * 10_000) / 100,
  }));
  const positive = raw.filter((r) => r.pct > 0);
  const source =
    positive.length > 0 ? positive : raw.map((r) => ({ ...r, pct: 0.01 }));
  const sum = source.reduce((s, r) => s + r.pct, 0);
  const scaled = source.map((r) => ({
    asset: r.asset,
    pct: Math.round((r.pct / sum) * 10_000) / 100,
  }));
  const scaledSum = scaled.reduce((s, r) => s + r.pct, 0);
  const last = scaled[scaled.length - 1]!;
  last.pct = Math.round((last.pct + (100 - scaledSum)) * 100) / 100;
  if (last.pct <= 0) last.pct = 0.01;
  return scaled;
}

export function allocationTotal(state: EditorState): number {
  return state.allocation.reduce((sum, a) => sum + a.pct, 0);
}

/** Construit le document JSON de stratégie envoyé au moteur. */
export function toStrategyDocument(state: EditorState): Record<string, unknown> {
  const regimeReferenceAsset =
    typeof state.regimeReferenceAsset === "string" ? state.regimeReferenceAsset : "";
  // Indépendance par défaut. Mode reference uniquement si choisi ET ticker fourni.
  const regimeScope =
    state.regimeScope === "reference" && regimeReferenceAsset.trim()
      ? "reference"
      : "per_asset";
  const timingRules: Record<string, unknown>[] = [];
  if (state.dipScaleEnabled) {
    timingRules.push({
      type: "dip_scale",
      deep_gte_pct: state.dipDeepGte,
      deep_factor: state.dipDeepFactor,
      calm_lt_pct: state.dipCalmLt,
      calm_factor: state.dipCalmFactor,
    });
  } else if (state.dipEnabled) {
    timingRules.push({ type: "dip_trigger", drop_pct: state.dipPct });
  }
  if (state.rsiScaleEnabled) {
    timingRules.push({
      type: "rsi_scale",
      low_lte: state.rsiLowLte,
      low_factor: state.rsiLowFactor,
      high_gte: state.rsiHighGte,
      high_factor: state.rsiHighFactor,
      period: 14,
    });
  } else if (state.rsiEnabled) {
    timingRules.push({ type: "rsi_below", value: state.rsiValue });
  }
  if (state.fearGreedScaleEnabled) {
    timingRules.push({
      type: "fear_greed_scale",
      low_lte: state.fearGreedLowLte,
      low_factor: state.fearGreedLowFactor,
      high_gte: state.fearGreedHighGte,
      high_factor: state.fearGreedHighFactor,
    });
  } else if (state.fearGreedEnabled) {
    timingRules.push({ type: "fear_greed_below", value: state.fearGreedValue });
  }
  if (state.macdScaleEnabled) {
    timingRules.push({
      type: "macd_scale",
      pos_gt: 0,
      pos_factor: state.macdPosFactor,
      neg_lt: 0,
      neg_factor: state.macdNegFactor,
    });
  } else if (state.macdEnabled) {
    timingRules.push({ type: "macd_histogram", op: "gt", value: 0 });
  }
  if (state.bollingerScaleEnabled) {
    timingRules.push({
      type: "bollinger_scale",
      low_lte: state.bollingerLowLte,
      low_factor: state.bollingerLowFactor,
      high_gte: state.bollingerHighGte,
      high_factor: state.bollingerHighFactor,
      period: 20,
    });
  } else if (state.bollingerEnabled) {
    timingRules.push({
      type: "bollinger_pctb",
      op: "lte",
      value: state.bollingerPctB,
      period: 20,
    });
  }
  if (state.smaScaleEnabled) {
    timingRules.push({
      type: "sma_scale",
      period: state.smaBuyPeriod,
      below_factor: state.smaBelowFactor,
      above_factor: state.smaAboveFactor,
    });
  } else if (state.smaBuyEnabled) {
    timingRules.push({ type: "price_below_sma", period: state.smaBuyPeriod });
  }
  if (state.athEnabled) timingRules.push({ type: "avoid_ath", lookback_days: state.athLookback });
  if (state.volEnabled) {
    timingRules.push({
      type: "volatility_gate",
      period: state.volPeriod,
      max_vol_pct: state.volMaxPct,
      mode: state.volMode,
      scale_factor: state.volScaleFactor,
    });
  }
  if (state.extraBuysEnabled) {
    for (const e of state.extraBuys) {
      if (!(e.value > 0) || !(e.pctOfBudget > 0)) continue;
      timingRules.push({
        type: "extra_buy",
        trigger: e.trigger,
        value: e.value,
        pct_of_budget: e.pctOfBudget,
        cooldown_days: e.cooldownDays,
        period: 14,
      });
    }
  }

  // Gate exclusif : flag explicite (chat « que si » / toggle réglages).
  // Scale F&G (modulation) ≠ gate : on n’active jamais require_signal pour du scale.
  const require_signal =
    state.requireSignal === true && !state.fearGreedScaleEnabled;

  const maxDay = state.period === "weekly" ? 7 : 31;
  const windowFrom = Math.min(Math.max(1, state.windowFrom), maxDay);
  const windowTo = Math.min(Math.max(windowFrom, state.windowTo), maxDay);

  const budget_scale_tiers =
    state.ddTiersEnabled || state.riseTiersEnabled
      ? {
          lookback_days: state.tierLookback,
          drawdown: state.ddTiersEnabled
            ? state.ddTiers.map((t) => ({ gte_pct: t.gtePct, factor: t.factor }))
            : [],
          rise: state.riseTiersEnabled
            ? state.riseTiers.map((t) => ({ gte_pct: t.gtePct, factor: t.factor }))
            : [],
        }
      : undefined;

  return {
    name: "Ma stratégie",
    budget: { amount: state.budgetAmount, currency: state.currency, period: state.period },
    window:
      state.period === "weekly"
        ? { type: "day_of_week", from: windowFrom, to: windowTo }
        : { type: "day_of_month", from: windowFrom, to: windowTo },
    allocation: state.allocation
      .filter((a) => a.pct > 0)
      .map((a) => ({ asset: canonicalMarketSymbol(a.asset), weight: a.pct / 100 })),
    splitting: { tranches: state.tranches, distribution: state.distribution },
    ...(state.regimeEnabled
      ? {
          regime_adjustment: {
            indicator: "price_vs_sma" as const,
            sma_period: state.regimeSmaPeriod,
            band_pct: state.regimeBandPct,
            scope: regimeScope,
            ...(regimeScope === "reference" && regimeReferenceAsset.trim()
              ? {
                  reference_asset: canonicalMarketSymbol(regimeReferenceAsset.trim()),
                }
              : {}),
            bull: { budget_multiplier: state.bullMult },
            neutral: { budget_multiplier: state.neutralMult },
            bear: { budget_multiplier: state.bearMult },
            fallback_budget: state.fallbackNeutral !== false ? "neutral" : "regime",
          },
        }
      : {}),
    ...(budget_scale_tiers ? { budget_scale_tiers } : {}),
    timing_rules: timingRules,
    ...(require_signal ? { require_signal: true } : {}),
    ...(state.reserveEnabled ? { cash_rules: { min_cash_reserve_pct: state.reservePct } } : {}),
  };
}
