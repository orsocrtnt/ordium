/**
 * Vérification en conditions réelles de chaque adaptateur contre la vraie API.
 * Hors suite de tests (réseau) : pnpm --filter @ordium/data exec tsx test/smoke.mts
 */
import { coinbaseProvider } from "../src/providers/coinbase.js";
import { krakenProvider } from "../src/providers/kraken.js";
import { createPolygonProvider } from "../src/providers/polygon.js";
import type { FetchQuery, MarketDataProvider } from "../src/types.js";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function check(provider: MarketDataProvider, q: FetchQuery): Promise<void> {
  const s = await provider.fetchCandles(q);
  const first = s.candles[0]?.date;
  const last = s.candles[s.candles.length - 1]?.date;
  console.log(
    `${provider.id.padEnd(9)} ${q.symbol} (${s.quote}) : ${s.candles.length} bougies [${first} → ${last}]`,
  );
  if (s.candles.length === 0) throw new Error(`${provider.id} : série vide`);
  for (const c of s.candles) {
    if (!(c.low <= c.open && c.low <= c.close && c.high >= c.open && c.high >= c.close)) {
      throw new Error(`${provider.id} : bougie incohérente le ${c.date}`);
    }
  }
}

// Coinbase : historique profond (pagination par 300)
await check(coinbaseProvider, {
  symbol: "BTC",
  assetType: "crypto",
  timeframe: "1d",
  from: "2019-01-01",
  to: daysAgo(1),
  quote: "EUR",
});

// Kraken : plage récente uniquement (limite ~720 bougies), alias XBT
await check(krakenProvider, {
  symbol: "BTC",
  assetType: "crypto",
  timeframe: "1d",
  from: daysAgo(90),
  to: daysAgo(1),
  quote: "EUR",
});

// Polygon : seulement si une clé est fournie
if (process.env.POLYGON_API_KEY) {
  await check(createPolygonProvider(process.env.POLYGON_API_KEY), {
    symbol: "AAPL",
    assetType: "stock",
    timeframe: "1d",
    from: daysAgo(400),
    to: daysAgo(1),
  });
} else {
  console.log("polygon   ignoré (pas de POLYGON_API_KEY)");
}

console.log("Vérification réelle : OK");
