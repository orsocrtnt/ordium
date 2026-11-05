import { describe, expect, it } from "vitest";
import {
  SymbolNotSupportedError,
  binanceProvider,
  coinbaseProvider,
  createAlpacaProvider,
  createPolygonProvider,
  krakenProvider,
  yahooProvider,
  type FetchQuery,
} from "../src/index.js";

function query(overrides: Partial<FetchQuery>): FetchQuery {
  return {
    symbol: "BTC",
    assetType: "crypto",
    timeframe: "1d",
    from: "2024-01-01",
    to: "2024-06-01",
    quote: "EUR",
    ...overrides,
  };
}

describe("résolution des symboles par fournisseur", () => {
  it("Binance : paire concaténée", () => {
    expect(binanceProvider.resolveSymbol(query({}))).toBe("BTCEUR");
    expect(binanceProvider.resolveSymbol(query({ quote: undefined }))).toBe("BTCEUR");
  });

  it("Coinbase : produit avec tiret", () => {
    expect(coinbaseProvider.resolveSymbol(query({ quote: "USD" }))).toBe("BTC-USD");
  });

  it("Kraken : alias XBT/XDG", () => {
    expect(krakenProvider.resolveSymbol(query({}))).toBe("XBTEUR");
    expect(krakenProvider.resolveSymbol(query({ symbol: "DOGE" }))).toBe("XDGEUR");
    expect(krakenProvider.resolveSymbol(query({ symbol: "ETH" }))).toBe("ETHEUR");
  });

  it("Yahoo : crypto avec tiret, forex en =X, aliases ETF", () => {
    expect(yahooProvider.resolveSymbol(query({ quote: undefined }))).toBe("BTC-USD");
    expect(yahooProvider.resolveSymbol(query({ symbol: "EUR/USD", assetType: "forex" }))).toBe(
      "EURUSD=X",
    );
    expect(yahooProvider.resolveSymbol(query({ symbol: "MC.PA", assetType: "stock" }))).toBe(
      "MC.PA",
    );
    expect(yahooProvider.resolveSymbol(query({ symbol: "IWDA", assetType: "etf" }))).toBe(
      "IWDA.AS",
    );
  });

  it("Alpaca : US only, refuse les suffixes EU", () => {
    const alpaca = createAlpacaProvider("key", "secret");
    expect(alpaca.resolveSymbol(query({ symbol: "AAPL", assetType: "stock" }))).toBe("AAPL");
    expect(alpaca.resolveSymbol(query({ symbol: "MC.PA", assetType: "stock" }))).toBeNull();
    expect(alpaca.resolveSymbol(query({ symbol: "IWDA.AS", assetType: "etf" }))).toBeNull();
  });

  it("Polygon : préfixes X: et C:", () => {
    const polygon = createPolygonProvider("clé-test");
    expect(polygon.resolveSymbol(query({ quote: "USD" }))).toBe("X:BTCUSD");
    expect(polygon.resolveSymbol(query({ symbol: "EUR/USD", assetType: "forex" }))).toBe(
      "C:EURUSD",
    );
    expect(polygon.resolveSymbol(query({ symbol: "AAPL", assetType: "stock" }))).toBe("AAPL");
  });
});

describe("garde d'historique Kraken", () => {
  it("refuse une plage plus ancienne que ~720 jours (le routeur passera au suivant)", async () => {
    await expect(
      krakenProvider.fetchCandles(query({ from: "2020-01-01" })),
    ).rejects.toThrow(SymbolNotSupportedError);
  });
});
