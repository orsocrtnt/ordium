import { appendAudit } from "./audit.js";
import { alpacaWithdraw } from "./brokers/alpaca.js";
import { binanceWithdraw } from "./brokers/binance.js";
import { assertKillSwitchClear } from "./killswitch.js";
import { assertDailyLimit, assertInAllowlist, getCredentials } from "./store.js";
import type { WithdrawRequest, WithdrawResult } from "./types.js";

const CONFIRM_PHRASE = "JE CONFIRME LE RETRAIT";

export async function withdraw(req: WithdrawRequest): Promise<WithdrawResult> {
  await assertKillSwitchClear();
  if (!req.confirmLive || req.confirmPhrase !== CONFIRM_PHRASE) {
    throw new Error(
      `Confirmation retrait invalide. Envoyez confirmLive: true et confirmPhrase: "${CONFIRM_PHRASE}"`,
    );
  }
  await assertDailyLimit(req.amount);

  const creds = await getCredentials(req.broker, req.environment);
  let result: WithdrawResult;

  if (req.broker === "binance") {
    if (!req.address || !req.network) {
      throw new Error("Binance withdraw : address + network requis");
    }
    await assertInAllowlist(req.asset, req.network, req.address);
    result = await binanceWithdraw(creds, req);
  } else {
    result = await alpacaWithdraw(creds, req);
  }

  await appendAudit(
    "withdraw",
    {
      asset: req.asset,
      amount: req.amount,
      status: result.status,
      id: result.id,
      dashboardUrl: result.dashboardUrl,
      // jamais l’adresse complète en clair dans les logs futurs si besoin — MVP ok
      addressSuffix: req.address ? req.address.slice(-6) : undefined,
    },
    req.broker,
  );
  return result;
}

export { CONFIRM_PHRASE as WITHDRAW_CONFIRM_PHRASE };
