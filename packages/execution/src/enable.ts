import { alpacaAccountStatus } from "./brokers/alpaca.js";
import { binanceApiRestrictions } from "./brokers/binance.js";
import { appendAudit } from "./audit.js";
import { upsertConnection } from "./store.js";
import type {
  BrokerConnection,
  BrokerCredentials,
  BrokerScope,
  ExecutionBroker,
  ExecutionEnvironment,
} from "./types.js";

export {
  checkStrategyBrokerCompatibility,
  routeBrokerForSymbol,
  type BrokerCompatResult,
  type StrategyAllocationLike,
} from "./brokerRoute.js";

/**
 * Active une connexion d’exécution : vérifie le compte / permissions,
 * stocke les credentials chiffrés.
 */
export async function enableExecution(input: {
  broker: ExecutionBroker;
  environment: ExecutionEnvironment;
  credentials: BrokerCredentials;
  label?: string;
}): Promise<{ connection: BrokerConnection; scopes: BrokerScope[]; note?: string }> {
  const scopes: BrokerScope[] = ["read"];
  let note: string | undefined;

  if (input.broker === "alpaca") {
    const account = await alpacaAccountStatus(input.credentials, input.environment);
    if (account.status && account.status !== "ACTIVE" && account.status !== "ACCOUNT_UPDATED") {
      // Paper est souvent ACTIVE ; on accepte aussi d’autres status non bloquants.
      note = `Statut compte Alpaca : ${account.status}`;
    }
    scopes.push("trade");
    // Withdraw = dashboard — pas de scope API retail fiable.
  } else {
    const perms = await binanceApiRestrictions(input.credentials, input.environment);
    if (!perms.enableSpotAndMarginTrading && input.environment === "live") {
      throw new Error(
        "Binance : activez « Enable Spot & Margin Trading » (et IP whitelist) pour l’exécution live.",
      );
    }
    scopes.push("trade");
    if (perms.enableWithdrawals) scopes.push("withdraw");
    else note = "Retraits non activés sur la clé (Enable Withdrawals). Le trading reste possible.";
  }

  const connection = await upsertConnection({
    broker: input.broker,
    environment: input.environment,
    credentials: input.credentials,
    scopes,
    label: input.label,
  });

  await appendAudit(
    "enable_execution",
    {
      connectionId: connection.id,
      environment: input.environment,
      scopes,
      note,
    },
    input.broker,
  );

  return { connection, scopes, note };
}
