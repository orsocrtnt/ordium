import type { WindowSpec } from "./calendar.js";
import { isWeekend, toBusinessDay } from "./calendar.js";
import { sma } from "./indicators.js";
import { randomFractions } from "./rng.js";
import { compileStrategy } from "./rules/compile.js";
import { evaluateCondition, type EvalContext } from "./rules/evaluate.js";
import type { RuleDocument } from "./rules/schema.js";
import type { Strategy } from "./schema.js";
import type { Regime } from "./types.js";

/**
 * Le moteur est pur : il reçoit la stratégie, l'état de la fenêtre en cours et
 * l'historique de prix *jusqu'à aujourd'hui* (jamais le futur), et rend des décisions.
 * C'est le même code qui tourne en backtest et qui tournera en exécution réelle.
 *
 * Depuis la v1, les décisions de timing passent par le document de règles compilé
 * (conditions RSI/dip/ATH/régime). Le comportement du Smart DCA v0 est préservé.
 */

export interface TrancheState {
  amount: number;
  /** Date d'exécution planifiée (mode "étalé"). Null en mode déclencheurs : fallback en fin de fenêtre. */
  scheduledDate: string | null;
  /** Fraction de cette tranche (ex. 1/3). */
  fraction: number;
}

export interface AssetWindowState {
  asset: string;
  weight: number;
  pending: TrancheState[];
  /** Prix d'ouverture de la fenêtre (référence des règles de baisse). */
  openPrice: number | null;
  /** Jours de cotation de l'actif dans la fenêtre (calendrier de marché, connu à l'avance). */
  tradingDates: string[];
  /** Régime propre à cet actif (SMA de l’actif, ou ref partagée). */
  regime: Regime;
  multiplier: number;
  /** Enveloppe régime (déclencheurs) = base × weight × mult régime. */
  regimeBudget: number;
  /** Enveloppe fallback fin de fenêtre (souvent ×1 neutre). */
  fallbackBudget: number;
  /** Cash réservé pour cet actif = max(regime, fallback). */
  plannedBudget: number;
  invested: number;
}

export interface ActiveWindow {
  spec: WindowSpec;
  /** Agrégat (régime majoritaire en poids si mixte). */
  regime: Regime;
  /** Effectif : plannedBudget / baseBudget. */
  multiplier: number;
  plannedBudget: number;
  /** Enveloppe inviolable [base×min, base×max] sur le total fenêtre. */
  envelopeMin: number;
  envelopeMax: number;
  baseBudget: number;
  assets: Map<string, AssetWindowState>;
  invested: number;
  /** Dernière date d'exécution par règle buy_extra (cooldown). */
  extraLastFired: Map<string, string>;
}

/** Compile (ou réutilise) le document de règles associé à une stratégie. */
export function rulesFor(strategy: Strategy, cached?: RuleDocument): RuleDocument {
  return cached ?? compileStrategy(strategy);
}

/** Vrai si la stratégie exige un signal (pas de rattrapage fin de fenêtre). */
export function requiresSignal(strategy: Strategy, doc?: RuleDocument): boolean {
  if (strategy.require_signal === true) return true;
  const rules = rulesFor(strategy, doc).rules;
  return !rules.some(
    (r) =>
      r.enabled &&
      r.when === "window_end" &&
      r.then.some((a) => a.action === "buy_remaining"),
  );
}

/** Vrai si la stratégie contient au moins une règle déclencheuse (hors vetos). */
export function hasTriggerRules(strategy: Strategy, doc?: RuleDocument): boolean {
  const rules = rulesFor(strategy, doc).rules;
  return rules.some(
    (r) =>
      r.enabled &&
      r.when === "tick" &&
      r.then.some((a) => a.action === "buy_tranche"),
  );
}

