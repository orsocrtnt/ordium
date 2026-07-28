import type { Strategy } from "../schema.js";
import type { Action, Condition, Rule, RuleDocument } from "./schema.js";

type ScaleTier = { gte_pct: number; factor: number };

/**
 * Compile des paliers exclusifs (un seul facteur s'applique) :
 * le palier le plus élevé qui matche, borné par le palier supérieur.
 */
function compileExclusiveScaleTiers(
  kind: "drawdown" | "rise",
  lookback: number,
  tiers: ScaleTier[],
  priorityBase: number,
): Rule[] {
  const sorted = [...tiers]
    .filter((t) => Number.isFinite(t.gte_pct) && Number.isFinite(t.factor))
    .sort((a, b) => b.gte_pct - a.gte_pct);
  const rules: Rule[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]!;
    const lower: Condition = {
      type: kind,
      lookback_days: lookback,
      op: "gte",
      value: tier.gte_pct,
    };
    let ifCond: Condition = lower;
    if (i > 0) {
      const upper = sorted[i - 1]!.gte_pct;
      ifCond = {
        all: [
          lower,
          { type: kind, lookback_days: lookback, op: "lt", value: upper },
        ],
      };
    }
    rules.push({
      id: `tier-${kind}-${tier.gte_pct}`,
      when: "window_open",
      if: ifCond,
      then: [{ action: "scale_budget", factor: tier.factor }],
      priority: priorityBase + i,
      enabled: true,
    });
  }
  return rules;
}

/**
 * Compile une stratégie Smart DCA v0 vers le document de règles v1.
 * C'est une transformation pure et déterministe : le backtest reste bit-identique
 * si l'évaluateur de règles reproduit les mêmes décisions.
 */
