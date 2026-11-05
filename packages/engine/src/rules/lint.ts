import type { Strategy } from "../schema.js";
import { compileStrategy } from "./compile.js";
import type { Condition, RuleDocument } from "./schema.js";

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  severity: LintSeverity;
  code: string;
  message: string;
  path?: string;
  /** Correction proposée, affichable à l'utilisateur. */
  suggestion?: string;
}

/**
 * Vérifie la cohérence d'un document de règles (ou d'une stratégie v0 compilée).
 * Combine des contrôles structurels et des heuristiques de risque.
 */
export function lintRuleDocument(doc: RuleDocument): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const plan of doc.plans) {
    const total = plan.allocation.reduce((s, a) => s + a.weight, 0);
    if (Math.abs(total - 1) > 0.01) {
      issues.push({
        severity: "error",
        code: "allocation_sum",
        path: `plans.${plan.id}.allocation`,
        message: `La somme des poids fait ${(total * 100).toFixed(1)} % (attendu 100 %).`,
        suggestion: "Normaliser proportionnellement les poids.",
      });
    }
    if (plan.window.type !== "full_period" && plan.window.from > plan.window.to) {
      issues.push({
        severity: "error",
        code: "window_inverted",
        path: `plans.${plan.id}.window`,
        message: "La fenêtre a from > to.",
        suggestion: "Inverser les bornes de la fenêtre.",
      });
    }
  }

  const hasFallback = doc.rules.some(
    (r) =>
      r.enabled &&
      r.when === "window_end" &&
      r.then.some((a) => a.action === "buy_remaining"),
  );
  const hasBuyTrigger = doc.rules.some(
    (r) =>
      r.enabled &&
      r.when === "tick" &&
      r.then.some((a) => a.action === "buy_tranche"),
  );
  if (hasBuyTrigger && !hasFallback) {
    issues.push({
      severity: "info",
      code: "missing_fallback",
      message:
        "Des déclencheurs d'achat existent sans fallback : mode « uniquement si signal » — certains mois peuvent ne pas investir.",
      suggestion:
        "C’est voulu si require_signal est actif. Sinon ajouter window_end → buy_remaining.",
    });
  }

  const scaleFactors = doc.rules
    .filter((r) => r.enabled && r.then.some((a) => a.action === "scale_budget"))
    .flatMap((r) =>
      r.then
        .filter((a): a is { action: "scale_budget"; factor: number } => a.action === "scale_budget")
        .map((a) => a.factor),
    );
  const maxScale = scaleFactors.length ? Math.max(...scaleFactors) : 1;
  const cashReserve = doc.constraints.find((c) => c.type === "min_cash_reserve_pct");
  if (cashReserve && maxScale > 1) {
    const freePct = 100 - cashReserve.value;
    // En bear, on verse 100 % du budget mais on ne peut investir que freePct %.
    // Si maxScale * freePct conceptuellement dépasse… plus simplement :
    // un multiplicateur élevé avec une grosse réserve réduit fortement l'investissement effectif.
    if (cashReserve.value >= 30 && maxScale >= 1.5) {
      issues.push({
        severity: "warning",
        code: "cash_vs_scale",
        message: `Réserve de ${cashReserve.value} % combinée à un multiplicateur max de ×${maxScale} : une partie du budget boosté restera bloquée en cash.`,
        suggestion: "Baisser la réserve, ou plafonner le multiplicateur, ou accepter ce comportement.",
      });
    }
    void freePct;
  }

  for (const rule of doc.rules) {
    if (!rule.enabled) continue;
    const rsiLeaf = findRsi(rule.if);
    if (rsiLeaf && rsiLeaf.value <= 10 && (rsiLeaf.op === "lt" || rsiLeaf.op === "lte")) {
      issues.push({
        severity: "info",
        code: "rare_rsi",
        path: `rules.${rule.id}`,
        message: `RSI ≤ ${rsiLeaf.value} est extrêmement rare sur un historique journalier.`,
        suggestion: "Vérifier au backtest la fréquence de déclenchement ; envisager un seuil ≥ 25.",
      });
    }
    if (rule.then.some((a) => a.action === "veto_buy") && rule.when === "window_end") {
      issues.push({
        severity: "error",
        code: "veto_on_fallback",
        path: `rules.${rule.id}`,
        message: "Un veto sur window_end empêcherait le fallback — le DCA ne serait plus garanti.",
        suggestion: "Réserver les vetos au déclencheur tick.",
      });
    }
  }

  const buyAndVetoSameTick = doc.rules.filter(
    (r) =>
      r.enabled &&
      r.when === "tick" &&
      (r.then.some((a) => a.action === "buy_tranche") ||
        r.then.some((a) => a.action === "veto_buy")),
  );
  if (
    buyAndVetoSameTick.some((r) => r.then.some((a) => a.action === "buy_tranche")) &&
    buyAndVetoSameTick.some((r) => r.then.some((a) => a.action === "veto_buy"))
  ) {
    issues.push({
      severity: "info",
      code: "veto_vs_trigger",
      message:
        "Des déclencheurs d'achat et des vetos coexistent sur tick. En cas de conflit, les vetos l'emportent (hors fallback).",
    });
  }

  return issues;
}

export function lintStrategy(strategy: Strategy): LintIssue[] {
  return lintRuleDocument(compileStrategy(strategy));
}

function findRsi(
  condition: Condition | undefined,
): Extract<Condition, { type: "rsi" }> | null {
  if (!condition) return null;
  if ("all" in condition) {
    for (const c of condition.all) {
      const f = findRsi(c);
      if (f) return f;
    }
    return null;
  }
  if ("any" in condition) {
    for (const c of condition.any) {
      const f = findRsi(c);
      if (f) return f;
    }
    return null;
  }
  if ("not" in condition) return findRsi(condition.not);
  return condition.type === "rsi" ? condition : null;
}
