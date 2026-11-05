import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";

export const OAUTH_STATE_COOKIE = "ordium_oauth_state";
export const OAUTH_BROKER_COOKIE = "ordium_oauth_broker";
export const OAUTH_VERIFIER_COOKIE = "ordium_oauth_verifier";
export const OAUTH_TOKEN_COOKIE = "ordium_oauth_token";

export type OAuthBroker = "coinbase" | "alpaca";

export function appOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export function getOAuthClient(broker: OAuthBroker): {
  clientId: string;
  clientSecret: string;
} | null {
  if (broker === "coinbase") {
    const clientId =
      process.env.COINBASE_OAUTH_CLIENT_ID?.trim() ||
      process.env.NEXT_PUBLIC_COINBASE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.COINBASE_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }
  const clientId =
    process.env.ALPACA_OAUTH_CLIENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_ALPACA_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.ALPACA_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Configuré côté serveur (client id + secret). */
export function isOAuthReadyServer(broker: OAuthBroker): boolean {
  return getOAuthClient(broker) != null;
}

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function makeState(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

export function buildAuthorizeUrl(
  broker: OAuthBroker,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  if (broker === "coinbase") {
    const u = new URL("https://login.coinbase.com/oauth2/auth");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set(
      "scope",
      ["wallet:user:read", "wallet:accounts:read", "wallet:transactions:read", "offline_access"].join(
        ",",
      ),
    );
    u.searchParams.set("code_challenge", codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  }

  const u = new URL("https://app.alpaca.markets/oauth/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", "account:write trading");
  // Alpaca accepte aussi PKCE sur certaines apps
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export async function exchangeCode(opts: {
  broker: OAuthBroker;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  codeVerifier: string;
}): Promise<{ access_token: string; refresh_token?: string; token_type?: string }> {
  const { broker, code, redirectUri, clientId, clientSecret, codeVerifier } = opts;

  if (broker === "coinbase") {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const res = await fetch("https://login.coinbase.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        data.error_description || data.error || `Coinbase token HTTP ${res.status}`,
      );
    }
    return data;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fetch("https://api.alpaca.markets/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || `Alpaca token HTTP ${res.status}`);
  }
  return data;
}

export type OAuthHolding = {
  asset: string;
  quantity: number;
  name?: string;
  avgPrice?: number;
  price?: number;
  invested?: number;
  value?: number;
  pnl?: number;
  pnlPct?: number;
};

export async function fetchHoldingsWithOAuth(
  broker: OAuthBroker,
  accessToken: string,
): Promise<{ holdings: OAuthHolding[]; warnings: string[] }> {
  if (broker === "alpaca") {
    const res = await fetch("https://api.alpaca.markets/v2/positions", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Paper tokens sometimes need paper host — retry
    let body = await res.json().catch(() => []);
    if (!res.ok) {
      const paper = await fetch("https://paper-api.alpaca.markets/v2/positions", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      body = await paper.json().catch(() => []);
      if (!paper.ok) {
        throw new Error(
          (body as { message?: string }).message ||
            `Alpaca positions HTTP ${paper.status}`,
        );
      }
    }
    const rows = (Array.isArray(body) ? body : []) as Array<{
      symbol: string;
      qty: string;
      avg_entry_price: string;
      current_price: string;
      market_value: string;
      cost_basis: string;
      unrealized_pl: string;
      unrealized_plpc: string;
    }>;
    return {
      holdings: rows
        .map((p) => ({
          asset: p.symbol.toUpperCase(),
          quantity: Math.abs(Number(p.qty)),
          avgPrice: Number(p.avg_entry_price) || undefined,
          price: Number(p.current_price) || undefined,
          invested: Math.abs(Number(p.cost_basis)) || undefined,
          value: Math.abs(Number(p.market_value)) || undefined,
          pnl: Number(p.unrealized_pl) || undefined,
          pnlPct: Number(p.unrealized_plpc) * 100 || undefined,
        }))
        .filter((h) => h.quantity > 1e-9),
      warnings: ["Import via OAuth Alpaca."],
    };
  }

  // Coinbase App API v2
  const holdings: OAuthHolding[] = [];
  let nextUri: string | null = "https://api.coinbase.com/v2/accounts?limit=100";
  while (nextUri) {
    const accRes: Response = await fetch(nextUri, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "CB-VERSION": "2024-01-01",
      },
    });
    const data: {
      data?: Array<{
        currency?: { code?: string } | string;
        balance?: { amount?: string };
        name?: string;
      }>;
      errors?: Array<{ message?: string }>;
      pagination?: { next_uri?: string };
    } = await accRes.json();
    if (!accRes.ok) {
      throw new Error(data.errors?.[0]?.message || `Coinbase accounts HTTP ${accRes.status}`);
    }
    for (const acc of data.data ?? []) {
      const rawCur = acc.currency;
      const asset = String(
        typeof rawCur === "object" && rawCur ? rawCur.code : rawCur ?? "",
      ).toUpperCase();
      const quantity = Number(acc.balance?.amount ?? 0);
      if (!asset || quantity <= 1e-9) continue;
      if (["EUR", "USD", "GBP", "USDT", "USDC"].includes(asset)) continue;
      holdings.push({
        asset,
        quantity,
        name: acc.name || undefined,
      });
    }
    nextUri = data.pagination?.next_uri
      ? `https://api.coinbase.com${data.pagination.next_uri}`
      : null;
  }
  return {
    holdings,
    warnings: [
      "Import via OAuth Coinbase (soldes). L’historique d’ordres Advanced Trade peut nécessiter une clé CDP.",
    ],
  };
}

export async function savePortfolioViaApi(opts: {
  broker: OAuthBroker;
  holdings: OAuthHolding[];
  warnings: string[];
  currency?: string;
  /** Scope utilisateur (même valeur que X-Ordium-User). */
  userKey?: string;
}): Promise<void> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const name =
    opts.broker === "alpaca" ? "Portefeuille Alpaca" : "Portefeuille Coinbase";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userKey) headers["X-Ordium-User"] = opts.userKey;
  const res = await fetch(`${apiBase}/api/portfolio/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name,
      currency: opts.currency ?? "EUR",
      kind: "holdings",
      source: opts.broker,
      holdings: opts.holdings,
      transactions: [],
      warnings: opts.warnings,
      usedLlm: false,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Sauvegarde portefeuille HTTP ${res.status}`);
  }
}
