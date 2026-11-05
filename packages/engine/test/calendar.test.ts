import { describe, expect, it } from "vitest";
import { isWeekend, nextWeekdayOnOrAfter, resolveWindows, toBusinessDay } from "../src/calendar.js";
import { baseStrategy } from "./helpers.js";

describe("resolveWindows", () => {
  it("instancie une fenêtre mensuelle 1-7 par mois", () => {
    const s = baseStrategy();
    const windows = resolveWindows(s, "2024-01-01", "2024-03-31");
    expect(windows).toHaveLength(3);
    expect(windows[0]).toMatchObject({ start: "2024-01-01", end: "2024-01-07" });
    expect(windows[2]).toMatchObject({ start: "2024-03-01", end: "2024-03-07" });
  });

  it("exclut les fenêtres partiellement hors de l'intervalle", () => {
    const s = baseStrategy();
    const windows = resolveWindows(s, "2024-01-03", "2024-03-31");
    expect(windows.map((w) => w.start)).toEqual(["2024-02-01", "2024-03-01"]);
  });

  it("borne le jour au dernier jour du mois (février)", () => {
    const s = baseStrategy({ window: { type: "day_of_month", from: 25, to: 31 } });
    const windows = resolveWindows(s, "2024-02-01", "2024-02-29");
    expect(windows[0]).toMatchObject({ start: "2024-02-25", end: "2024-02-29" });
  });

  it("gère les fenêtres hebdomadaires lundi-mercredi", () => {
    const s = baseStrategy({
      budget: { amount: 100, currency: "EUR", period: "weekly" },
      window: { type: "day_of_week", from: 1, to: 3 },
    });
    // 2024-01-01 est un lundi.
    const windows = resolveWindows(s, "2024-01-01", "2024-01-21");
    expect(windows).toHaveLength(3);
    expect(windows[0]).toMatchObject({ start: "2024-01-01", end: "2024-01-03" });
    expect(windows[1]).toMatchObject({ start: "2024-01-08", end: "2024-01-10" });
  });

  it("gère un budget annuel avec mois choisi", () => {
    const s = baseStrategy({
      budget: { amount: 1200, currency: "EUR", period: "yearly" },
      window: { type: "day_of_month", from: 1, to: 7, month: 6 },
    });
    const windows = resolveWindows(s, "2023-01-01", "2024-12-31");
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ start: "2023-06-01", end: "2023-06-07" });
  });
});

describe("isWeekend / nextWeekdayOnOrAfter", () => {
  it("détecte le week-end et trouve le lundi suivant", () => {
    expect(isWeekend("2026-03-01")).toBe(true);
    expect(isWeekend("2026-03-02")).toBe(false);
    expect(nextWeekdayOnOrAfter("2026-03-01")).toBe("2026-03-02");
    expect(nextWeekdayOnOrAfter("2026-03-02")).toBe("2026-03-02");
    expect(toBusinessDay("2026-03-01")).toBe("2026-03-02");
  });
});
