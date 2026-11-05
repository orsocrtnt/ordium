import { describe, expect, it } from "vitest";
import type { AssetSeries } from "@ordium/engine";
import { buildRealSeries, valuePortfolio, type Portfolio } from "../src/index.js";

function series(symbol: string, closes: [string, number][]): AssetSeries {
  return {
    symbol,
    quote: "EUR",
    interval: "1d",
    candles: closes.map(([date, close]) => ({
      date,
      open: close,
      high: close,
      low: close,
      close,
      volume: 0,
    })),
  };
}

const portfolio: Portfolio = {
  name: "Test",
  currency: "EUR",
  source: "csv",
  importedAt: "2024-01-01T00:00:00Z",
  transactions: [
    { date: "2024-01-02", side: "buy", asset: "BTC", quantity: 0.1, price: 40000, amount: 4000 },
    { date: "2024-01-04", side: "buy", asset: "ETH", quantity: 2, price: 2000, amount: 4000 },
    { date: "2024-01-06", side: "sell", asset: "BTC", quantity: 0.05, price: 44000, amount: 2200 },
  ],
  holdings: [
    { asset: "BTC", quantity: 0.05 },
    { asset: "ETH", quantity: 2 },
  ],
  warnings: [],
};

const btc = series("BTC", [
  ["2024-01-02", 40000],
  ["2024-01-03", 42000],
  ["2024-01-04", 41000],
  ["2024-01-05", 43000],
  ["2024-01-06", 44000],
  ["2024-01-08", 45000],
]);
const eth = series("ETH", [
  ["2024-01-02", 1900],
  ["2024-01-03", 1950],
  ["2024-01-04", 2000],
  ["2024-01-05", 2100],
  ["2024-01-06", 2050],
  ["2024-01-08", 2200],
]);

describe("valuePortfolio", () => {
  it("valorise positions, poids et coût moyen", () => {
    const v = valuePortfolio(portfolio, [btc, eth]);
    // BTC : 0,05 × 45 000 = 2 250 ; ETH : 2 × 2 200 = 4 400.
    expect(v.totalValue).toBeCloseTo(6650);
    const ethPos = v.positions.find((p) => p.asset === "ETH")!;
    expect(ethPos.value).toBeCloseTo(4400);
    expect(ethPos.weightPct).toBeCloseTo((4400 / 6650) * 100);
    expect(ethPos.avgCost).toBeCloseTo(2000);
    // Net investi : 4000 + 4000 − 2200 = 5800.
    expect(v.netInvested).toBeCloseTo(5800);
    expect(v.plPct).toBeCloseTo(((6650 - 5800) / 5800) * 100);
  });

  it("le coût moyen sort au prorata lors d'une vente", () => {
    const v = valuePortfolio(portfolio, [btc, eth]);
    const btcPos = v.positions.find((p) => p.asset === "BTC")!;
    // Achat 4000 pour 0,1 ; vente de la moitié → coût restant 2000 pour 0,05.
    expect(btcPos.invested).toBeCloseTo(2000);
    expect(btcPos.avgCost).toBeCloseTo(40000);
  });

  it("signale les actifs sans données de marché", () => {
    const v = valuePortfolio(portfolio, [btc]);
    expect(v.missingData).toEqual(["ETH"]);
    expect(v.positions.find((p) => p.asset === "ETH")!.value).toBeNull();
  });

  it("utilise les valeurs d'import quand aucune série marché n'est fournie", () => {
    const snap: Portfolio = {
      name: "Snap",
      currency: "EUR",
      source: "manual",
      importedAt: "2024-01-01T00:00:00Z",
      transactions: [],
      holdings: [
        { asset: "NVDA", quantity: 3, price: 100, invested: 200, value: 300, pnl: 100, pnlPct: 50 },
        { asset: "AAPL", quantity: 1, price: 200, invested: 180, value: 200, pnl: 20, pnlPct: 11.11 },
      ],
      warnings: [],
    };
    const v = valuePortfolio(snap, []);
    expect(v.totalValue).toBeCloseTo(500);
    expect(v.netInvested).toBeCloseTo(380);
    expect(v.positions.find((p) => p.asset === "NVDA")!.value).toBeCloseTo(300);
  });
});

describe("buildRealSeries", () => {
  it("reconstruit la valeur jour par jour avec les transactions", () => {
    const real = buildRealSeries(portfolio, [btc, eth], "2024-01-02", "2024-01-08");
    expect(real.points[0]).toMatchObject({
      date: "2024-01-02",
      value: expect.closeTo(0.1 * 40000, 6),
      contributed: 4000,
    });
    expect(real.points[0]!.assets?.BTC?.value).toBeCloseTo(0.1 * 40000);
    // Fin de période : 0,05 BTC restants après vente.
    expect(real.perAsset.find((a) => a.asset === "BTC")?.quantity).toBeCloseTo(0.05);
    // Le 4 : 0,1 BTC × 41 000 + 2 ETH × 2 000 = 8 100 ; investi 8 000.
    const jan4 = real.points.find((p) => p.date === "2024-01-04")!;
    expect(jan4.value).toBeCloseTo(8100);
    expect(jan4.contributed).toBe(8000);
    // Le 8 : 0,05 × 45 000 + 2 × 2 200 = 6 650 ; investi net 5 800.
    expect(real.finalValue).toBeCloseTo(6650);
    expect(real.netInvested).toBeCloseTo(5800);
  });

  it("prend en compte les transactions antérieures à la fenêtre", () => {
    const real = buildRealSeries(portfolio, [btc, eth], "2024-01-05", "2024-01-08");
    // Au 5 : 0,1 BTC + 2 ETH déjà en portefeuille.
    expect(real.points[0]!.value).toBeCloseTo(0.1 * 43000 + 2 * 2100);
    expect(real.points[0]!.contributed).toBe(8000);
  });

  it("refuse un portefeuille sans transactions", () => {
    expect(() =>
      buildRealSeries({ ...portfolio, transactions: [] }, [btc], "2024-01-01", "2024-01-08"),
    ).toThrow(/historique de transactions/);
  });
});
