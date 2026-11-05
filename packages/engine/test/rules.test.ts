import { describe, expect, it } from "vitest";
import { evaluateCondition } from "../src/rules/evaluate.js";
import { compileStrategy, decompileToStrategy } from "../src/rules/compile.js";
import { lintRuleDocument, lintStrategy } from "../src/rules/lint.js";
import { parseStrategy } from "../src/schema.js";
import { runBacktest } from "../src/backtest.js";
import { baseStrategy, makeSeries } from "./helpers.js";

describe("compileStrategy", () => {
  it("require_signal : pas de fallback-window-end", () => {
    const s = baseStrategy({
      require_signal: true,
      timing_rules: [{ type: "fear_greed_below", value: 35 }],
    });
    const doc = compileStrategy(s);
    expect(doc.rules.some((r) => r.id === "fallback-window-end")).toBe(false);
    expect(doc.rules.some((r) => r.id.startsWith("trigger-fng-"))).toBe(true);
  });

  it("compile fear_greed_scale + rsi_scale + dip_scale", () => {
    const s = baseStrategy({
      timing_rules: [
        {
          type: "fear_greed_scale",
          low_lte: 35,
          low_factor: 2,
          high_gte: 80,
          high_factor: 0.5,
        },
        {
          type: "rsi_scale",
          low_lte: 30,
          low_factor: 2,
          high_gte: 70,
          high_factor: 0.5,
          period: 14,
        },
        {
          type: "dip_scale",
          deep_gte_pct: 3,
          deep_factor: 2,
          calm_lt_pct: 1,
          calm_factor: 0.5,
        },
      ],
    });
    const doc = compileStrategy(s);
    expect(doc.rules.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        "scale-fng-low-35",
        "scale-fng-high-80",
        "scale-rsi-low-30",
        "scale-rsi-high-70",
        "scale-dip-deep-3",
        "scale-dip-calm-1",
        "fallback-window-end",
      ]),
    );
  });

  it("roundtrip compile → decompile préserve les paramètres essentiels", () => {
    const s = baseStrategy({
      splitting: { tranches: 3, distribution: "equal" },
      regime_adjustment: {
        bull: { budget_multiplier: 0.7 },
        bear: { budget_multiplier: 1.5 },
      },
      timing_rules: [
        { type: "dip_trigger", drop_pct: 3 },
        { type: "rsi_below", value: 40, period: 14 },
        { type: "avoid_ath", lookback_days: 90 },
      ],
      cash_rules: { min_cash_reserve_pct: 10 },
    });
    const back = decompileToStrategy(compileStrategy(s));
    expect(back.budget).toEqual(s.budget);
    expect(back.window).toEqual(s.window);
    expect(back.allocation).toEqual(s.allocation);
    expect(back.splitting).toEqual(s.splitting);
    expect(back.cash_rules).toEqual(s.cash_rules);
    expect(back.regime_adjustment?.bull).toEqual(s.regime_adjustment?.bull);
    expect(back.regime_adjustment?.bear).toEqual(s.regime_adjustment?.bear);
    expect(back.timing_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "dip_trigger", drop_pct: 3 }),
        expect.objectContaining({ type: "rsi_below", value: 40 }),
        expect.objectContaining({ type: "avoid_ath", lookback_days: 90 }),
      ]),
    );
  });

  it("parseStrategy accepte un document de règles v1", () => {
    const doc = compileStrategy(baseStrategy());
    const parsed = parseStrategy(doc);
    expect(parsed.name).toBe("Test");
    expect(parsed.budget.amount).toBe(300);
  });
});

describe("evaluateCondition", () => {
  it("évalue un arbre ET/OU/NON", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
    const ctx = { closes, openPrice: 100, regime: "bear" as const };
    const result = evaluateCondition(
      {
        all: [
          { type: "regime", value: "bear" },
          { any: [{ type: "rsi", value: 40 }, { type: "dip", drop_pct: 5 }] },
        ],
      },
      ctx,
    );
    expect(result.matched).toBe(true);
    expect(result.reason).toMatch(/régime bear/);
  });

  it("détecte un dip vs ouverture de fenêtre", () => {
    const result = evaluateCondition(
      { type: "dip", drop_pct: 3 },
      { closes: [100, 95], openPrice: 100, regime: "neutral" },
    );
    expect(result.matched).toBe(true);
    expect(result.reason).toMatch(/dip:/);
  });

  it("détecte un nouveau plus haut", () => {
    const closes = [10, 20, 30, 40, 50];
    const result = evaluateCondition(
      { type: "new_ath", lookback_days: 10 },
      { closes, openPrice: 10, regime: "bull" },
    );
    expect(result.matched).toBe(true);
  });

  it("évalue Fear & Greed injecté dans le contexte", () => {
    const hit = evaluateCondition(
      { type: "fear_greed", op: "lte", value: 25 },
      { closes: [100], openPrice: 100, regime: "neutral", fearGreed: 20 },
    );
    expect(hit.matched).toBe(true);
    expect(hit.reason).toMatch(/Fear&Greed/);

    const miss = evaluateCondition(
      { type: "fear_greed", op: "lte", value: 25 },
      { closes: [100], openPrice: 100, regime: "neutral", fearGreed: 60 },
    );
    expect(miss.matched).toBe(false);

    const absent = evaluateCondition(
      { type: "fear_greed", op: "lte", value: 25 },
      { closes: [100], openPrice: 100, regime: "neutral" },
    );
    expect(absent.matched).toBe(false);
  });
});

