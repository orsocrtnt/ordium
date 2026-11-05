import { createHmac } from "node:crypto";
import { CASH_ASSETS, type Holding, type Transaction } from "../types.js";
import type { ConnectorCredentials, ConnectorResult } from "./types.js";

const BASE = "https://api.binance.com";
/** Devises de cotation sondées pour retrouver l'historique de chaque actif. */
const QUOTES_TO_PROBE = ["EUR", "USDT", "USDC", "BTC"];

interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

interface BinanceTrade {
  symbol: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  time: number;
  isBuyer: boolean;
}

async function signedGet<T>(
  path: string,
  params: Record<string, string>,
  creds: ConnectorCredentials,
): Promise<T> {
  const query = new URLSearchParams({
    ...params,
    timestamp: String(Date.now()),
    recvWindow: "10000",
  }).toString();
  const signature = createHmac("sha256", creds.apiSecret).update(query).digest("hex");
  const res = await fetch(`${BASE}${path}?${query}&signature=${signature}`, {
    headers: { "X-MBX-APIKEY": creds.apiKey },
  });
  const body = await res.json();
  if (!res.ok) {
    const message = (body as { msg?: string }).msg ?? `HTTP ${res.status}`;
    throw new Error(`Binance : ${message}`);
  }
  return body as T;
}

/**
 * Récupère positions et historique d'achats/ventes via une clé API Binance
 * en lecture seule. Les clés ne sont jamais stockées.
 */
export async function fetchBinancePortfolio(
  creds: ConnectorCredentials,
  preferredQuote: string,
): Promise<ConnectorResult> {
  const warnings: string[] = [];
  const account = await signedGet<{ balances: BinanceBalance[] }>("/api/v3/account", {}, creds);

  const holdings: Holding[] = account.balances
    .map((b) => ({ asset: b.asset.toUpperCase(), quantity: Number(b.free) + Number(b.locked) }))
    .filter((h) => h.quantity > 1e-9 && !CASH_ASSETS.has(h.asset) && !h.asset.startsWith("LD"));

  if (holdings.length > 25) {
    warnings.push(
      `${holdings.length} actifs détectés : l'historique n'est récupéré que pour les 25 plus importants.`,
    );
  }

  // Binance n'a pas d'endpoint "tous mes trades" : on sonde chaque actif
  // contre les devises de cotation courantes.
  const quotes = [...new Set([preferredQuote.toUpperCase(), ...QUOTES_TO_PROBE])];
  const transactions: Transaction[] = [];
  for (const h of holdings.slice(0, 25)) {
    for (const quote of quotes) {
      try {
        const trades = await signedGet<BinanceTrade[]>(
          "/api/v3/myTrades",
          { symbol: `${h.asset}${quote}`, limit: "1000" },
          creds,
        );
        for (const t of trades) {
          transactions.push({
            date: new Date(t.time).toISOString().slice(0, 10),
            side: t.isBuyer ? "buy" : "sell",
            asset: h.asset,
            quantity: Number(t.qty),
            price: Number(t.price),
            amount: Number(t.quoteQty),
            fee: Number(t.commission),
            currency: quote,
          });
        }
        if (trades.length === 1000) {
          warnings.push(`${h.asset}${quote} : plus de 1 000 trades, historique tronqué.`);
        }
      } catch {
        // Paire inexistante pour ce compte : on passe à la suivante.
      }
    }
  }

  if (transactions.length === 0) {
    warnings.push(
      "Aucun trade retrouvé (achats par carte, Convert et transferts n'apparaissent pas dans l'API myTrades) : " +
        "les positions sont importées, mais la comparaison au backtest nécessitera un export CSV.",
    );
  }
  transactions.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { transactions, holdings, warnings };
}
