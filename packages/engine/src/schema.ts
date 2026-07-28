import { z } from "zod";
import { decompileToStrategy } from "./rules/compile.js";
import { parseRuleDocument } from "./rules/schema.js";

/**
 * La stratégie est un document déclaratif : c'est la "recette" que le moteur
 * (unique, partagé entre backtest et exécution réelle) interprète.
 *
 * Deux formats acceptés en entrée :
 * - v0 : le formulaire Smart DCA (budget/window/allocation/timing_rules…)
 * - v1 : le document de règles universel (plans/rules/constraints)
 * Dans les deux cas, le moteur travaille en interne via le document de règles v1.
 */

export const timingRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dip_trigger"),
    /** Déclenche un achat si le prix baisse de X % vs l'ouverture de la fenêtre. */
    drop_pct: z.number().positive().max(90),
    reference: z.literal("window_open").default("window_open"),
  }),
  z.object({
    type: z.literal("rsi_below"),
    /** Déclenche un achat si le RSI passe sous ce seuil. */
    value: z.number().min(1).max(99),
    period: z.number().int().min(2).max(50).default(14),
  }),
  z.object({
    type: z.literal("avoid_ath"),
    /** Veto : ne pas acheter le jour d'un nouveau plus haut sur N jours. */
    lookback_days: z.number().int().min(5).max(400),
  }),
  z.object({
    type: z.literal("volatility_gate"),
    /** Fenêtre de calcul de la vol réalisée (jours). */
    period: z.number().int().min(5).max(120).default(30),
    /** Seuil de volatilité annualisée (%). Au-dessus → veto ou scale. */
    max_vol_pct: z.number().positive().max(500),
    mode: z.enum(["veto", "scale"]).default("veto"),
    /** Si mode=scale : multiplicateur de budget quand vol ≥ seuil. */
    scale_factor: z.number().min(0).max(5).default(0.5),
  }),
  z.object({
    type: z.literal("extra_buy"),
    /** Déclencheur de l'achat exceptionnel (hors tranches DCA). */
    trigger: z.enum(["rsi_below", "dip", "fear_greed", "macd", "bollinger"]),
    /** Seuil RSI / baisse % / F&G / %B selon le trigger. */
    value: z.number().min(0).max(100),
    period: z.number().int().min(2).max(50).default(14),
    /** % du budget planifié de la fenêtre à investir en plus. */
    pct_of_budget: z.number().positive().max(100),
    /** Jours minimum entre deux achats exceptionnels de cette règle. */
    cooldown_days: z.number().int().min(1).max(365).default(30),
  }),
  z.object({
    type: z.literal("fear_greed_below"),
    /** Achète si Fear & Greed ≤ value (ex. 25 = Extreme Fear). */
    value: z.number().min(0).max(100),
  }),
  z.object({
    type: z.literal("macd_histogram"),
    /** Achète si histogramme MACD op value (défaut : > 0). */
    op: z.enum(["lt", "lte", "gt", "gte"]).default("gt"),
    value: z.number().default(0),
  }),
  z.object({
    type: z.literal("bollinger_pctb"),
    /** Achète si %B Bollinger op value (ex. ≤ 0.05 = bande basse). */
    op: z.enum(["lt", "lte", "gt", "gte"]).default("lte"),
    value: z.number().min(0).max(1),
    period: z.number().int().min(5).max(100).default(20),
  }),
  z.object({
    type: z.literal("price_below_sma"),
    /** Achète si prix < SMA(period). */
    period: z.number().int().min(2).max(400).default(200),
  }),
]);

export const budgetScaleTierSchema = z.object({
  lookback_days: z.number().int().min(5).max(1000).default(365),
  /** Paliers de drawdown depuis l'ATH (exclusifs, du plus fort au plus faible). */
  drawdown: z
    .array(
      z.object({
        gte_pct: z.number().min(0).max(100),
        factor: z.number().min(0).max(5),
      }),
    )
    .default([]),
  /** Paliers de hausse depuis le plus bas (réduit typiquement le budget). */
  rise: z
    .array(
      z.object({
        gte_pct: z.number().min(0).max(500),
        factor: z.number().min(0).max(5),
      }),
    )
    .default([]),
});

export const windowSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("day_of_month"),
    from: z.number().int().min(1).max(31),
    to: z.number().int().min(1).max(31),
    /** Utilisé uniquement avec un budget annuel : mois de la fenêtre (1-12). */
    month: z.number().int().min(1).max(12).optional(),
  }),
  z.object({
    type: z.literal("day_of_week"),
    /** 1 = lundi … 7 = dimanche. */
    from: z.number().int().min(1).max(7),
    to: z.number().int().min(1).max(7),
  }),
  z.object({ type: z.literal("full_period") }),
]);