describe("lintStrategy", () => {
  it("signale l'absence de fallback quand des déclencheurs existent", () => {
    const doc = compileStrategy(
      baseStrategy({ timing_rules: [{ type: "dip_trigger", drop_pct: 3 }] }),
    );
    doc.rules = doc.rules.filter((r) => r.id !== "fallback-window-end");
    const issues = lintRuleDocument(doc);
    expect(issues.some((i) => i.code === "missing_fallback")).toBe(true);
  });

  it("signale un RSI extrêmement bas", () => {
    const issues = lintStrategy(
      baseStrategy({ timing_rules: [{ type: "rsi_below", value: 5 }] }),
    );
    expect(issues.some((i) => i.code === "rare_rsi")).toBe(true);
  });
});

describe("backtest via moteur de règles", () => {
  it("produit les mêmes décisions qu'avant (dip_trigger + fallback)", () => {
    const series = [makeSeries("AAA", "2024-01-01", 40, (i) => (i >= 2 ? 90 : 100))];
    const s = baseStrategy({
      splitting: { tranches: 2, distribution: "equal" },
      timing_rules: [{ type: "dip_trigger", drop_pct: 5 }],
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.rules.rules.length).toBeGreaterThan(0);
    expect(r.purchases[0]!.kind).toBe("trigger");
    expect(r.purchases[0]!.reason).toMatch(/dip:/);
    expect(r.invested).toBeCloseTo(300, 6);
  });

  it("attache le document de règles et le lint au résultat", () => {
    const series = [makeSeries("AAA", "2024-01-01", 40, () => 100)];
    const r = runBacktest(baseStrategy(), series, {
      from: "2024-01-01",
      to: "2024-01-31",
      feePct: 0,
    });
    expect(r.rules.version).toBe(1);
    expect(Array.isArray(r.lint)).toBe(true);
  });
});

describe("paliers drawdown / volatilité / extra", () => {
  it("compile des paliers de drawdown exclusifs", () => {
    const s = baseStrategy({
      budget_scale_tiers: {
        lookback_days: 365,
        drawdown: [
          { gte_pct: 5, factor: 1.1 },
          { gte_pct: 10, factor: 1.25 },
          { gte_pct: 20, factor: 1.5 },
        ],
        rise: [
          { gte_pct: 15, factor: 0.85 },
          { gte_pct: 30, factor: 0.6 },
        ],
      },
    });
    const doc = compileStrategy(s);
    expect(doc.rules.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        "tier-drawdown-20",
        "tier-drawdown-10",
        "tier-drawdown-5",
        "tier-rise-30",
        "tier-rise-15",
      ]),
    );
  });

  it("évalue drawdown et rise", () => {
    // Prix : peak 100, puis 80 → DD 20 %
    const closes = Array.from({ length: 50 }, () => 100).concat([80]);
    const dd = evaluateCondition(
      { type: "drawdown", lookback_days: 60, op: "gte", value: 15 },
      { closes, openPrice: 100, regime: "neutral" },
    );
    expect(dd.matched).toBe(true);

    // Remontée depuis trough 50 → 80 = +60 %
    const riseCloses = Array.from({ length: 40 }, () => 50).concat([80]);
    const rise = evaluateCondition(
      { type: "rise", lookback_days: 60, op: "gte", value: 30 },
      { closes: riseCloses, openPrice: 50, regime: "neutral" },
    );
    expect(rise.matched).toBe(true);
  });

  it("compile volatility_gate et extra_buy", () => {
    const s = baseStrategy({
      timing_rules: [
        {
          type: "volatility_gate",
          period: 30,
          max_vol_pct: 80,
          mode: "veto",
          scale_factor: 0.5,
        },
        {
          type: "extra_buy",
          trigger: "rsi_below",
          value: 30,
          period: 14,
          pct_of_budget: 25,
          cooldown_days: 30,
        },
      ],
    });
    const doc = compileStrategy(s);
    expect(doc.rules.some((r) => r.id.startsWith("veto-vol-"))).toBe(true);
    expect(doc.rules.some((r) => r.then.some((a) => a.action === "buy_extra"))).toBe(true);
  });

  it("exécute un achat exceptionnel hors tranches", () => {
    const series = [makeSeries("AAA", "2024-01-01", 40, (i) => (i >= 2 ? 90 : 100))];
    const s = baseStrategy({
      splitting: { tranches: 1, distribution: "equal" },
      // RSI irréaliste → le DCA reste en pending ; l'extra peut consommer du cash.
      timing_rules: [
        { type: "rsi_below", value: 1, period: 14 },
        {
          type: "extra_buy",
          trigger: "dip",
          value: 5,
          period: 14,
          pct_of_budget: 20,
          cooldown_days: 30,
        },
      ],
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    const extras = r.purchases.filter((p) => p.kind === "extra");
    expect(extras.length).toBeGreaterThanOrEqual(1);
    expect(extras[0]!.reason).toMatch(/exceptionnel|dip/i);
  });
});
