import type {
  BrokerCredentials,
  ExecutionEnvironment,
  PlaceOrderRequest,
  PlaceOrderResult,
  WithdrawRequest,
  WithdrawResult,
} from "../types.js";

function baseUrl(env: ExecutionEnvironment): string {
  return env === "live" ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";
}

function headers(creds: BrokerCredentials): Record<string, string> {
  return {
    "APCA-API-KEY-ID": creds.apiKey,
    "APCA-API-SECRET-KEY": creds.apiSecret,
    "Content-Type": "application/json",
  };
}

export async function alpacaAccountStatus(
  creds: BrokerCredentials,
  environment: ExecutionEnvironment,
): Promise<{ status: string; accountNumber?: string; buyingPower?: string }> {
  const res = await fetch(`${baseUrl(environment)}/v2/account`, {
    headers: headers(creds),
  });
  const body = (await res.json()) as {
    status?: string;
    account_number?: string;
    buying_power?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(body.message ?? `Alpaca account HTTP ${res.status}`);
  }
  return {
    status: body.status ?? "unknown",
    accountNumber: body.account_number,
    buyingPower: body.buying_power,
  };
}

export async function alpacaPlaceOrder(
  creds: BrokerCredentials,
  req: PlaceOrderRequest,
): Promise<PlaceOrderResult> {
  if (!req.quantity && !req.notional) {
    throw new Error("Alpaca : quantity ou notional requis");
  }
  if (req.type === "limit" && req.limitPrice == null) {
    throw new Error("Alpaca : limitPrice requis pour un ordre limit");
  }

  const body: Record<string, unknown> = {
    symbol: req.symbol.toUpperCase(),
    side: req.side,
    type: req.type,
    time_in_force: "day",
  };
  if (req.clientOrderId) body.client_order_id = req.clientOrderId;
  if (req.notional != null && req.side === "buy" && req.type === "market") {
    body.notional = String(req.notional);
  } else if (req.quantity != null) {
    body.qty = String(req.quantity);
  } else {
    throw new Error("Alpaca : pour un market buy, fournissez notional ; sinon quantity");
  }
  if (req.type === "limit") body.limit_price = String(req.limitPrice);

  const res = await fetch(`${baseUrl(req.environment)}/v2/orders`, {
    method: "POST",
    headers: headers(creds),
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    id?: string;
    status?: string;
    symbol?: string;
    side?: string;
    type?: string;
    qty?: string;
    notional?: string;
    filled_qty?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.message ?? `Alpaca order HTTP ${res.status}`);
  }
  return {
    broker: "alpaca",
    environment: req.environment,
    orderId: data.id ?? "",
    symbol: data.symbol ?? req.symbol,
    side: req.side,
    type: req.type,
    status: data.status ?? "submitted",
    quantity: data.qty ? Number(data.qty) : req.quantity,
    notional: data.notional ? Number(data.notional) : req.notional,
    filledQty: data.filled_qty ? Number(data.filled_qty) : undefined,
    raw: data,
  };
}

export async function alpacaCancelOrder(
  creds: BrokerCredentials,
  environment: ExecutionEnvironment,
  orderId: string,
): Promise<void> {
  const res = await fetch(`${baseUrl(environment)}/v2/orders/${encodeURIComponent(orderId)}`, {
    method: "DELETE",
    headers: headers(creds),
  });
  if (!res.ok && res.status !== 204) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(data.message ?? `Alpaca cancel HTTP ${res.status}`);
  }
}

export async function alpacaWithdraw(
  _creds: BrokerCredentials,
  req: WithdrawRequest,
): Promise<WithdrawResult> {
  // L’API funding ACH dépend du type de compte ; pour le MVP on guide le dashboard.
  const dash =
    req.environment === "paper"
      ? "https://app.alpaca.markets/paper/dashboard/overview"
      : "https://app.alpaca.markets/brokerage/banking";
  return {
    broker: "alpaca",
    status: "dashboard_required",
    message:
      "Les sorties de fonds Alpaca (ACH / wire) se font via le dashboard Banking. Ordium enregistre la demande localement ; finalisez le transfert sur Alpaca.",
    dashboardUrl: dash,
    raw: {
      asset: req.asset,
      amount: req.amount,
      requestedAt: new Date().toISOString(),
    },
  };
}
