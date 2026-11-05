import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAlpacaPortfolio } from "../src/connectors/alpaca.js";
import { fetchIbkrPortfolio } from "../src/connectors/ibkr.js";
import {
  fetchTrading212Portfolio,
  normalizeTrading212Ticker,
} from "../src/connectors/trading212.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeTrading212Ticker", () => {
  it("extrait le symbole court", () => {
    expect(normalizeTrading212Ticker("AAPL_US_EQ")).toBe("AAPL");
    expect(normalizeTrading212Ticker("IWDA_EQ")).toBe("IWDA");
  });
});

describe("fetchAlpacaPortfolio", () => {
  it("mappe les positions paper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("paper-api.alpaca.markets");
        return {
          ok: true,
          json: async () => [
            {
              symbol: "AAPL",
              qty: "10",
              avg_entry_price: "150",
              current_price: "180",
              market_value: "1800",
              cost_basis: "1500",
              unrealized_pl: "300",
              unrealized_plpc: "0.2",
              side: "long",
            },
          ],
        };
      }),
    );

    const result = await fetchAlpacaPortfolio({ apiKey: "k", apiSecret: "s" }, "paper");
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0]).toMatchObject({
      asset: "AAPL",
      quantity: 10,
      avgPrice: 150,
      value: 1800,
      pnl: 300,
      pnlPct: 20,
    });
    expect(result.warnings.some((w) => /paper/i.test(w))).toBe(true);
  });
});

describe("fetchTrading212Portfolio", () => {
  it("mappe les positions demo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("demo.trading212.com");
        return {
          ok: true,
          json: async () => [
            {
              ticker: "AAPL_US_EQ",
              quantity: 5,
              averagePricePaid: 100,
              currentPrice: 120,
              walletImpact: {
                totalCost: 500,
                currentValue: 600,
                unrealizedProfitLoss: 100,
              },
              instrument: { ticker: "AAPL_US_EQ", name: "Apple Inc." },
            },
          ],
        };
      }),
    );

    const result = await fetchTrading212Portfolio({ apiKey: "k", apiSecret: "s" }, "paper");
    expect(result.holdings[0]).toMatchObject({
      asset: "AAPL",
      name: "Apple Inc.",
      quantity: 5,
      avgPrice: 100,
      invested: 500,
      value: 600,
      pnl: 100,
    });
  });
});

describe("fetchIbkrPortfolio", () => {
  it("enchaîne SendRequest puis parse OpenPosition", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("SendRequest")) {
        return {
          ok: true,
          text: async () =>
            `<FlexStatementResponse><Status>Success</Status><ReferenceCode>99</ReferenceCode></FlexStatementResponse>`,
        };
      }
      return {
        ok: true,
        text: async () => `
          <FlexQueryResponse>
            <OpenPosition symbol="NVDA" position="3" markPrice="100" costBasisPrice="80"
              costBasisMoney="240" positionValue="300" fifoPnlUnrealized="60" description="NVIDIA" />
          </FlexQueryResponse>`,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchIbkrPortfolio({ apiKey: "token", apiSecret: "123" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.holdings[0]).toMatchObject({
      asset: "NVDA",
      quantity: 3,
      avgPrice: 80,
      price: 100,
      invested: 240,
      value: 300,
      pnl: 60,
    });
  });
});