export function compileStrategy(strategy: Strategy): RuleDocument {
  const rules: Rule[] = [];

  if (strategy.regime_adjustment) {
    const ra = strategy.regime_adjustment;
    if (ra.bull.budget_multiplier !== 1) {
      rules.push({
        id: "regime-bull",
        when: "window_open",
        if: { type: "regime", value: "bull" },
        then: [{ action: "scale_budget", factor: ra.bull.budget_multiplier }],
        priority: 10,
        enabled: true,
      });
    }
    if (ra.bear.budget_multiplier !== 1) {
      rules.push({
        id: "regime-bear",
        when: "window_open",
        if: { type: "regime", value: "bear" },
        then: [{ action: "scale_budget", factor: ra.bear.budget_multiplier }],
        priority: 10,
        enabled: true,
      });
    }
    if (ra.neutral.budget_multiplier !== 1) {
      rules.push({
        id: "regime-neutral",
        when: "window_open",
        if: { type: "regime", value: "neutral" },
        then: [{ action: "scale_budget", factor: ra.neutral.budget_multiplier }],
        priority: 10,
        enabled: true,
      });
    }
  }

  if (strategy.budget_scale_tiers) {
    const lookback = strategy.budget_scale_tiers.lookback_days ?? 365;
    rules.push(
      ...compileExclusiveScaleTiers(
        "drawdown",
        lookback,
        strategy.budget_scale_tiers.drawdown ?? [],
        15,
      ),
      ...compileExclusiveScaleTiers(
        "rise",
        lookback,
        strategy.budget_scale_tiers.rise ?? [],
        18,
      ),
    );
  }

  // Vetos : bloquent les achats du jour (jamais le fallback).
  for (const tr of strategy.timing_rules) {
    if (tr.type === "avoid_ath") {
      rules.push({
        id: `veto-ath-${tr.lookback_days}`,
        when: "tick",
        if: { type: "new_ath", lookback_days: tr.lookback_days },
        then: [
          {
            action: "veto_buy",
            reason: `avoid_ath: nouveau plus haut sur ${tr.lookback_days} jours`,
          },
        ],
        priority: 20,
        enabled: true,
      });
    }
    if (tr.type === "volatility_gate") {
      const period = tr.period ?? 30;
      if (tr.mode === "veto") {
        rules.push({
          id: `veto-vol-${tr.max_vol_pct}`,
          when: "tick",
          if: {
            type: "volatility",
            period,
            op: "gte",
            value: tr.max_vol_pct,
          },
          then: [
            {
              action: "veto_buy",
              reason: `volatilité ≥ ${tr.max_vol_pct}% (période ${period} j)`,
            },
          ],
          priority: 22,
          enabled: true,
        });
      } else {
        rules.push({
          id: `scale-vol-${tr.max_vol_pct}`,
          when: "window_open",
          if: {
            type: "volatility",
            period,
            op: "gte",
            value: tr.max_vol_pct,
          },
          then: [{ action: "scale_budget", factor: tr.scale_factor ?? 0.5 }],
          priority: 16,
          enabled: true,
        });
      }
    }
  }

  // Déclencheurs d'achat : une tranche max par tick (géré par le runner).
  for (const tr of strategy.timing_rules) {
    if (tr.type === "dip_trigger") {
      rules.push({
        id: `trigger-dip-${tr.drop_pct}`,
        when: "tick",
        if: { type: "dip", reference: "window_open", drop_pct: tr.drop_pct },
        then: [{ action: "buy_tranche" }],
        priority: 50,
        enabled: true,
      });
    }
    if (tr.type === "rsi_below") {
      rules.push({
        id: `trigger-rsi-${tr.value}`,
        when: "tick",
        if: { type: "rsi", period: tr.period, op: "lte", value: tr.value },
        then: [{ action: "buy_tranche" }],
        priority: 50,
        enabled: true,
      });
    }
    if (tr.type === "fear_greed_below") {
      rules.push({
        id: `trigger-fng-${tr.value}`,
        when: "tick",
        if: { type: "fear_greed", op: "lte", value: tr.value },
        then: [{ action: "buy_tranche" }],
        priority: 50,
        enabled: true,
      });
    }
    if (tr.type === "macd_histogram") {
      rules.push({
        id: `trigger-macd-${tr.op}-${tr.value}`,
        when: "tick",
        if: { type: "macd", op: tr.op ?? "gt", value: tr.value ?? 0 },
        then: [{ action: "buy_tranche" }],
        priority: 50,
        enabled: true,
      });
    }
    if (tr.type === "bollinger_pctb") {
      rules.push({
        id: `trigger-bb-${tr.value}`,
        when: "tick",
        if: {
          type: "bollinger",
          period: tr.period ?? 20,
          op: tr.op ?? "lte",
          value: tr.value,
        },
        then: [{ action: "buy_tranche" }],
        priority: 50,
        enabled: true,
      });
    }
    if (tr.type === "price_below_sma") {
      rules.push({
        id: `trigger-sma-${tr.period}`,
        when: "tick",
        if: { type: "price_vs_sma", period: tr.period, op: "lt" },
        then: [{ action: "buy_tranche" }],
        priority: 50,
        enabled: true,
      });
    }
    if (tr.type === "extra_buy") {
      let cond: Condition;
      let reason: string;
      if (tr.trigger === "dip") {
        cond = { type: "dip", reference: "window_open", drop_pct: tr.value };
        reason = `achat exceptionnel : baisse ≥ ${tr.value}%`;
      } else if (tr.trigger === "fear_greed") {
        cond = { type: "fear_greed", op: "lte", value: tr.value };
        reason = `achat exceptionnel : Fear&Greed ≤ ${tr.value}`;
      } else if (tr.trigger === "macd") {
        cond = { type: "macd", op: "gt", value: 0 };
        reason = "achat exceptionnel : MACD hist > 0";
      } else if (tr.trigger === "bollinger") {
        cond = { type: "bollinger", op: "lte", value: Math.min(1, tr.value / 100) };
        reason = `achat exceptionnel : Bollinger %B bas`;
      } else {
        cond = { type: "rsi", period: tr.period ?? 14, op: "lte", value: tr.value };
        reason = `achat exceptionnel : RSI ≤ ${tr.value}`;
      }
      rules.push({
        id: `extra-${tr.trigger}-${tr.value}-${tr.pct_of_budget}`,
        when: "tick",
        if: cond,
        then: [{ action: "buy_extra", pct_of_budget: tr.pct_of_budget, reason }],
        priority: 60,
        enabled: true,
        cooldown_days: tr.cooldown_days ?? 30,
      });
    }
  }

  // Règle produit non négociable : le DCA est toujours honoré.
  rules.push({
    id: "fallback-window-end",
    when: "window_end",
    then: [{ action: "buy_remaining", reason: "fallback : fin de fenêtre" }],
    priority: 200,
    enabled: true,
  });

  const constraints = [];
  if (strategy.cash_rules?.min_cash_reserve_pct != null) {
    constraints.push({
      type: "min_cash_reserve_pct" as const,
      value: strategy.cash_rules.min_cash_reserve_pct,
    });
  }

  return {
    name: strategy.name,
    version: 1,
    plans: [
      {
        type: "dca",
        id: "dca",
        budget: strategy.budget,
        window: strategy.window,
        allocation: strategy.allocation,
        splitting: strategy.splitting,
        reference_asset: strategy.regime_adjustment?.reference_asset,
        regime_band_pct: strategy.regime_adjustment?.band_pct ?? 2,
        regime_sma_period: strategy.regime_adjustment?.sma_period ?? 200,
      },
    ],
    rules,
    constraints,
  };
}

