import { describe, expect, it } from "vitest";
import type { AssetSeries } from "@ordium/engine";
import {
  DataRouter,
  QuotaExceededError,
  SymbolNotSupportedError,
  type FetchQuery,
  type MarketDataProvider,
} from "../src/index.js";

function series(source: string): AssetSeries {
  return {
    symbol: "BTC",
    quote: "EUR",
    interval: "1d",
    source,
    assetType: "crypto",
    candles: [{ date: "2024-01-01", open: 1, high: 1, low: 1, close: 1, volume: 0 }],
  };
}

function fakeProvider(
  id: string,
  priority: number,
  behavior: (q: FetchQuery) => Promise<AssetSeries>,
  calls: string[],
): MarketDataProvider {
  return {
    id,
    capabilities: {
      assetTypes: ["crypto"],
      timeframes: ["1d"],
      license: "libre",
      rateLimits: {},
      priority,
    },
    resolveSymbol: (q) => q.symbol,
    fetchCandles: (q) => {
      calls.push(id);
      return behavior(q);
    },
  };
}

const QUERY: FetchQuery = {
  symbol: "BTC",
  assetType: "crypto",
  timeframe: "1d",
  from: "2024-01-01",
  to: "2024-01-31",
};

describe("DataRouter", () => {
  it("essaie les fournisseurs par priorité croissante", async () => {
    const calls: string[] = [];
    const router = new DataRouter([
      fakeProvider("secondaire", 20, async () => series("secondaire"), calls),
      fakeProvider("primaire", 10, async () => series("primaire"), calls),
    ]);
    const result = await router.fetch(QUERY);
    expect(result.source).toBe("primaire");
    expect(calls).toEqual(["primaire"]);
  });

  it("bascule sur le suivant en cas de panne", async () => {
    const calls: string[] = [];
    const router = new DataRouter([
      fakeProvider("casse", 10, async () => Promise.reject(new Error("HTTP 500")), calls),
      fakeProvider("secours", 20, async () => series("secours"), calls),
    ]);
    const result = await router.fetch(QUERY);
    expect(result.source).toBe("secours");
    expect(calls).toEqual(["casse", "secours"]);
  });

  it("bascule sur quota épuisé sans pénaliser le breaker", async () => {
    const calls: string[] = [];
    const router = new DataRouter([
      fakeProvider(
        "limité",
        10,
        async () => Promise.reject(new QuotaExceededError("limité", "journalier")),
        calls,
      ),
      fakeProvider("secours", 20, async () => series("secours"), calls),
    ]);
    for (let i = 0; i < 5; i++) {
      const result = await router.fetch(QUERY);
      expect(result.source).toBe("secours");
    }
    // Sans cooldown, le fournisseur limité est retenté à chaque fois.
    expect(calls.filter((c) => c === "limité")).toHaveLength(5);
  });

  it("ouvre le circuit breaker après 3 pannes, puis sert via le secours", async () => {
    const calls: string[] = [];
    const router = new DataRouter([
      fakeProvider("casse", 10, async () => Promise.reject(new Error("HTTP 500")), calls),
      fakeProvider("secours", 20, async () => series("secours"), calls),
    ]);
    for (let i = 0; i < 5; i++) await router.fetch(QUERY);
    // 3 échecs ouvrent le breaker : les appels 4 et 5 ne retentent plus "casse".
    expect(calls.filter((c) => c === "casse")).toHaveLength(3);
    expect(calls.filter((c) => c === "secours")).toHaveLength(5);
  });

  it("ignore un symbole inconnu sans pénaliser le breaker", async () => {
    const calls: string[] = [];
    const router = new DataRouter([
      fakeProvider(
        "ignorant",
        10,
        async () => Promise.reject(new SymbolNotSupportedError("ignorant", "BTC")),
        calls,
      ),
      fakeProvider("secours", 20, async () => series("secours"), calls),
    ]);
    for (let i = 0; i < 5; i++) await router.fetch(QUERY);
    expect(calls.filter((c) => c === "ignorant")).toHaveLength(5);
  });

  it("échoue avec le détail de chaque fournisseur si tous échouent", async () => {
    const calls: string[] = [];
    const router = new DataRouter([
      fakeProvider("a", 10, async () => Promise.reject(new Error("panne A")), calls),
      fakeProvider("b", 20, async () => Promise.reject(new Error("panne B")), calls),
    ]);
    await expect(router.fetch(QUERY)).rejects.toThrow(/panne A[\s\S]*panne B/);
  });

  it("échoue clairement si aucun fournisseur ne couvre la classe d'actif", async () => {
    const router = new DataRouter([]);
    await expect(router.fetch(QUERY)).rejects.toThrow(/Aucun fournisseur/);
  });

  it("écarte les fournisseurs fallbackOnly quand la classe est devinée", async () => {
    const calls: string[] = [];
    const provider = fakeProvider("généraliste", 10, async () => series("généraliste"), calls);
    provider.capabilities.fallbackOnly = ["crypto"];
    const router = new DataRouter([provider]);

    await expect(router.fetch(QUERY, { guessed: true })).rejects.toThrow(/Aucun fournisseur/);
    const result = await router.fetch(QUERY); // classe connue : le fournisseur sert
    expect(result.source).toBe("généraliste");
  });
});
