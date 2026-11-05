import { createHash, createHmac } from "node:crypto";
import { normalizeAsset, splitPair } from "../parse/normalize.js";
import { CASH_ASSETS, type Holding, type Transaction } from "../types.js";
import type { ConnectorCredentials, ConnectorResult } from "./types.js";

const BASE = "https://api.kraken.com";

interface KrakenTrade {
  pair: string;
  time: number;
  type: "buy" | "sell";
  price: string;
  cost: string;
  fee: string;
  vol: string;
}

async function privatePost<T>(
  path: string,
  params: Record<string, string>,
  creds: ConnectorCredentials,
): Promise<T> {
  const nonce = String(Date.now() * 1000);
  const body = new URLSearchParams({ nonce, ...params }).toString();
  const hash = createHash("sha256").update(nonce + body).digest();
  const hmac = createHmac("sha512", Buffer.from(creds.apiSecret, "base64"))
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest("base64");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "API-Key": creds.apiKey,
      "API-Sign": hmac,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as { error: string[]; result?: T };
  if (data.error?.length) throw new Error(`Kraken : ${data.error.join(", ")}`);
  if (!data.result) throw new Error(`Kraken : réponse vide (HTTP ${res.status}).`);
  return data.result;
}

/**
 * Récupère positions et historique via une clé API Kraken en lecture seule
 * (permissions requises : « Query Funds » et « Query Closed Orders & Trades »).
 * Les clés ne sont jamais stockées.
 */
export async function fetchKrakenPortfolio(
  creds: ConnectorCredentials,
): Promise<ConnectorResult> {
  const warnings: string[] = [];

  const balances = await privatePost<Record<string, string>>("/0/private/Balance", {}, creds);
  const holdings: Holding[] = Object.entries(balances)
    .map(([code, qty]) => ({ asset: normalizeAsset(code.replace(/\.[SFM]$/, "")), quantity: Number(qty) }))
    .filter((h) => h.quantity > 1e-9 && !CASH_ASSETS.has(h.asset))
    .reduce<Holding[]>((acc, h) => {
      const existing = acc.find((x) => x.asset === h.asset);
      if (existing) existing.quantity += h.quantity;
      else acc.push(h);
      return acc;
    }, []);

  // TradesHistory est paginé par 50.
  const transactions: Transaction[] = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const page = await privatePost<{ trades: Record<string, KrakenTrade>; count: number }>(
      "/0/private/TradesHistory",
      { ofs: String(offset) },
      creds,
    );
    const trades = Object.values(page.trades ?? {});
    for (const t of trades) {
      const pair = splitPair(t.pair);
      if (!pair) continue;
      if (CASH_ASSETS.has(pair.base)) continue;
      transactions.push({
        date: new Date(t.time * 1000).toISOString().slice(0, 10),
        side: t.type,
        asset: pair.base,
        quantity: Number(t.vol),
        price: Number(t.price),
        amount: Number(t.cost),
        fee: Number(t.fee),
        currency: pair.quote,
      });
    }
    if (offset + 50 >= page.count || trades.length === 0) break;
    if (offset + 50 >= 2000) {
      warnings.push("Plus de 2 000 trades : historique tronqué aux 2 000 plus récents.");
    }
  }

  transactions.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { transactions, holdings, warnings };
}
