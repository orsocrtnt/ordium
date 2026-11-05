import { createPrivateKey, createSign, randomBytes } from "node:crypto";
import { splitPair } from "../parse/normalize.js";
import { CASH_ASSETS, type Holding, type Transaction } from "../types.js";
import type { ConnectorCredentials, ConnectorResult } from "./types.js";

const HOST = "api.coinbase.com";

/** JWT ES256 signé avec la clé privée CDP (format attendu par Coinbase). */
function buildJwt(creds: ConnectorCredentials, method: string, path: string): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: creds.apiKey,
    typ: "JWT",
    nonce: randomBytes(16).toString("hex"),
  };
  const payload = {
    sub: creds.apiKey,
    iss: "cdp",
    nbf: now,
    exp: now + 120,
    uri: `${method} ${HOST}${path}`,
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const key = createPrivateKey(creds.apiSecret.replace(/\\n/g, "\n"));
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

async function get<T>(path: string, creds: ConnectorCredentials): Promise<T> {
  const pathWithoutQuery = path.split("?")[0]!;
  const res = await fetch(`https://${HOST}${path}`, {
    headers: { Authorization: `Bearer ${buildJwt(creds, "GET", pathWithoutQuery)}` },
  });
  if (!res.ok) {
    throw new Error(`Coinbase : HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface CoinbaseAccount {
  currency: string;
  available_balance: { value: string };
  hold: { value: string };
}

interface CoinbaseFill {
  product_id: string;
  trade_time: string;
  side: "BUY" | "SELL";
  price: string;
  size: string;
  commission: string;
}

/**
 * Récupère positions et historique via une clé API Coinbase (CDP) en lecture
 * seule. `apiKey` = nom de la clé, `apiSecret` = clé privée PEM.
 * Les clés ne sont jamais stockées.
 */
export async function fetchCoinbasePortfolio(
  creds: ConnectorCredentials,
): Promise<ConnectorResult> {
  const warnings: string[] = [];

  const holdings: Holding[] = [];
  let accountCursor = "";
  do {
    const page = await get<{ accounts: CoinbaseAccount[]; cursor?: string; has_next: boolean }>(
      `/api/v3/brokerage/accounts?limit=250${accountCursor ? `&cursor=${accountCursor}` : ""}`,
      creds,
    );
    for (const account of page.accounts) {
      const asset = account.currency.toUpperCase();
      const quantity = Number(account.available_balance.value) + Number(account.hold.value);
      if (quantity > 1e-9 && !CASH_ASSETS.has(asset)) holdings.push({ asset, quantity });
    }
    accountCursor = page.has_next ? (page.cursor ?? "") : "";
  } while (accountCursor);

  const transactions: Transaction[] = [];
  let fillCursor = "";
  for (let page = 0; page < 20; page++) {
    const data = await get<{ fills: CoinbaseFill[]; cursor?: string }>(
      `/api/v3/brokerage/orders/historical/fills?limit=250${fillCursor ? `&cursor=${fillCursor}` : ""}`,
      creds,
    );
    for (const f of data.fills ?? []) {
      const pair = splitPair(f.product_id);
      if (!pair || CASH_ASSETS.has(pair.base)) continue;
      const quantity = Number(f.size);
      const price = Number(f.price);
      transactions.push({
        date: f.trade_time.slice(0, 10),
        side: f.side === "BUY" ? "buy" : "sell",
        asset: pair.base,
        quantity,
        price,
        amount: quantity * price,
        fee: Number(f.commission),
        currency: pair.quote,
      });
    }
    fillCursor = data.cursor ?? "";
    if (!fillCursor || (data.fills ?? []).length === 0) break;
    if (page === 19) warnings.push("Plus de 5 000 fills : historique tronqué.");
  }

  if (transactions.length === 0 && holdings.length > 0) {
    warnings.push(
      "Positions importées mais aucun trade retrouvé (achats simples et conversions " +
        "n'apparaissent pas dans l'API Advanced Trade) : export CSV recommandé pour la comparaison.",
    );
  }
  transactions.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { transactions, holdings, warnings };
}