/**
 * Décompile un document de règles v1 vers une stratégie v0, lorsque c'est
 * possible (un seul plan DCA). Permet au runner actuel de consommer les deux formats.
 */
export function decompileToStrategy(doc: RuleDocument): Strategy {
  const plan = doc.plans[0];
  if (!plan || plan.type !== "dca") {
    throw new Error("Décompilation : un plan DCA est requis.");
  }
  if (doc.plans.length > 1) {
    throw new Error("Décompilation : un seul plan DCA est supporté en v1.");
  }

  const timing_rules: Strategy["timing_rules"] = [];
  let regime_adjustment: Strategy["regime_adjustment"];
  const drawdownTiers: ScaleTier[] = [];
  const riseTiers: ScaleTier[] = [];
  let tierLookback = 365;

  const bull = doc.rules.find((r) => r.id === "regime-bull");
  const bear = doc.rules.find((r) => r.id === "regime-bear");
  const neutral = doc.rules.find((r) => r.id === "regime-neutral");
  if (bull || bear || neutral) {
    const factor = (r: Rule | undefined) => {
      const a = r?.then.find(
        (x): x is Extract<Action, { action: "scale_budget" }> => x.action === "scale_budget",
      );
      return a?.factor ?? 1;
    };
    regime_adjustment = {
      indicator: "price_vs_sma",
      sma_period: plan.regime_sma_period ?? 200,
      reference_asset: plan.reference_asset,
      band_pct: plan.regime_band_pct,
      bull: { budget_multiplier: factor(bull) },
      neutral: { budget_multiplier: factor(neutral) },
      bear: { budget_multiplier: factor(bear) },
    };
  }

  for (const rule of doc.rules) {
    if (!rule.enabled) continue;

    if (rule.when === "window_open" && rule.id.startsWith("tier-drawdown-")) {
      const scale = rule.then.find(
        (a): a is Extract<Action, { action: "scale_budget" }> => a.action === "scale_budget",
      );
      const leaf = flattenDrawdownOrRise(rule.if, "drawdown");
      if (scale && leaf) {
        drawdownTiers.push({ gte_pct: leaf.value, factor: scale.factor });
        if (leaf.lookback_days) tierLookback = leaf.lookback_days;
      }
      continue;
    }
    if (rule.when === "window_open" && rule.id.startsWith("tier-rise-")) {
      const scale = rule.then.find(
        (a): a is Extract<Action, { action: "scale_budget" }> => a.action === "scale_budget",
      );
      const leaf = flattenDrawdownOrRise(rule.if, "rise");
      if (scale && leaf) {
        riseTiers.push({ gte_pct: leaf.value, factor: scale.factor });
        if (leaf.lookback_days) tierLookback = leaf.lookback_days;
      }
      continue;
    }

    if (rule.when === "window_open" && rule.id.startsWith("scale-vol-")) {
      const scale = rule.then.find(
        (a): a is Extract<Action, { action: "scale_budget" }> => a.action === "scale_budget",
      );
      const vol = flattenLeaf(rule.if);
      if (scale && vol?.type === "volatility") {
        timing_rules.push({
          type: "volatility_gate",
          period: vol.period ?? 30,
          max_vol_pct: vol.value,
          mode: "scale",
          scale_factor: scale.factor,
        });
      }
      continue;
    }

    if (rule.when !== "tick" || !rule.if) continue;

    const extra = rule.then.find(
      (a): a is Extract<Action, { action: "buy_extra" }> => a.action === "buy_extra",
    );
    if (extra) {
      const cond = flattenLeaf(rule.if);
      if (cond?.type === "dip") {
        timing_rules.push({
          type: "extra_buy",
          trigger: "dip",
          value: cond.drop_pct,
          pct_of_budget: extra.pct_of_budget,
          cooldown_days: rule.cooldown_days ?? 30,
          period: 14,
        });
      } else if (cond?.type === "rsi") {
        timing_rules.push({
          type: "extra_buy",
          trigger: "rsi_below",
          value: cond.value,
          period: cond.period ?? 14,
          pct_of_budget: extra.pct_of_budget,
          cooldown_days: rule.cooldown_days ?? 30,
        });
      }
      continue;
    }

    const cond = flattenLeaf(rule.if);
    if (!cond) continue;
    if (cond.type === "dip") {
      timing_rules.push({
        type: "dip_trigger",
        drop_pct: cond.drop_pct,
        reference: "window_open",
      });
    } else if (cond.type === "rsi") {
      timing_rules.push({
        type: "rsi_below",
        value: cond.value,
        period: cond.period ?? 14,
      });
    } else if (cond.type === "new_ath") {
      timing_rules.push({
        type: "avoid_ath",
        lookback_days: cond.lookback_days,
      });
    } else if (cond.type === "volatility") {
      timing_rules.push({
        type: "volatility_gate",
        period: cond.period ?? 30,
        max_vol_pct: cond.value,
        mode: "veto",
        scale_factor: 0.5,
      });
    }
  }

  const cash = doc.constraints.find((c) => c.type === "min_cash_reserve_pct");
  const budget_scale_tiers =
    drawdownTiers.length > 0 || riseTiers.length > 0
      ? {
          lookback_days: tierLookback,
          drawdown: drawdownTiers.sort((a, b) => a.gte_pct - b.gte_pct),
          rise: riseTiers.sort((a, b) => a.gte_pct - b.gte_pct),
        }
      : undefined;

  return {
    name: doc.name,
    budget: plan.budget,
    window: plan.window,
    allocation: plan.allocation,
    splitting: plan.splitting,
    regime_adjustment,
    budget_scale_tiers,
    timing_rules,
    cash_rules: cash ? { min_cash_reserve_pct: cash.value } : undefined,
  };
}

/** Extrait une feuille de condition (ignore all/any/not pour la décompilation v0). */
function flattenLeaf(c: Condition | undefined): Extract<Condition, { type: string }> | null {
  if (!c) return null;
  if ("all" in c) return c.all.length === 1 ? flattenLeaf(c.all[0]!) : flattenLeaf(c.all[0]!);
  if ("any" in c) return c.any.length === 1 ? flattenLeaf(c.any[0]!) : null;
  if ("not" in c) return null;
  return c;
}

/** Pour les paliers exclusifs : récupère la borne basse (gte) du type demandé. */
function flattenDrawdownOrRise(
  c: Condition | undefined,
  kind: "drawdown" | "rise",
): Extract<Condition, { type: "drawdown" | "rise" }> | null {
  if (!c) return null;
  if ("all" in c) {
    for (const child of c.all) {
      const leaf = flattenDrawdownOrRise(child, kind);
      if (leaf && (leaf.op ?? "gte") === "gte") return leaf;
    }
    return null;
  }
  if ("any" in c || "not" in c) return null;
  if (c.type === kind) return c as Extract<Condition, { type: "drawdown" | "rise" }>;
  return null;
}
