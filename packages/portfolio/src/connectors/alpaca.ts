import type { Holding } from "../types.js";
import type { BrokerEnvironment, ConnectorCredentials, ConnectorResult } from "./types.js";

function baseUrl(env: BrokerEnvironment): string {
  return env === "live" ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  side: string;
}

/**
 * Positions Alpaca (actions / ETF US, crypto éventuelle).
 * Idéal pour tests : compte paper + clés API.
 * apiKey = APCA-API-KEY-ID, apiSecret = APCA-API-SECRET-KEY.
 */
export async function fetchAlpacaPortfolio(
  creds: ConnectorCredentials,
  environment: BrokerEnvironment = "paper",
): Promise<ConnectorResult> {
  const res = await fetch(`${baseUrl(environment)}/v2/positions`, {
    headers: {
      "APCA-API-KEY-ID": creds.apiKey,
      "APCA-API-SECRET-KEY": creds.apiSecret,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body as { message?: string }).message ??
      (body as { error?: string }).error ??
      `HTTP ${res.status}`;
    throw new Error(`Alpaca : ${message}`);
  }

  const rows = body as AlpacaPosition[];
  const warnings: string[] = [];
  if (environment === "paper") {
    warnings.push("Compte Alpaca paper (simulation) — pas d’argent réel.");
  }

  const holdings: Holding[] = rows
    .map((p) => {
      const quantity = Math.abs(Number(p.qty));
      const avgPrice = Number(p.avg_entry_price);
      const price = Number(p.current_price);
      const invested = Number(p.cost_basis);
      const value = Number(p.market_value);
      const pnl = Number(p.unrealized_pl);
      const pnlPct = Number(p.unrealized_plpc) * 100;
      return {
        asset: p.symbol.toUpperCase(),
        quantity,
        avgPrice: Number.isFinite(avgPrice) ? avgPrice : undefined,
        price: Number.isFinite(price) ? price : undefined,
        invested: Number.isFinite(invested) ? Math.abs(invested) : undefined,
        value: Number.isFinite(value) ? Math.abs(value) : undefined,
        pnl: Number.isFinite(pnl) ? pnl : undefined,
        pnlPct: Number.isFinite(pnlPct) ? pnlPct : undefined,
      } satisfies Holding;
    })
    .filter((h) => h.quantity > 1e-9);

  return { holdings, transactions: [], warnings };
}
