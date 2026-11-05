import { describe, expect, it } from "vitest";
import { calibrateStrategyBudget, runBacktest, toClassicDca } from "../src/backtest.js";
import { detectRegime, openWindow } from "../src/engine.js";
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

  it("fear_greed_scale ×2 même avec régime (enveloppe ne doit pas écraser)", () => {
    const series = [makeSeries("AAA", "2024-01-01", 40, FLAT)];
    const s = baseStrategy({
      budget: { amount: 100, currency: "EUR", period: "monthly" },
      regime_adjustment: {
        bull: { budget_multiplier: 0.85 },
        neutral: { budget_multiplier: 1 },
        bear: { budget_multiplier: 1.15 },
      },
      timing_rules: [
        {
          type: "fear_greed_scale",
          low_lte: 35,
          low_factor: 2,
          high_gte: 80,
          high_factor: 0.5,
        },
      ],
    });
    const r = runBacktest(s, series, {
      from: "2024-01-01",
      to: "2024-01-31",
      feePct: 0,
      fearGreedByDate: new Map([["2024-01-01", 20]]),
    });
    // Neutre ×1 × F&G ×2 = 2 (pas clampé à 1.15)
    expect(r.windows[0]!.multiplier).toBeCloseTo(2, 6);
    expect(r.contributed).toBeCloseTo(200, 6);
  });

  it("require_signal + fenêtre 1 jour : achète si Fear match le dernier (seul) jour", () => {
    // Jan 2024 : le 29 est un lundi — fenêtre d’un seul jour ouvré.
    const series = [makeSeries("AAA", "2024-01-01", 35, FLAT)];
    const s = baseStrategy({
      budget: { amount: 150, currency: "EUR", period: "monthly" },
      window: { type: "day_of_month", from: 29, to: 29 },
      require_signal: true,
      timing_rules: [{ type: "fear_greed_below", value: 40 }],
    });
    const r = runBacktest(s, series, {
      from: "2024-01-01",
      to: "2024-01-31",
      feePct: 0,
      fearGreedByDate: new Map([["2024-01-29", 25]]),
    });
    expect(r.contributed).toBeCloseTo(150, 6);
    expect(r.invested).toBeCloseTo(150, 6);
    expect(r.purchases).toHaveLength(1);
    expect(r.purchases[0]!.kind).toBe("trigger");
    expect(r.purchases[0]!.date).toBe("2024-01-29");
  });

  it("require_signal + fenêtre 1 jour : 0 achat si Fear au-dessus du seuil", () => {
    const series = [makeSeries("AAA", "2024-01-01", 35, FLAT)];
    const s = baseStrategy({
      budget: { amount: 150, currency: "EUR", period: "monthly" },
      window: { type: "day_of_month", from: 29, to: 29 },
      require_signal: true,
      timing_rules: [{ type: "fear_greed_below", value: 40 }],
    });
    const r = runBacktest(s, series, {
      from: "2024-01-01",
      to: "2024-01-31",
      feePct: 0,
      fearGreedByDate: new Map([["2024-01-29", 70]]),
    });
    expect(r.contributed).toBeCloseTo(150, 6);
    expect(r.invested).toBeCloseTo(0, 6);
    expect(r.cash).toBeCloseTo(150, 6);
    expect(r.warnings.some((w) => /Aucun achat|uniquement si signal/i.test(w))).toBe(true);
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
    // Fenêtre 1–7 : dernier jour ouvré = vendredi 5 jan (6–7 = week-end).
    for (const p of r.purchases) {
      expect(p.date).toBe("2024-01-05");
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
    expect(r.purchases[0]!.date).toBe("2024-01-05");
    expect(r.purchases[0]!.kind).toBe("fallback");
    expect(r.invested).toBeCloseTo(300, 6);
  });

  it("fallback fin de fenêtre : budget neutre (×1) même si régime haussier", () => {
    // Marché haussier + dip impossible → fallback. Doit verser 200 (€ base), pas 140 (×0.7).
    const series = [makeSeries("AAA", "2023-03-01", 400, (i) => 100 + i)];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      splitting: { tranches: 2, distribution: "equal" },
      timing_rules: [{ type: "dip_trigger", drop_pct: 80 }],
      regime_adjustment: {
        scope: "per_asset",
        fallback_budget: "neutral",
        bull: { budget_multiplier: 0.7 },
        neutral: { budget_multiplier: 1 },
        bear: { budget_multiplier: 1.5 },
      },
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.windows[0]!.regime).toBe("bull");
    expect(r.contributed).toBeCloseTo(200, 6);
    expect(r.invested).toBeCloseTo(200, 6);
    expect(r.purchases.every((p) => p.kind === "fallback")).toBe(true);
    expect(r.purchases.reduce((s, p) => s + p.quoteAmount, 0)).toBeCloseTo(200, 6);
    for (const p of r.purchases) {
      expect(p.justification?.multiplier).toBeCloseTo(1, 6);
      expect(p.justification?.regime).toBe("neutral");
    }
  });

  it("fallback fin de fenêtre : si fallback_budget=regime, garde le multiplicateur", () => {
    const series = [makeSeries("AAA", "2023-03-01", 400, (i) => 100 + i)];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      splitting: { tranches: 1, distribution: "equal" },
      timing_rules: [{ type: "dip_trigger", drop_pct: 80 }],
      regime_adjustment: {
        scope: "per_asset",
        fallback_budget: "regime",
        bull: { budget_multiplier: 0.7 },
        neutral: { budget_multiplier: 1 },
        bear: { budget_multiplier: 1.5 },
      },
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.contributed).toBeCloseTo(140, 6);
    expect(r.invested).toBeCloseTo(140, 6);
    expect(r.purchases[0]!.justification?.multiplier).toBeCloseTo(0.7, 6);
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

  it("régime × paliers drawdown : les scales se multiplient (plus d’écrasement)", () => {
    const series = [makeSeries("AAA", "2023-03-01", 400, (i) => 500 - i)];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      regime_adjustment: {
        bull: { budget_multiplier: 0.85 },
        bear: { budget_multiplier: 1.15 },
      },
      budget_scale_tiers: {
        lookback_days: 365,
        drawdown: [{ gte_pct: 5, factor: 1.5 }],
      },
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.windows[0]!.regime).toBe("bear");
    // 1.15 (bear) × 1.5 (drawdown) = 1.725
    expect(r.windows[0]!.multiplier).toBeCloseTo(1.725, 6);
    expect(r.contributed).toBeCloseTo(345, 6);
    expect(r.invested).toBeCloseTo(345, 6);
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

  it("régime per_asset : chaque actif a son propre multiplicateur", () => {
    // AAA en hausse → bull ×0.5 ; BBB en baisse → bear ×2 ; poids 50/50 ; base 200
    // → versement = 200*0.5*0.5 + 200*0.5*2 = 50 + 200 = 250
    const series = [
      makeSeries("AAA", "2023-03-01", 400, (i) => 100 + i),
      makeSeries("BBB", "2023-03-01", 400, (i) => 500 - i),
    ];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      allocation: [
        { asset: "AAA", weight: 0.5 },
        { asset: "BBB", weight: 0.5 },
      ],
      regime_adjustment: {
        scope: "per_asset",
        bull: { budget_multiplier: 0.5 },
        bear: { budget_multiplier: 2 },
        neutral: { budget_multiplier: 1 },
      },
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    const w = r.windows[0]!;
    expect(w.perAsset?.AAA?.regime).toBe("bull");
    expect(w.perAsset?.BBB?.regime).toBe("bear");
    expect(w.perAsset?.AAA?.multiplier).toBeCloseTo(0.5, 6);
    expect(w.perAsset?.BBB?.multiplier).toBeCloseTo(2, 6);
    expect(w.plannedBudget).toBeCloseTo(250, 6);
    expect(r.contributed).toBeCloseTo(250, 6);
    expect(r.perAsset.find((a) => a.asset === "AAA")!.invested).toBeCloseTo(50, 6);
    expect(r.perAsset.find((a) => a.asset === "BBB")!.invested).toBeCloseTo(200, 6);
  });

  it("régime reference : un seul multiplicateur pour tous (rétrocompat)", () => {
    const series = [
      makeSeries("AAA", "2023-03-01", 400, (i) => 100 + i),
      makeSeries("BBB", "2023-03-01", 400, (i) => 500 - i),
    ];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      allocation: [
        { asset: "AAA", weight: 0.5 },
        { asset: "BBB", weight: 0.5 },
      ],
      regime_adjustment: {
        scope: "reference",
        reference_asset: "AAA",
        bull: { budget_multiplier: 0.5 },
        bear: { budget_multiplier: 2 },
        neutral: { budget_multiplier: 1 },
      },
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    const w = r.windows[0]!;
    expect(w.regime).toBe("bull");
    expect(w.perAsset?.AAA?.multiplier).toBeCloseTo(0.5, 6);
    expect(w.perAsset?.BBB?.multiplier).toBeCloseTo(0.5, 6);
    expect(w.plannedBudget).toBeCloseTo(100, 6);
  });

  it("per_asset : justificatif liste les € par actif (pas 200×mult global)", () => {
    const series = [
      makeSeries("AAA", "2023-03-01", 400, (i) => 100 + i),
      makeSeries("BBB", "2023-03-01", 400, (i) => 500 - i),
    ];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      allocation: [
        { asset: "AAA", weight: 0.5 },
        { asset: "BBB", weight: 0.5 },
      ],
      regime_adjustment: {
        scope: "per_asset",
        bull: { budget_multiplier: 0.5 },
        bear: { budget_multiplier: 2 },
        neutral: { budget_multiplier: 1 },
      },
    });
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31", feePct: 0 });
    expect(r.invested).toBeCloseTo(250, 6);
    const summary = r.windows[0]!.justification?.summary ?? "";
    expect(summary).toMatch(/AAA/);
    expect(summary).toMatch(/BBB/);
    expect(summary).not.toMatch(/200 × 0\.5 \(chaque actif/);
    expect(summary).toMatch(/50€|200€/);
  });

  it("per_asset : sans courbe propre → neutre (pas la SMA de référence)", () => {
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      allocation: [
        { asset: "AAA", weight: 0.5 },
        { asset: "BBB", weight: 0.5 },
      ],
      regime_adjustment: {
        scope: "per_asset",
        bull: { budget_multiplier: 0.5 },
        bear: { budget_multiplier: 2 },
        neutral: { budget_multiplier: 1 },
      },
    });
    // Référence = longue hausse (bull), mais BBB n’a pas de closes → doit rester neutre ×1
    const bullCloses = Array.from({ length: 250 }, (_, i) => 100 + i);
    const closesByAsset = new Map<string, number[]>([["AAA", bullCloses]]);
    const w = openWindow(
      s,
      { key: "M-2024-01", start: "2024-01-01", end: "2024-01-07" },
      new Map([
        ["AAA", ["2024-01-01"]],
        ["BBB", ["2024-01-01"]],
      ]),
      bullCloses,
      "seed",
      undefined,
      closesByAsset,
    );
    expect(w.assets.get("AAA")!.regime).toBe("bull");
    expect(w.assets.get("AAA")!.multiplier).toBeCloseTo(0.5, 6);
    expect(w.assets.get("BBB")!.regime).toBe("neutral");
    expect(w.assets.get("BBB")!.multiplier).toBeCloseTo(1, 6);
    expect(w.plannedBudget).toBeCloseTo(150, 6); // 50 + 100
  });

  it("fallback clôture : actif sans cotation dans la fenêtre est quand même acheté", () => {
    // 2026-03-01 = dimanche. Fenêtre jour 1 uniquement.
    // SPACE coté tous les jours ; STOCK seulement en semaine → 0 jour dans la fenêtre.
    const spaceCandles = [];
    const stockCandles = [];
    let d = "2025-12-01";
    for (let i = 0; i < 120; i++) {
      const close = 100;
      spaceCandles.push({
        date: d,
        open: close,
        high: close,
        low: close,
        close,
        volume: 0,
      });
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) {
        stockCandles.push({
          date: d,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1000,
        });
      }
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    const series = [
      { symbol: "SPACE", quote: "EUR", interval: "1d" as const, candles: spaceCandles },
      { symbol: "STOCK", quote: "EUR", interval: "1d" as const, candles: stockCandles },
    ];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      window: { type: "day_of_month", from: 1, to: 1 },
      allocation: [
        { asset: "SPACE", weight: 0.004 },
        { asset: "STOCK", weight: 0.996 },
      ],
      regime_adjustment: {
        scope: "per_asset",
        fallback_budget: "neutral",
        bull: { budget_multiplier: 0.85 },
        neutral: { budget_multiplier: 1 },
        bear: { budget_multiplier: 1.5 },
      },
    });
    // Inclut le lundi 2 mars (réouverture) après le dimanche 1er.
    const r = runBacktest(s, series, { from: "2026-03-01", to: "2026-03-06", feePct: 0 });
    expect(r.invested).toBeCloseTo(200, 6);
    expect(r.purchases.some((p) => p.asset === "SPACE")).toBe(true);
    const stockBuy = r.purchases.find((p) => p.asset === "STOCK")!;
    const spaceBuy = r.purchases.find((p) => p.asset === "SPACE")!;
    expect(stockBuy.kind).toBe("fallback");
    expect(stockBuy.date).toBe("2026-03-02");
    expect(stockBuy.reason).toMatch(/réouverture/);
    expect(spaceBuy.date).toBe("2026-03-02");
    expect(spaceBuy.reason).toMatch(/réouverture/);
    expect(spaceBuy.quoteAmount).toBeCloseTo(0.8, 6);
    expect(stockBuy.quoteAmount).toBeCloseTo(199.2, 6);
  });

  it("fenêtre 1-1 week-end : chaque mois verse ~200€ (SpaceX + actions)", () => {
    const spaceCandles = [];
    const stockCandles = [];
    let d = "2025-01-01";
    for (let i = 0; i < 500; i++) {
      const close = 100;
      spaceCandles.push({
        date: d,
        open: close,
        high: close,
        low: close,
        close,
        volume: 0,
      });
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) {
        stockCandles.push({
          date: d,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1000,
        });
      }
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    const series = [
      { symbol: "SPACE", quote: "EUR", interval: "1d" as const, candles: spaceCandles },
      { symbol: "STOCK", quote: "EUR", interval: "1d" as const, candles: stockCandles },
    ];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      window: { type: "day_of_month", from: 1, to: 1 },
      splitting: { tranches: 1, distribution: "equal" },
      allocation: [
        { asset: "SPACE", weight: 0.004 },
        { asset: "STOCK", weight: 0.996 },
      ],
      regime_adjustment: {
        scope: "per_asset",
        fallback_budget: "neutral",
        bull: { budget_multiplier: 0.85 },
        neutral: { budget_multiplier: 1 },
        bear: { budget_multiplier: 1.5 },
      },
    });
    const r = runBacktest(s, series, { from: "2026-01-01", to: "2026-04-30", feePct: 0 });
    for (const key of ["M-2026-02", "M-2026-03"]) {
      const w = r.windows.find((x) => x.key === key)!;
      const buys = r.purchases.filter((p) => p.windowKey === key);
      expect(w.invested).toBeCloseTo(200, 0);
      expect(buys.reduce((sum, p) => sum + p.quoteAmount, 0)).toBeCloseTo(200, 0);
      expect(buys.every((p) => p.reason.includes("réouverture") || p.date > `${key.slice(2)}-01`)).toBe(
        true,
      );
    }
  });

  it("fallback clôture : horizon qui s’arrête le jour 1 (week-end) verse quand même tout", () => {
    const spaceCandles = [];
    const stockCandles = [];
    let d = "2025-12-01";
    for (let i = 0; i < 120; i++) {
      const close = 100;
      spaceCandles.push({
        date: d,
        open: close,
        high: close,
        low: close,
        close,
        volume: 0,
      });
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) {
        stockCandles.push({
          date: d,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1000,
        });
      }
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    const series = [
      { symbol: "SPACE", quote: "EUR", interval: "1d" as const, candles: spaceCandles },
      { symbol: "STOCK", quote: "EUR", interval: "1d" as const, candles: stockCandles },
    ];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      // Jour 1 seul + 1er mars 2026 = dimanche → seul SPACE coté ce jour-là.
      window: { type: "day_of_month", from: 1, to: 1 },
      allocation: [
        { asset: "SPACE", weight: 0.004 },
        { asset: "STOCK", weight: 0.996 },
      ],
    });
    const r = runBacktest(s, series, { from: "2026-02-01", to: "2026-03-01", feePct: 0 });
    const march = r.purchases.filter((p) => p.windowKey === "M-2026-03");
    expect(march.reduce((sum, p) => sum + p.quoteAmount, 0)).toBeCloseTo(200, 6);
    expect(march.some((p) => p.asset === "STOCK" && p.kind === "fallback")).toBe(true);
  });

  it("fenêtre 1–7 : aucun achat un dimanche (ex. 1er mars 2026)", () => {
    const spaceCandles = [];
    const stockCandles = [];
    let d = "2025-12-01";
    for (let i = 0; i < 120; i++) {
      const close = 100;
      spaceCandles.push({
        date: d,
        open: close,
        high: close,
        low: close,
        close,
        volume: 0,
      });
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) {
        stockCandles.push({
          date: d,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1000,
        });
      }
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    const series = [
      { symbol: "SPACE", quote: "EUR", interval: "1d" as const, candles: spaceCandles },
      { symbol: "STOCK", quote: "EUR", interval: "1d" as const, candles: stockCandles },
    ];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      window: { type: "day_of_month", from: 1, to: 7 },
      splitting: { tranches: 1, distribution: "equal" },
      allocation: [
        { asset: "SPACE", weight: 0.004 },
        { asset: "STOCK", weight: 0.996 },
      ],
    });
    const r = runBacktest(s, series, { from: "2026-03-01", to: "2026-03-10", feePct: 0 });
    expect(r.purchases.some((p) => p.date === "2026-03-01")).toBe(false);
    expect(r.invested).toBeCloseTo(200, 0);
    expect(r.purchases.every((p) => p.date >= "2026-03-02")).toBe(true);
  });

  it("fenêtre 1-1 dimanche SANS série week-end : tous les actifs achetés le lundi", () => {
    // Aucune bougie le dimanche 1er — premier jour du backtest = lundi 2.
    // Ancien bug : cash versé, invested=0 (fenêtre « sautée »).
    const stockCandles = [];
    let d = "2025-12-01";
    for (let i = 0; i < 120; i++) {
      const close = 100;
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) {
        stockCandles.push({
          date: d,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1000,
        });
      }
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    const series = [
      { symbol: "AAA", quote: "EUR", interval: "1d" as const, candles: stockCandles },
      { symbol: "BBB", quote: "EUR", interval: "1d" as const, candles: [...stockCandles] },
    ];
    const s = baseStrategy({
      budget: { amount: 200, currency: "EUR", period: "monthly" },
      window: { type: "day_of_month", from: 1, to: 1 },
      splitting: { tranches: 1, distribution: "equal" },
      allocation: [
        { asset: "AAA", weight: 0.5 },
        { asset: "BBB", weight: 0.5 },
      ],
    });
    const r = runBacktest(s, series, { from: "2026-03-01", to: "2026-03-06", feePct: 0 });
    expect(r.invested).toBeCloseTo(200, 6);
    expect(r.purchases).toHaveLength(2);
    expect(r.purchases.every((p) => p.date === "2026-03-02")).toBe(true);
    expect(r.purchases.find((p) => p.asset === "AAA")!.quoteAmount).toBeCloseTo(100, 6);
    expect(r.purchases.find((p) => p.asset === "BBB")!.quoteAmount).toBeCloseTo(100, 6);
  });

  it("signale un avertissement si la devise de cotation diffère du budget", () => {
    const series = [makeSeries("AAA", "2024-01-01", 40, FLAT, "USD")];
    const s = baseStrategy();
    const r = runBacktest(s, series, { from: "2024-01-01", to: "2024-01-31" });
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toMatch(/USD/);
  });
});
