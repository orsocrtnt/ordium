import { z } from "zod";

/**
 * Moteur de règles v1 — six types de blocs universels.
 *
 * Une stratégie = plans (macro-blocs) + règles (quand/si/alors) + contraintes
 * (inviolables, évaluées en dernier). Le Smart DCA v0 se compile vers ce format ;
 * le formulaire web, le futur éditeur de blocs et le LLM produisent tous le même document.
 */

/* ---------- Conditions (arbre SI) ---------- */

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
    z.object({ not: conditionSchema }),
    z.object({
      type: z.literal("rsi"),
      period: z.number().int().min(2).max(50).default(14),
      op: z.enum(["lt", "lte", "gt", "gte"]).default("lte"),
      value: z.number().min(0).max(100),
    }),
    z.object({
      type: z.literal("dip"),
      reference: z.literal("window_open").default("window_open"),
      drop_pct: z.number().positive().max(90),
    }),
    z.object({
      type: z.literal("new_ath"),
      lookback_days: z.number().int().min(5).max(400),
    }),
    z.object({
      type: z.literal("regime"),
      value: z.enum(["bull", "neutral", "bear"]),
    }),
    z.object({
      type: z.literal("drawdown"),
      lookback_days: z.number().int().min(5).max(1000).default(365),
      op: z.enum(["lt", "lte", "gt", "gte"]).default("gte"),
      value: z.number().min(0).max(100),
    }),
    z.object({
      type: z.literal("rise"),
      lookback_days: z.number().int().min(5).max(1000).default(365),
      op: z.enum(["lt", "lte", "gt", "gte"]).default("gte"),
      value: z.number().min(0).max(500),
    }),
    z.object({
      type: z.literal("volatility"),
      period: z.number().int().min(5).max(120).default(30),
      op: z.enum(["lt", "lte", "gt", "gte"]).default("gte"),
      /** Volatilité réalisée annualisée en %. */
      value: z.number().min(0).max(500),
    }),
    z.object({
      type: z.literal("macd"),
      /** Compare l’histogramme MACD (macd − signal) à `value` (souvent 0). */
      op: z.enum(["lt", "lte", "gt", "gte"]).default("gt"),
      value: z.number().default(0),
    }),
    z.object({
      type: z.literal("bollinger"),
      period: z.number().int().min(5).max(100).default(20),
      k: z.number().positive().max(5).default(2),
      /** %B : 0 = bande basse, 1 = bande haute. */
      op: z.enum(["lt", "lte", "gt", "gte"]).default("lte"),
      value: z.number().min(0).max(1),
    }),
    z.object({
      type: z.literal("price_vs_sma"),
      period: z.number().int().min(2).max(400).default(200),
      /** Prix vs SMA : lt = sous la moyenne (bearish), gt = au-dessus. */
      op: z.enum(["lt", "lte", "gt", "gte"]).default("lt"),
    }),
    z.object({
      type: z.literal("fear_greed"),
      /** Index 0–100 (Alternative.me). Extreme Fear ≈ 0–25. */
      op: z.enum(["lt", "lte", "gt", "gte"]).default("lte"),
      value: z.number().min(0).max(100),
    }),
    z.object({ type: z.literal("always") }),
  ]),
);

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
      type: "rsi";
      period?: number;
      op?: "lt" | "lte" | "gt" | "gte";
      value: number;
    }
  | {
      type: "dip";
      reference?: "window_open";
      drop_pct: number;
    }
  | { type: "new_ath"; lookback_days: number }
  | { type: "regime"; value: "bull" | "neutral" | "bear" }
  | {
      type: "drawdown";
      lookback_days?: number;
      op?: "lt" | "lte" | "gt" | "gte";
      value: number;
    }
  | {
      type: "rise";
      lookback_days?: number;
      op?: "lt" | "lte" | "gt" | "gte";
      value: number;
    }
  | {
      type: "volatility";
      period?: number;
      op?: "lt" | "lte" | "gt" | "gte";
      value: number;
    }
  | {
      type: "macd";
      op?: "lt" | "lte" | "gt" | "gte";
      value?: number;
    }
  | {
      type: "bollinger";
      period?: number;
      k?: number;
      op?: "lt" | "lte" | "gt" | "gte";
      value: number;
    }
  | {
      type: "price_vs_sma";
      period?: number;
      op?: "lt" | "lte" | "gt" | "gte";
    }
  | {
      type: "fear_greed";
      op?: "lt" | "lte" | "gt" | "gte";
      value: number;
    }
  | { type: "always" };

