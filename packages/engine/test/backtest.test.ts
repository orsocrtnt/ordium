import { describe, expect, it } from "vitest";
import { calibrateStrategyBudget, runBacktest, toClassicDca } from "../src/backtest.js";
import { detectRegime } from "../src/engine.js";
import { baseStrategy, makeSeries } from "./helpers.js";

const FLAT = (_: number) => 100;

describe("runBacktest", () => {
  it("DCA simple : investit tout le budget à l'ouverture de chaque fenêtre", () => {
    const series = [makeSeries("AAA", "2024-01-01", 91, FLAT)];
    const s = baseStrategy();
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-03-31", feePct: 0 });
    expect(r.contributed).toBe(900);
    expect(r.invested).toBeCloseTo(900, 6);
    expect(r.purchases).toHaveLength(3);
    expect(r.purchases.map((p) => p.date)).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
    expect(r.totalValue).toBeCloseTo(900, 6);
    expect(r.perAsset[0]!.quantity).toBeCloseTo(9, 6);
  });

  it("fallback : si aucun déclencheur ne se réalise, tout est acheté en fin de fenêtre", () => {
    const series = [makeSeries("AAA", "2024-01-01", 60, FLAT)];
    const s = baseStrategy({
      splitting: { tranches: 3, distribution: "equal" },
      timing_rules: [{ type: "dip_trigger", drop_pct: 50 }],
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.invested).toBeCloseTo(300, 6);
    expect(r.purchases).toHaveLength(3);
    for (const p of r.purchases) {
      expect(p.date).toBe("2024-01-07");
      expect(p.kind).toBe("fallback");
    }
  });

  it("dip_trigger : achète en avance quand le prix baisse dans la fenêtre", () => {
    // Baisse de 10 % au 3e jour de la fenêtre.
    const series = [makeSeries("AAA", "2024-01-01", 40, (i) => (i >= 2 ? 90 : 100))];
    const s = baseStrategy({
      splitting: { tranches: 2, distribution: "equal" },
      timing_rules: [{ type: "dip_trigger", drop_pct: 5 }],
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    const [first, second] = r.purchases;
    expect(first!.date).toBe("2024-01-03");
    expect(first!.kind).toBe("trigger");
    expect(first!.reason).toMatch(/dip:/);
    expect(first!.price).toBe(90);
    // Une tranche par jour max : la seconde part le lendemain (déclencheur toujours actif).
    expect(second!.date).toBe("2024-01-04");
  });

  it("avoid_ath : veto sur les nouveaux sommets, mais le fallback garantit l'achat", () => {
    // Prix en hausse constante : chaque jour est un nouveau plus haut.
    const series = [makeSeries("AAA", "2023-10-01", 130, (i) => 100 + i)];
    const s = baseStrategy({ timing_rules: [{ type: "avoid_ath", lookback_days: 30 }] });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.purchases).toHaveLength(1);
    expect(r.purchases[0]!.date).toBe("2024-01-07");
    expect(r.purchases[0]!.kind).toBe("fallback");
    expect(r.invested).toBeCloseTo(300, 6);
  });

  it("régime haussier : versement = budget × multiplicateur (pas de cash fantôme)", () => {
    // 300 jours de hausse : le prix est largement au-dessus de la SMA200 à l'ouverture.
    const series = [makeSeries("AAA", "2023-03-01", 400, (i) => 100 + i)];
    const s = baseStrategy({
      regime_adjustment: {
        bull: { budget_multiplier: 0.5 },
        bear: { budget_multiplier: 2 },
      },
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.windows[0]!.regime).toBe("bull");
    expect(r.contributed).toBeCloseTo(150, 6);
    expect(r.invested).toBeCloseTo(150, 6);
    expect(r.cash).toBeCloseTo(0, 6);
  });

  it("régime baissier : versement = budget × multiplicateur (ex. 200 × 1.15)", () => {
    // Longue baisse : sous la SMA200 → bear.
    const series = [makeSeries("AAA", "2023-03-01", 400, (i) => 500 - i)];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      regime_adjustment: {
        bull: { budget_multiplier: 0.85 },
        bear: { budget_multiplier: 1.15 },
      },
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.windows[0]!.regime).toBe("bear");
    expect(r.contributed).toBeCloseTo(230, 6);
    expect(r.invested).toBeCloseTo(230, 6);
    expect(r.purchases.reduce((s, p) => s + p.quoteAmount, 0)).toBeCloseTo(230, 6);
  });

  it("réserve de liquidités : l'achat est réduit pour respecter le minimum de cash", () => {
    const series = [makeSeries("AAA", "2024-01-01", 40, FLAT)];
    const s = baseStrategy({ cash_rules: { min_cash_reserve_pct: 50 } });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.purchases[0]!.quoteAmount).toBeCloseTo(150, 6);
    expect(r.purchases[0]!.reason).toMatch(/réserve/);
    expect(r.cash).toBeCloseTo(150, 6);
  });

  it("les frais sont déduits de la quantité achetée", () => {
    const series = [makeSeries("AAA", "2024-01-01", 40, FLAT)];
    const s = baseStrategy();
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 1 });
    expect(r.fees).toBeCloseTo(3, 6);
    expect(r.perAsset[0]!.quantity).toBeCloseTo(297 / 100, 6);
  });

  it("fractionnement aléatoire : déterministe pour une même stratégie", () => {
    const series = [makeSeries("AAA", "2024-01-01", 91, (i) => 100 + Math.sin(i) * 5)];
    const s = baseStrategy({ splitting: { tranches: 5, distribution: "random" } });
    const r1 = runBacktest(s, series, { from: "2024-01-01", to: "2024-03-31", feePct: 0 });
    const r2 = runBacktest(s, series, { from: "2024-01-01", to: "2024-03-31", feePct: 0 });
    expect(JSON.stringify(r1.purchases)).toBe(JSON.stringify(r2.purchases));
    // Les tranches sont bien inégales mais somment au budget.
    const amounts = r1.purchases.filter((p) => p.windowKey === "M-2024-01").map((p) => p.quoteAmount);
    expect(amounts).toHaveLength(5);
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 6);
    expect(new Set(amounts.map((a) => a.toFixed(4))).size).toBeGreaterThan(1);
  });

  it("multi-actifs : répartition selon les poids de l'allocation", () => {
    const series = [
      makeSeries("AAA", "2024-01-01", 40, FLAT),
      makeSeries("BBB", "2024-01-01", 40, (_) => 50),
    ];
    const s = baseStrategy({
      allocation: [
        { asset: "AAA", weight: 0.7 },
        { asset: "BBB", weight: 0.3 },
      ],
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    const aaa = r.perAsset.find((a) => a.asset === "AAA")!;
    const bbb = r.perAsset.find((a) => a.asset === "BBB")!;
    expect(aaa.invested).toBeCloseTo(210, 6);
    expect(bbb.invested).toBeCloseTo(90, 6);
  });

  it("toClassicDca : supprime toutes les règles et garde budget/allocation", () => {
    const s = baseStrategy({
      splitting: { tranches: 5, distribution: "random" },
      timing_rules: [{ type: "rsi_below", value: 40 }],
      cash_rules: { min_cash_reserve_pct: 20 },
      regime_adjustment: { bull: { budget_multiplier: 0.5 }, bear: { budget_multiplier: 2 } },
      budget_scale_tiers: {
        lookback_days: 365,
        drawdown: [{ gte_pct: 10, factor: 1.5 }],
        rise: [{ gte_pct: 20, factor: 0.5 }],
      },
    });
    const classic = toClassicDca(s);
    expect(classic.splitting.tranches).toBe(1);
    expect(classic.timing_rules).toEqual([]);
    expect(classic.regime_adjustment).toBeUndefined();
    expect(classic.cash_rules).toBeUndefined();
    expect(classic.budget_scale_tiers).toBeUndefined();
    expect(classic.budget).toEqual(s.budget);
    expect(classic.allocation).toEqual(s.allocation);
    expect(classic.window).toEqual(s.window);
  });

  it("DCA classique : invariant aux règles de la stratégie (même budget/alloc)", () => {
    const series = [makeSeries("AAA", "2023-01-01", 500, (i) => 100 + Math.sin(i / 7) * 30)];
    const opts = { from: "2024-01-01", to: "2024-03-31", feePct: 0 };
    const plain = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
    });
    const decorated = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      splitting: { tranches: 4, distribution: "random" },
      timing_rules: [
        { type: "rsi_below", value: 35 },
        { type: "avoid_ath", lookback_days: 60 },
        { type: "volatility_gate", period: 20, max_vol_pct: 40, mode: "scale", scale_factor: 0.4 },
      ],
      cash_rules: { min_cash_reserve_pct: 15 },
      regime_adjustment: {
        bull: { budget_multiplier: 0.7 },
        bear: { budget_multiplier: 1.4 },
      },
      budget_scale_tiers: {
        lookback_days: 180,
        drawdown: [{ gte_pct: 5, factor: 1.3 }],
        rise: [{ gte_pct: 15, factor: 0.6 }],
      },
    });
    const a = runBacktest(toClassicDca(plain), series, opts);
    const b = runBacktest(toClassicDca(decorated), series, opts);
    expect(b.contributed).toBe(a.contributed);
    expect(b.invested).toBe(a.invested);
    expect(b.totalValue).toBeCloseTo(a.totalValue, 6);
    for (const w of b.windows) {
      expect(w.plannedBudget).toBe(200);
      expect(w.multiplier).toBe(1);
    }
  });

  it("calibrateStrategyBudget : N × budget ≈ netInvested", () => {
    const s = baseStrategy({ budget: { amount: 999, currency: "EUR", period: "monthly" } });
    const { strategy, windowCount, budgetAmount } = calibrateStrategyBudget(
      s,
      "2024-01-01",
      "2024-03-31",
      300,
    );
    expect(windowCount).toBe(3);
    expect(budgetAmount).toBe(100);
    expect(strategy.budget.amount).toBe(100);
  });

  it("enveloppe ±15 % : jamais hors [170, 230] même si paliers drawdown empilés", () => {
    const series = [makeSeries("AAA", "2023-03-01", 400, (i) => 500 - i)];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      regime_adjustment: {
        bull: { budget_multiplier: 0.85 },
        bear: { budget_multiplier: 1.15 },
      },
      // Paliers qui, s’ils étaient multipliés, sortiraient de l’enveloppe.
      budget_scale_tiers: {
        lookback_days: 365,
        drawdown: [{ gte_pct: 5, factor: 1.5 }],
      },
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.windows[0]!.regime).toBe("bear");
    expect(r.windows[0]!.multiplier).toBeCloseTo(1.15, 6);
    expect(r.contributed).toBeCloseTo(230, 6);
    expect(r.invested).toBeCloseTo(230, 6);
  });

  it("DCA classique : chaque fenêtre = exactement le budget de base", () => {
    const series = [makeSeries("AAA", "2024-01-01", 91, FLAT)];
    const s = toClassicDca(
      baseStrategy({ budget: { amount: 200, currency: "EUR", period: "monthly" } }),
    );
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-03-31", feePct: 0 });
    expect(r.contributed).toBe(600);
    for (const w of r.windows) {
      expect(w.plannedBudget).toBe(200);
      expect(w.multiplier).toBe(1);
    }
  });

  it("régime : SMA et bande neutre configurables", () => {
    // 50 clôtures à 100, puis un tick à 110 (+10 %).
    const closes = [...Array.from({ length: 50 }, () => 100), 110];
    const tight = baseStrategy({
      regime_adjustment: {
        sma_period: 50,
        band_pct: 2,
        bull: { budget_multiplier: 0.5 },
        bear: { budget_multiplier: 2 },
      },
    });
    expect(detectRegime(tight, closes).regime).toBe("bull");

    const wide = baseStrategy({
      regime_adjustment: {
        sma_period: 50,
        band_pct: 15,
        bull: { budget_multiplier: 0.5 },
        bear: { budget_multiplier: 2 },
      },
    });
    expect(detectRegime(wide, closes).regime).toBe("neutral");
  });

  it("signale un avertissement si la devise de cotation diffère du budget", () => {
    const series = [makeSeries("AAA", "2024-01-01", 40, FLAT, "USD")];
    const s = baseStrategy();
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31" });
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toMatch(/USD/);
  });
});
