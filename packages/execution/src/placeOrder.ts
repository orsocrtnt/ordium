import { appendAudit } from "./audit.js";
import { alpacaCancelOrder, alpacaPlaceOrder } from "./brokers/alpaca.js";
import { binanceCancelOrder, binancePlaceOrder } from "./brokers/binance.js";
import { assertKillSwitchClear } from "./killswitch.js";
import { assertDailyLimit, getCredentials } from "./store.js";
import type { PlaceOrderRequest, PlaceOrderResult } from "./types.js";

export async function placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
  await assertKillSwitchClear();
  if (req.environment === "live" && !req.confirmLive) {
    throw new Error("Confirmation live requise (confirmLive: true)");
  }

  const estimate =
    req.notional ??
    (req.quantity != null && req.limitPrice != null ? req.quantity * req.limitPrice : req.quantity ?? 0);
  if (estimate > 0) await assertDailyLimit(estimate);

  const creds = await getCredentials(req.broker, req.environment);
  let result: PlaceOrderResult;
  if (req.broker === "alpaca") {
    result = await alpacaPlaceOrder(creds, req);
  } else {
    result = await binancePlaceOrder(creds, req);
  }

  await appendAudit(
    "place_order",
    {
      orderId: result.orderId,
      symbol: result.symbol,
      side: result.side,
      type: result.type,
      status: result.status,
      environment: req.environment,
      quantity: result.quantity,
      notional: result.notional,
    },
    req.broker,
  );
  return result;
}

export async function cancelOrder(input: {
  broker: "alpaca" | "binance";
  environment: "paper" | "live";
  orderId: string;
  symbol?: string;
}): Promise<void> {
  await assertKillSwitchClear();
  const creds = await getCredentials(input.broker, input.environment);
  if (input.broker === "alpaca") {
    await alpacaCancelOrder(creds, input.environment, input.orderId);
  } else {
    if (!input.symbol) throw new Error("Binance cancel : symbol requis");
    await binanceCancelOrder(creds, input.environment, input.symbol, input.orderId);
  }
  await appendAudit(
    "cancel_order",
    { orderId: input.orderId, symbol: input.symbol, environment: input.environment },
    input.broker,
  );
}