export const strategySchema = z
  .object({
    name: z.string().min(1),
    budget: z.object({
      amount: z.number().positive(),
      currency: z.string().regex(/^[A-Z]{3,4}$/).default("EUR"),
      period: z.enum(["weekly", "monthly", "yearly"]),
    }),
    window: windowSchema,
    allocation: z
      .array(
        z.object({
          asset: z.string().min(1),
          weight: z.number().positive().max(1),
        }),
      )
      .min(1),
    splitting: z
      .object({
        tranches: z.number().int().min(1).max(30).default(1),
        distribution: z.enum(["equal", "random"]).default("equal"),
      })
      .default({ tranches: 1, distribution: "equal" }),
    regime_adjustment: z
      .object({
        /** Prix vs moyenne mobile — période = `sma_period` (défaut 200). */
        indicator: z.enum(["price_vs_sma", "price_vs_sma200"]).default("price_vs_sma"),
        /** Période de la SMA pour détecter le régime (ex. 50, 100, 200). */
        sma_period: z.number().int().min(5).max(500).default(200),
        /** Actif de référence pour la tendance (défaut moteur : plus gros poids). Peut être hors allocation (ex. IWDA.AS = MSCI World). */
        reference_asset: z.string().optional(),
        /** Zone neutre autour de la SMA, en % (évite de basculer au moindre bruit). */
        band_pct: z.number().min(0).max(30).default(2),
        bull: z.object({ budget_multiplier: z.number().min(0).max(5) }),
        neutral: z
          .object({ budget_multiplier: z.number().min(0).max(5) })
          .default({ budget_multiplier: 1 }),
        bear: z.object({ budget_multiplier: z.number().min(0).max(5) }),
      })
      .optional(),
    /** Modulation budgétaire par paliers de drawdown / hausse (exclusifs). */
    budget_scale_tiers: budgetScaleTierSchema.optional(),
    timing_rules: z.array(timingRuleSchema).default([]),
    cash_rules: z
      .object({
        /** Toujours conserver au moins X % du portefeuille en liquidités. */
        min_cash_reserve_pct: z.number().min(0).max(90),
      })
      .optional(),
  })
  .superRefine((s, ctx) => {
    const total = s.allocation.reduce((sum, a) => sum + a.weight, 0);
    if (total < 0.99 || total > 1.01) {
      ctx.addIssue({
        code: "custom",
        path: ["allocation"],
        message: `La somme des poids doit faire 1 (actuellement ${total.toFixed(3)}).`,
      });
    }
    const seen = new Set<string>();
    for (const a of s.allocation) {
      if (seen.has(a.asset)) {
        ctx.addIssue({
          code: "custom",
          path: ["allocation"],
          message: `Actif en double dans l'allocation : ${a.asset}.`,
        });
      }
      seen.add(a.asset);
    }
    const compatible: Record<string, string[]> = {
      weekly: ["day_of_week", "full_period"],
      monthly: ["day_of_month", "full_period"],
      yearly: ["day_of_month", "full_period"],
    };
    if (!compatible[s.budget.period]!.includes(s.window.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["window"],
        message: `Fenêtre "${s.window.type}" incompatible avec un budget "${s.budget.period}".`,
      });
    }
    if (s.window.type !== "full_period" && s.window.from > s.window.to) {
      ctx.addIssue({
        code: "custom",
        path: ["window"],
        message: "La fenêtre doit avoir from <= to.",
      });
    }
    const ref = s.regime_adjustment?.reference_asset;
    if (ref != null && ref.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["regime_adjustment", "reference_asset"],
        message: "L'actif de référence ne peut pas être vide (omettre le champ pour l'auto).",
      });
    }
  });

export type Strategy = z.infer<typeof strategySchema>;
export type TimingRule = z.infer<typeof timingRuleSchema>;
export type BudgetScaleTiers = z.infer<typeof budgetScaleTierSchema>;

/** Parse et valide un document de stratégie (format v0 ou v1) ; erreurs lisibles. */
export function parseStrategy(json: unknown): Strategy {
  if (json && typeof json === "object" && "plans" in json) {
    return decompileToStrategy(parseRuleDocument(json));
  }
  const res = strategySchema.safeParse(json);
  if (!res.success) {
    const details = res.error.issues
      .map((i) => `  - ${i.path.join(".") || "(racine)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Stratégie invalide :\n${details}`);
  }
  return res.data;
}
