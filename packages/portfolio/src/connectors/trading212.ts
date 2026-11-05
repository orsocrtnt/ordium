import type { Holding } from "../types.js";
import type { BrokerEnvironment, ConnectorCredentials, ConnectorResult } from "./types.js";

function baseUrl(env: BrokerEnvironment): string {
  return env === "live"
    ? "https://live.trading212.com/api/v0"
    : "https://demo.trading212.com/api/v0";
}

/** Ex. AAPL_US_EQ → AAPL */
export function normalizeTrading212Ticker(raw: string): string {
  const t = raw.trim().toUpperCase();
  const cut = t.split("_")[0] ?? t;
  return cut || t;
}

interface T212Position {
  ticker?: string;
  quantity?: number;
  averagePricePaid?: number;
  averagePrice?: number;
  currentPrice?: number;
  ppl?: number;
  fxPpl?: number;
  instrument?: {
    ticker?: string;
    name?: string;
    isin?: string;
    currency?: string;
  };
  walletImpact?: {
    currentValue?: number;
    totalCost?: number;
    unrealizedProfitLoss?: number;
  };
}

/**
 * Positions Trading 212 (actions / ETF — Invest & Stocks ISA).
 * Environnement demo (paper) idéal pour les tests.
 * Auth HTTP Basic : apiKey:apiSecret.
 */
export async function fetchTrading212Portfolio(
  creds: ConnectorCredentials,
  environment: BrokerEnvironment = "paper",
): Promise<ConnectorResult> {
  const token = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString("base64");
  const res = await fetch(`${baseUrl(environment)}/equity/positions`, {
    headers: { Authorization: `Basic ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body as { message?: string }).message ??
      (body as { errorMessage?: string }).errorMessage ??
      `HTTP ${res.status}`;
    throw new Error(`Trading 212 : ${message}`);
  }

  const rows = (Array.isArray(body) ? body : []) as T212Position[];
  const warnings: string[] = [];
  if (environment === "paper") {
    warnings.push("Compte Trading 212 demo (paper) — pas d’argent réel.");
  }

  const holdings: Holding[] = rows
    .map((p) => {
      const rawTicker = p.instrument?.ticker ?? p.ticker ?? "";
      const asset = normalizeTrading212Ticker(rawTicker);
      const quantity = Number(p.quantity ?? 0);
      const avgPrice = Number(p.averagePricePaid ?? p.averagePrice);
      const price = Number(p.currentPrice);
      const invested = Number(p.walletImpact?.totalCost);
      const value = Number(p.walletImpact?.currentValue);
      const pnl = Number(p.walletImpact?.unrealizedProfitLoss ?? p.ppl);
      const holding: Holding = {
        asset,
        quantity,
        ...(p.instrument?.name ? { name: p.instrument.name } : {}),
        ...(Number.isFinite(avgPrice) ? { avgPrice } : {}),
        ...(Number.isFinite(price) ? { price } : {}),
        ...(Number.isFinite(invested) ? { invested } : {}),
        ...(Number.isFinite(value) ? { value } : {}),
        ...(Number.isFinite(pnl) ? { pnl } : {}),
      };
      if (
        holding.pnlPct == null &&
        holding.pnl != null &&
        holding.invested != null &&
        holding.invested !== 0
      ) {
        holding.pnlPct = (holding.pnl / holding.invested) * 100;
      }
      return holding;
    })
    .filter((h) => h.asset && h.quantity > 1e-9);

  return { holdings, transactions: [], warnings };
}
