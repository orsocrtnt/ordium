import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/backtest.js";
import { baseStrategy, makeSeries } from "./helpers.js";

describe("accounting invariant", () => {
  it("contributed === cash + invested ; perAsset sum === invested", () => {
    const series = [
      makeSeries("BTC", "2024-01-01", 120, () => 50000),
      makeSeries("ETH", "2024-01-01", 120, () => 3000),
      makeSeries("SOL", "2024-01-01", 120, () => 100),
    ];
    const s = baseStrategy({
      name: "fg",
      budget: { amount: 150, currency: "EUR", period: "monthly" },
      window: { type: "day_of_month", from: 29, to: 29 },
      require_signal: true,
      allocation: [
        { asset: "BTC", weight: 0.333 },
        { asset: "ETH", weight: 0.334 },
        { asset: "SOL", weight: 0.333 },
      ],
      timing_rules: [{ type: "fear_greed_below", value: 40 }],
    });
    const fng = new Map<string, number>();
    for (let m = 1; m <= 4; m++) {
      fng.set(`2024-0${m}-29`, m % 2 === 1 ? 20 : 70);
    }
    const r = runBacktest(s, series, {
      from: "2024-01-01",
      to: "2024-04-30",
      feePct: 0.1,
      fearGreedByDate: fng,
    });
    const perSum = r.perAsset.reduce((s, a) => s + a.invested, 0);
    const purchaseSum = r.purchases.reduce((s, p) => s + p.quoteAmount, 0);
    expect(perSum).toBeCloseTo(r.invested, 6);
    expect(purchaseSum).toBeCloseTo(r.invested, 6);
    expect(r.cash + r.invested).toBeCloseTo(r.contributed, 6);
    expect(r.cash + r.holdingsValue).toBeCloseTo(r.totalValue, 6);
  });
});