/* ---------- Actions (ALORS) ---------- */

export const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("buy_tranche"),
    /** Raison affichée dans le journal (sinon dérivée de la règle). */
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("buy_remaining"),
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("scale_budget"),
    factor: z.number().min(0).max(5),
  }),
  z.object({
    action: z.literal("veto_buy"),
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("buy_extra"),
    /** % du budget planifié de la fenêtre (déjà modulé) à investir en plus. */
    pct_of_budget: z.number().positive().max(100),
    reason: z.string().optional(),
  }),
]);

export type Action = z.infer<typeof actionSchema>;

/* ---------- Déclencheurs (QUAND) ---------- */

export const triggerSchema = z.enum(["window_open", "tick", "window_end"]);
export type Trigger = z.infer<typeof triggerSchema>;

/* ---------- Règles ---------- */

export const ruleSchema = z.object({
  id: z.string().min(1),
  when: triggerSchema,
  if: conditionSchema.optional(),
  then: z.array(actionSchema).min(1),
  /** Priorité : plus petit = plus tôt. Défaut 100. */
  priority: z.number().int().default(100),
  /** Désactive la règle sans la supprimer. */
  enabled: z.boolean().default(true),
  /** Jours minimum entre deux déclenchements (buy_extra). */
  cooldown_days: z.number().int().min(1).max(365).optional(),
});

export type Rule = z.infer<typeof ruleSchema>;

/* ---------- Contraintes (inviolables) ---------- */

export const constraintSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("min_cash_reserve_pct"),
    value: z.number().min(0).max(90),
  }),
  z.object({
    type: z.literal("max_spend_per_window"),
    value: z.number().positive(),
  }),
]);

export type Constraint = z.infer<typeof constraintSchema>;

/* ---------- Plans (macro-blocs) ---------- */

export const dcaPlanSchema = z.object({
  type: z.literal("dca"),
  id: z.string().min(1).default("dca"),
  budget: z.object({
    amount: z.number().positive(),
    currency: z.string().regex(/^[A-Z]{3,4}$/).default("EUR"),
    period: z.enum(["weekly", "monthly", "yearly"]),
  }),
  window: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("day_of_month"),
      from: z.number().int().min(1).max(31),
      to: z.number().int().min(1).max(31),
      month: z.number().int().min(1).max(12).optional(),
    }),
    z.object({
      type: z.literal("day_of_week"),
      from: z.number().int().min(1).max(7),
      to: z.number().int().min(1).max(7),
    }),
    z.object({ type: z.literal("full_period") }),
  ]),
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
  /** Actif de référence pour le régime (défaut : plus gros poids). */
  reference_asset: z.string().optional(),
  /** Bandes autour de la SMA pour le régime (%). */
  regime_band_pct: z.number().min(0).max(30).default(2),
  /** Période SMA pour détecter haussier / baissier. */
  regime_sma_period: z.number().int().min(5).max(500).default(200),
});

export type DcaPlan = z.infer<typeof dcaPlanSchema>;

/* ---------- Document de règles ---------- */

export const ruleDocumentSchema = z
  .object({
    name: z.string().min(1),
    version: z.literal(1).default(1),
    plans: z.array(dcaPlanSchema).min(1),
    rules: z.array(ruleSchema).default([]),
    constraints: z.array(constraintSchema).default([]),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    for (const r of doc.rules) {
      if (ids.has(r.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules"],
          message: `Identifiant de règle en double : ${r.id}.`,
        });
      }
      ids.add(r.id);
    }
    for (const plan of doc.plans) {
      const total = plan.allocation.reduce((s, a) => s + a.weight, 0);
      if (total < 0.99 || total > 1.01) {
        ctx.addIssue({
          code: "custom",
          path: ["plans"],
          message: `Plan ${plan.id} : somme des poids = ${total.toFixed(3)} (attendu 1).`,
        });
      }
    }
  });

export type RuleDocument = z.infer<typeof ruleDocumentSchema>;

export function parseRuleDocument(json: unknown): RuleDocument {
  const res = ruleDocumentSchema.safeParse(json);
  if (!res.success) {
    const details = res.error.issues
      .map((i) => `  - ${i.path.join(".") || "(racine)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Document de règles invalide :\n${details}`);
  }
  return res.data;
}
