import { describe, expect, it } from "vitest";
import { parseStrategy } from "../src/schema.js";

const valid = {
  name: "DCA crypto",
  budget: { amount: 1000, currency: "EUR", period: "monthly" },
  window: { type: "day_of_month", from: 1, to: 7 },
  allocation: [
    { asset: "BTC", weight: 0.6 },
    { asset: "ETH", weight: 0.4 },
  ],
};

describe("parseStrategy", () => {
  it("accepte une stratégie valide et applique les défauts", () => {
    const s = parseStrategy(valid);
    expect(s.splitting).toEqual({ tranches: 1, distribution: "equal" });
    expect(s.timing_rules).toEqual([]);
  });

  it("rejette une allocation dont les poids ne somment pas à 1", () => {
    expect(() =>
      parseStrategy({ ...valid, allocation: [{ asset: "BTC", weight: 0.5 }] }),
    ).toThrow(/somme des poids/i);
  });

  it("rejette une fenêtre incompatible avec la période du budget", () => {
    expect(() =>
      parseStrategy({ ...valid, window: { type: "day_of_week", from: 1, to: 3 } }),
    ).toThrow(/incompatible/i);
  });

  it("rejette une fenêtre inversée (from > to)", () => {
    expect(() =>
      parseStrategy({ ...valid, window: { type: "day_of_month", from: 10, to: 3 } }),
    ).toThrow(/from <= to/i);
  });

  it("accepte un actif de référence hors allocation (benchmark)", () => {
    const s = parseStrategy({
      ...valid,
      regime_adjustment: {
        reference_asset: "IWDA.AS",
        bull: { budget_multiplier: 0.7 },
        bear: { budget_multiplier: 1.5 },
      },
    });
    expect(s.regime_adjustment?.reference_asset).toBe("IWDA.AS");
  });
});