/** Bornes inviolables du multiplicateur = min/max déclarés dans regime_adjustment. */
export function regimeMultiplierEnvelope(
  strategy: Strategy,
): { min: number; max: number } | null {
  const ra = strategy.regime_adjustment;
  if (!ra) return null;
  const xs = [
    ra.bull.budget_multiplier,
    ra.bear.budget_multiplier,
    ra.neutral?.budget_multiplier ?? 1,
  ].filter((x) => Number.isFinite(x) && x >= 0);
  if (xs.length === 0) return null;
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

/** Détecte le régime de marché sur l'actif de référence et retourne le multiplicateur de budget. */
export function detectRegime(
  strategy: Strategy,
  referenceCloses: number[],
  doc?: RuleDocument,
  fearGreed?: number | null,
): { regime: Regime; multiplier: number } {
  const rules = rulesFor(strategy, doc);
  const plan = rules.plans[0];
  const bandPct = plan?.regime_band_pct ?? strategy.regime_adjustment?.band_pct ?? 2;
  const smaPeriod =
    plan?.regime_sma_period ?? strategy.regime_adjustment?.sma_period ?? 200;

  const avg = sma(referenceCloses, smaPeriod);
  const price = referenceCloses[referenceCloses.length - 1];
  let regime: Regime = "neutral";
  if (avg != null && price != null) {
    const band = bandPct / 100;
    if (price > avg * (1 + band)) regime = "bull";
    else if (price < avg * (1 - band)) regime = "bear";
  }

  const envelope = regimeMultiplierEnvelope(strategy);
  let multiplier = 1;
  const ctx: EvalContext = {
    closes: referenceCloses,
    openPrice: null,
    regime,
    fearGreed: fearGreed ?? null,
  };
  const scaleRules = rules.rules
    .filter((r) => r.enabled && r.when === "window_open")
    .sort((a, b) => a.priority - b.priority);

  // Régime + F&G / vol / paliers : on multiplie tous les scale_budget qui matchent.
  let regimeFactor = 1;
  if (strategy.regime_adjustment) {
    const ra = strategy.regime_adjustment;
    regimeFactor =
      regime === "bull"
        ? ra.bull.budget_multiplier
        : regime === "bear"
          ? ra.bear.budget_multiplier
          : (ra.neutral?.budget_multiplier ?? 1);
    if (envelope) {
      regimeFactor = Math.min(envelope.max, Math.max(envelope.min, regimeFactor));
    }
    multiplier = regimeFactor;
  }

  let otherScaleProduct = 1;
  for (const rule of scaleRules) {
    if (rule.id.startsWith("regime-")) continue;
    if (rule.if && !evaluateCondition(rule.if, ctx).matched) continue;
    for (const action of rule.then) {
      if (action.action === "scale_budget") {
        otherScaleProduct *= action.factor;
        multiplier *= action.factor;
      }
    }
  }

  if (!strategy.regime_adjustment) {
    multiplier = otherScaleProduct;
  }

  if (!Number.isFinite(multiplier) || multiplier < 0) multiplier = 1;

  return { regime, multiplier };
}

/** Arrondi monétaire stable (évite 229.9999999999). */
function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Régime majoritaire par poids (si égalité → neutral). */
export function majorityRegime(
  entries: { regime: Regime; weight: number }[],
): Regime {
  const scores: Record<Regime, number> = { bull: 0, neutral: 0, bear: 0 };
  for (const e of entries) scores[e.regime] += e.weight;
  let best: Regime = "neutral";
  let bestScore = -1;
  for (const r of ["bull", "neutral", "bear"] as Regime[]) {
    if (scores[r] > bestScore) {
      best = r;
      bestScore = scores[r];
    }
  }
  return best;
}

/** True si chaque actif juge sa propre courbe (défaut). */
export function isPerAssetRegime(strategy: Strategy): boolean {
  const ra = strategy.regime_adjustment;
  if (!ra) return false;
  if (ra.scope === "per_asset") return true;
  if (ra.scope === "reference") {
    // "reference" sans actif explicite → ne pas figer tout le monde sur le plus gros poids
    // (ce n’est pas de l’indépendance). Exiger un ticker de référence clair.
    return !ra.reference_asset?.trim();
  }
  // Anciens docs sans scope : indépendant, sauf indice non-défaut explicite.
  const ref = ra.reference_asset?.trim().toUpperCase();
  if (ref && ref !== "IWDA.AS" && ref !== "IWDA") return false;
  return true;
}

/**
 * Ouvre une fenêtre : régime(s), budget(s) ajusté(s), plan de tranches par actif.
 * - scope per_asset : chaque actif a son multiplicateur (sa SMA).
 * - scope reference : un seul régime partagé (comportement historique).
 */
export function openWindow(
  strategy: Strategy,
  spec: WindowSpec,
  tradingDatesByAsset: Map<string, string[]>,
  /** Closes de référence (scope=reference) OU closes de secours. */
  referenceCloses: number[],
  seed: string,
  doc?: RuleDocument,
  /** Closes par actif — requis pour le mode per_asset. */
  closesByAsset?: Map<string, number[]>,
  /** Fear & Greed du jour d’ouverture (pour scale_budget F&G). */
  fearGreed?: number | null,
): ActiveWindow {
  const baseBudget = strategy.budget.amount;
  const envelope = regimeMultiplierEnvelope(strategy);
  // Sans régime : pas d’enveloppe artificielle (= base) qui écraserait F&G / vol / paliers.
  const envelopeMin = envelope ? roundMoney(baseBudget * envelope.min) : 0;
  const envelopeMax = envelope
    ? roundMoney(baseBudget * envelope.max)
    : Number.POSITIVE_INFINITY;
  const n = Math.max(1, strategy.splitting.tranches);
  const fractions =
    strategy.splitting.distribution === "random"
      ? randomFractions(n, seed)
      : Array<number>(n).fill(1 / n);
  const triggered = hasTriggerRules(strategy, doc);
  const perAsset = isPerAssetRegime(strategy);

  const shared = perAsset
    ? null
    : detectRegime(strategy, referenceCloses, doc, fearGreed);

  const neutralMult = strategy.regime_adjustment?.neutral?.budget_multiplier ?? 1;
  // Fallback ×1 (neutre) seulement s’il y a des déclencheurs : sinon tout est programmé au régime.
  const fallbackUsesNeutral =
    triggered &&
    Boolean(strategy.regime_adjustment) &&
    (strategy.regime_adjustment?.fallback_budget ?? "neutral") === "neutral";

  const assets = new Map<string, AssetWindowState>();
  let plannedTotal = 0;
  // Poids renormalisés → la somme des sleeves reste dans l’enveloppe sans
  // rescale uniforme (qui recollerait tous les actifs sur 170 / 200 / 300).
  const weightSum =
    strategy.allocation.reduce((s, a) => s + (a.weight > 0 ? a.weight : 0), 0) || 1;

  for (const { asset, weight: rawWeight } of strategy.allocation) {
    const weight = (rawWeight > 0 ? rawWeight : 0) / weightSum;
    // Jours ouvrés uniquement — jamais de planification samedi/dimanche.
    const dates = (tradingDatesByAsset.get(asset) ?? []).filter((d) => !isWeekend(d));
    // Mode per_asset : jamais la courbe d’un autre actif (sinon régime « unique » fantôme).
    const ownCloses = closesByAsset?.get(asset);
    const { regime, multiplier } = perAsset
      ? ownCloses && ownCloses.length > 0
        ? detectRegime(strategy, ownCloses, doc, fearGreed)
        : { regime: "neutral" as const, multiplier: neutralMult }
      : (shared ?? { regime: "neutral" as const, multiplier: 1 });

    const regimeSleeve = roundMoney(baseBudget * weight * multiplier);
    const fallbackSleeve = fallbackUsesNeutral
      ? roundMoney(baseBudget * weight * neutralMult)
      : regimeSleeve;
    const cashSleeve = roundMoney(Math.max(regimeSleeve, fallbackSleeve));
    plannedTotal += cashSleeve;

    // Tranches dimensionnées au régime (déclencheurs) ; le fallback recalcule à part.
    const pending: TrancheState[] = fractions.map((f, i) => ({
      amount: regimeSleeve * f,
      fraction: f,
      scheduledDate:
        triggered || dates.length === 0
          ? null
          : toBusinessDay(
              dates[Math.min(dates.length - 1, Math.floor((i * dates.length) / n))]!,
            ),
    }));
    assets.set(asset, {
      asset,
      weight,
      pending,
      openPrice: null,
      tradingDates: dates,
      regime,
      multiplier,
      regimeBudget: regimeSleeve,
      fallbackBudget: fallbackSleeve,
      plannedBudget: cashSleeve,
      invested: 0,
    });
  }

  let budget = roundMoney(plannedTotal);
  // Mode référence + régime seul : bornage global historique.
  // Dès qu’il y a d’autres scales (F&G, vol, paliers), on ne reclamps pas
  // (sinon ×2 F&G est écrasé dans l’enveloppe ±15 %).
  const hasExtraScales = rulesFor(strategy, doc).rules.some(
    (r) =>
      r.enabled &&
      r.when === "window_open" &&
      !r.id.startsWith("regime-") &&
      r.then.some((a) => a.action === "scale_budget"),
  );
  if (!perAsset && envelope && !hasExtraScales) {
    if (budget < envelopeMin) budget = envelopeMin;
    if (budget > envelopeMax) budget = envelopeMax;
    if (Math.abs(budget - plannedTotal) > 0.02 && plannedTotal > 0) {
      const scale = budget / plannedTotal;
      plannedTotal = 0;
      for (const st of assets.values()) {
        st.regimeBudget = roundMoney(st.regimeBudget * scale);
        st.fallbackBudget = roundMoney(st.fallbackBudget * scale);
        st.plannedBudget = roundMoney(st.plannedBudget * scale);
        st.pending = st.pending.map((t) => ({ ...t, amount: t.amount * scale }));
        plannedTotal += st.plannedBudget;
      }
      budget = roundMoney(plannedTotal);
    }
  }

  const regimes = [...assets.values()].map((a) => ({
    regime: a.regime,
    weight: a.weight,
  }));
  const regime = majorityRegime(regimes);
  const multiplier =
    baseBudget > 0 ? roundMoney((budget / baseBudget) * 1000) / 1000 : 1;

  return {
    spec,
    regime,
    multiplier,
    plannedBudget: budget,
    envelopeMin,
    envelopeMax,
    baseBudget,
    assets,
    invested: 0,
    extraLastFired: new Map(),
  };
}

/** Vérifie qu’un montant de fenêtre respecte l’enveloppe budget × [min, max] régime. */
export function isWithinBudgetEnvelope(
  strategy: Strategy,
  windowAmount: number,
  eps = 0.02,
): boolean {
  const base = strategy.budget.amount;
  const env = regimeMultiplierEnvelope(strategy);
  if (!env) {
    return Math.abs(windowAmount - base) <= eps;
  }
  const lo = base * env.min;
  const hi = base * env.max;
  return windowAmount + eps >= lo && windowAmount - eps <= hi;
}

function assetCtx(
  closes: number[],
  openPrice: number | null,
  regime: Regime,
  fearGreed?: number | null,
): EvalContext {
  return { closes, openPrice, regime, fearGreed: fearGreed ?? null };
}

/** Règles de veto : retourne la raison du blocage, ou null si l'achat est permis. */
export function checkVeto(
  strategy: Strategy,
  closes: number[],
  regime: Regime = "neutral",
  openPrice: number | null = null,
  doc?: RuleDocument,
  fearGreed?: number | null,
): string | null {
  const ctx = assetCtx(closes, openPrice, regime, fearGreed);
  const vetoRules = rulesFor(strategy, doc)
    .rules.filter(
      (r) =>
        r.enabled &&
        r.when === "tick" &&
        r.then.some((a) => a.action === "veto_buy"),
    )
    .sort((a, b) => a.priority - b.priority);

  for (const rule of vetoRules) {
    if (!rule.if) continue;
    const result = evaluateCondition(rule.if, ctx);
    if (result.matched) {
      const action = rule.then.find((a) => a.action === "veto_buy");
      return action && "reason" in action && action.reason
        ? action.reason
        : result.reason ?? `veto:${rule.id}`;
    }
  }
  return null;
}

/** Règles déclencheuses : retourne la raison du déclenchement, ou null. */
export function checkTrigger(
  strategy: Strategy,
  closes: number[],
  openPrice: number | null,
  regime: Regime = "neutral",
  doc?: RuleDocument,
  fearGreed?: number | null,
): string | null {
  const ctx = assetCtx(closes, openPrice, regime, fearGreed);
  const buyRules = rulesFor(strategy, doc)
    .rules.filter(
      (r) =>
        r.enabled &&
        r.when === "tick" &&
        r.then.some((a) => a.action === "buy_tranche"),
    )
    .sort((a, b) => a.priority - b.priority);

  for (const rule of buyRules) {
    if (rule.if) {
      const result = evaluateCondition(rule.if, ctx);
      if (!result.matched) continue;
      const action = rule.then.find((a) => a.action === "buy_tranche");
      const custom = action && "reason" in action ? action.reason : undefined;
      return custom ?? result.reason ?? rule.id;
    }
    // Pas de condition = toujours vrai.
    return rule.id;
  }
  return null;
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  return Math.floor(ms / 86_400_000);
}

export interface ExtraBuyHit {
  ruleId: string;
  pctOfBudget: number;
  reason: string;
}

/**
 * Achats exceptionnels (buy_extra) : hors tranches DCA, avec cooldown.
 * Ne consomme pas le pending ; le montant est % du budget planifié × poids actif.
 */
export function checkExtraBuys(
  strategy: Strategy,
  closes: number[],
  openPrice: number | null,
  regime: Regime,
  date: string,
  lastFired: Map<string, string>,
  doc?: RuleDocument,
  fearGreed?: number | null,
): ExtraBuyHit[] {
  const ctx = assetCtx(closes, openPrice, regime, fearGreed);
  const hits: ExtraBuyHit[] = [];
  const extraRules = rulesFor(strategy, doc)
    .rules.filter(
      (r) =>
        r.enabled &&
        r.when === "tick" &&
        r.then.some((a) => a.action === "buy_extra"),
    )
    .sort((a, b) => a.priority - b.priority);

  for (const rule of extraRules) {
    if (rule.if) {
      const result = evaluateCondition(rule.if, ctx);
      if (!result.matched) continue;
    }
    const cooldown = rule.cooldown_days ?? 30;
    const prev = lastFired.get(rule.id);
    if (prev != null && daysBetween(prev, date) < cooldown) continue;

    const action = rule.then.find((a) => a.action === "buy_extra");
    if (!action || action.action !== "buy_extra") continue;
    const matchedReason = rule.if ? evaluateCondition(rule.if, ctx).reason : null;
    hits.push({
      ruleId: rule.id,
      pctOfBudget: action.pct_of_budget,
      reason: action.reason || matchedReason || rule.id,
    });
  }
  return hits;
}
