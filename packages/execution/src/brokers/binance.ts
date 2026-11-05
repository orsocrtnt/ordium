import { createHmac } from "node:crypto";
import type {
  BrokerCredentials,
  ExecutionEnvironment,
  PlaceOrderRequest,
  PlaceOrderResult,
  WithdrawRequest,
  WithdrawResult,
} from "../types.js";

function baseUrl(env: ExecutionEnvironment): string {
  // Paper Ordium = Spot Testnet ; live = production.
  return env === "live" ? "https://api.binance.com" : "https://testnet.binance.vision";
}

async function signedRequest<T>(
  env: ExecutionEnvironment,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number>,
  creds: BrokerCredentials,
): Promise<T> {
  const qs = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
    timestamp: String(Date.now()),
    recvWindow: "10000",
  }).toString();
  const signature = createHmac("sha256", creds.apiSecret).update(qs).digest("hex");
  const url = `${baseUrl(env)}${path}?${qs}&signature=${signature}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": creds.apiKey },
  });
  const body = await res.json();
  if (!res.ok) {
    const message = (body as { msg?: string }).msg ?? `HTTP ${res.status}`;
    throw new Error(`Binance : ${message}`);
  }
  return body as T;
}

export async function binanceApiRestrictions(
  creds: BrokerCredentials,
  environment: ExecutionEnvironment,
): Promise<{
  enableReading: boolean;
  enableSpotAndMarginTrading: boolean;
  enableWithdrawals: boolean;
  ipRestrict: boolean;
}> {
  // apiRestrictions n’existe pas forcément sur testnet — fallback soft.
  try {
    const data = await signedRequest<{
      enableReading?: boolean;
      enableSpotAndMarginTrading?: boolean;
      enableWithdrawals?: boolean;
      ipRestrict?: boolean;
    }>(environment, "GET", "/sapi/v1/account/apiRestrictions", {}, creds);
    return {
      enableReading: Boolean(data.enableReading ?? true),
      enableSpotAndMarginTrading: Boolean(data.enableSpotAndMarginTrading),
      enableWithdrawals: Boolean(data.enableWithdrawals),
      ipRestrict: Boolean(data.ipRestrict),
    };
  } catch {
    // Testnet / clé sans sapi : on suppose trade si account répond.
    await signedRequest(environment, "GET", "/api/v3/account", {}, creds);
    return {
      enableReading: true,
      enableSpotAndMarginTrading: true,
      enableWithdrawals: false,
      ipRestrict: false,
    };
  }
}

export async function binancePlaceOrder(
  creds: BrokerCredentials,
  req: PlaceOrderRequest,
): Promise<PlaceOrderResult> {
  const symbol = req.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const params: Record<string, string | number> = {
    symbol,
    side: req.side.toUpperCase(),
    type: req.type.toUpperCase(),
  };
  if (req.clientOrderId) params.newClientOrderId = req.clientOrderId;

  if (req.type === "market") {
    if (req.side === "buy" && req.notional != null) {
      params.quoteOrderQty = req.notional;
    } else if (req.quantity != null) {
      params.quantity = req.quantity;
    } else {
      throw new Error("Binance market : quantity ou notional (quoteOrderQty) requis");
    }
  } else {
    if (req.quantity == null || req.limitPrice == null) {
      throw new Error("Binance limit : quantity + limitPrice requis");
    }
    params.quantity = req.quantity;
    params.price = req.limitPrice;
    params.timeInForce = "GTC";
  }

  const data = await signedRequest<{
    orderId: number;
    status: string;
    symbol: string;
    side: string;
    type: string;
    executedQty: string;
    origQty: string;
  }>(req.environment, "POST", "/api/v3/order", params, creds);

  return {
    broker: "binance",
    environment: req.environment,
    orderId: String(data.orderId),
    symbol: data.symbol,
    side: req.side,
    type: req.type,
    status: data.status,
    quantity: Number(data.origQty),
    filledQty: Number(data.executedQty),
    notional: req.notional,
    raw: data,
  };
}

export async function binanceCancelOrder(
  creds: BrokerCredentials,
  environment: ExecutionEnvironment,
  symbol: string,
  orderId: string,
): Promise<void> {
  await signedRequest(
    environment,
    "DELETE",
    "/api/v3/order",
    { symbol: symbol.toUpperCase(), orderId },
    creds,
  );
}

export async function binanceWithdraw(
  creds: BrokerCredentials,
  req: WithdrawRequest,
): Promise<WithdrawResult> {
  if (req.environment !== "live") {
    throw new Error("Les retraits Binance ne sont disponibles qu’en environnement live (pas testnet).");
  }
  if (!req.address) throw new Error("Adresse de retrait requise");
  const params: Record<string, string | number> = {
    coin: req.asset.toUpperCase(),
    address: req.address,
    amount: req.amount,
  };
  if (req.network) params.network = req.network;
  if (req.addressTag) params.addressTag = req.addressTag;

  const data = await signedRequest<{ id: string }>(
    "live",
    "POST",
    "/sapi/v1/capital/withdraw/apply",
    params,
    creds,
  );
  return {
    broker: "binance",
    status: "submitted",
    id: data.id,
    message: "Retrait Binance soumis",
    raw: data,
  };
}
