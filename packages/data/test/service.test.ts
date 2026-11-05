import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssetSeries, Candle } from "@ordium/engine";
import {
  DataRouter,
  getHistoricalPrices,
  loadSeries,
  saveSeries,
  type FetchQuery,
  type MarketDataProvider,
} from "../src/index.js";

function candlesBetween(from: string, to: string): Candle[] {
  const out: Candle[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (; t <= end; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push({ date, open: 100, high: 101, low: 99, close: 100, volume: 1 });
  }
  return out;
}

/** Fournisseur simulé qui possède [origin → horizon] et journalise ses appels. */
function fakeProvider(origin: string, horizon: string, log: FetchQuery[]): MarketDataProvider {
  return {
    id: "fake",
    capabilities: {
      assetTypes: ["crypto", "stock"],
      timeframes: ["1d"],
      license: "libre",
      rateLimits: {},
      priority: 1,
    },
    resolveSymbol: (q) => q.symbol,
    fetchCandles: async (q) => {
      log.push(q);
      const from = q.from > origin ? q.from : origin;
      const to = q.to < horizon ? q.to : horizon;
      return {
        symbol: q.symbol.toUpperCase(),
        quote: (q.quote ?? "EUR").toUpperCase(),
        interval: "1d",
        source: "fake",
        assetType: q.assetType,
        candles: from <= to ? candlesBetween(from, to) : [],
      };
    },
  };
}

describe("getHistoricalPrices", () => {
  let dir: string;
  let log: FetchQuery[];
  let router: DataRouter;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ordium-data-"));
    log = [];
    router = new DataRouter([fakeProvider("2020-01-01", "2099-01-01", log)]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const get = (from: string, to: string, quote?: string) =>
    getHistoricalPrices("BTC", "crypto", "1d", from, to, { dataDir: dir, router, quote });

  it("télécharge, met en cache, puis sert depuis le cache sans appel API", async () => {
    const first = await get("2021-01-01", "2021-03-01");
    expect(first.candles[0]!.date).toBe("2021-01-01");
    expect(first.candles[first.candles.length - 1]!.date).toBe("2021-03-01");
    expect(log).toHaveLength(1);

    const second = await get("2021-01-15", "2021-02-15");
    expect(second.candles[0]!.date).toBe("2021-01-15");
    expect(log).toHaveLength(1); // aucun nouvel appel : cache suffisant
  });

  it("ne récupère que le delta quand le cache est en retard", async () => {
    await get("2021-01-01", "2021-02-01");
    await get("2021-01-01", "2021-04-01");
    expect(log).toHaveLength(2);
    expect(log[1]!.from).toBe("2021-02-02"); // lendemain de la dernière bougie en cache

    const stored = await loadSeries(dir, "BTC", "EUR");
    expect(stored!.candles[0]!.date).toBe("2021-01-01");
    expect(stored!.candles[stored!.candles.length - 1]!.date).toBe("2021-04-01");
  });

  it("re-télécharge depuis le début si la plage demandée précède le cache", async () => {
    await get("2022-01-01", "2022-02-01");
    const result = await get("2021-06-01", "2022-02-01");
    expect(result.candles[0]!.date).toBe("2021-06-01");
    expect(log[1]!.from).toBe("2021-06-01");
  });

  it("sert le cache si le fournisseur n'a rien de plus récent (week-end)", async () => {
    log = [];
    router = new DataRouter([fakeProvider("2020-01-01", "2021-02-01", log)]);
    await get("2021-01-01", "2021-02-01");
    const result = await get("2021-01-01", "2021-02-05"); // au-delà de l'horizon du fournisseur
    expect(result.candles[result.candles.length - 1]!.date).toBe("2021-02-01");
  });

  it("prolonge une série dans SA devise, même si une autre est demandée", async () => {
    await get("2021-01-01", "2021-02-01", "EUR");
    await get("2021-01-01", "2021-03-01", "USD"); // pas de série USD : on prolonge la EUR
    expect(log[1]!.quote).toBe("EUR");
  });

  it("strictQuote crée une série séparée par devise", async () => {
    await get("2021-01-01", "2021-02-01", "EUR");
    await getHistoricalPrices("BTC", "crypto", "1d", "2021-01-01", "2021-02-01", {
      dataDir: dir,
      router,
      quote: "USD",
      strictQuote: true,
    });
    expect(await loadSeries(dir, "BTC", "USD").then((s) => s?.quote)).toBe("USD");
    expect(await loadSeries(dir, "BTC", "EUR").then((s) => s?.quote)).toBe("EUR");
  });

  it("devine la classe d'actif depuis le cache hérité de la phase 0", async () => {
    const legacy: AssetSeries = {
      symbol: "SPY",
      quote: "USD",
      interval: "1d",
      source: "yahoo", // pas d'assetType : cache de la phase 0
      candles: candlesBetween("2021-01-01", "2021-02-01"),
    };
    await saveSeries(dir, legacy);
    await getHistoricalPrices("SPY", undefined, "1d", "2021-01-01", "2021-03-01", {
      dataDir: dir,
      router,
    });
    expect(log[0]!.assetType).toBe("stock");
  });
});
