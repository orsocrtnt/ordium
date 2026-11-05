import { getHistoricalPrices, fetchFearGreedIndex } from "@ordium/data";
import { compileStrategy, rsi, type Strategy } from "@ordium/engine";
import { evaluateCondition, type EvalContext } from "@ordium/engine";
import { appendAudit } from "./audit.js";
import { routeBrokerForSymbol } from "./enable.js";
import { placeOrder } from "./placeOrder.js";
import { listSchedules, updateScheduleRun } from "./store.js";
import type { ExecutionBroker, ExecutionSchedule } from "./types.js";
import { assertKillSwitchClear } from "./killswitch.js";

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

async function runDcaFixed(schedule: ExecutionSchedule): Promise<void> {
  if (!schedule.symbol || schedule.amount == null) {
    throw new Error("Schedule dca_fixed : symbol + amount requis");
  }
  await placeOrder({
    broker: schedule.broker,
    environment: schedule.environment,
    symbol: normalizeTradeSymbol(schedule.symbol, schedule.broker),
    side: "buy",
    type: "market",
    notional: schedule.amount,
    confirmLive: schedule.environment === "live",
    clientOrderId: `ordium-dca-${schedule.id}-${Date.now()}`,
  });
}

function inferAssetType(symbol: string): "crypto" | "stock" {
  return routeBrokerForSymbol(symbol) === "binance" ? "crypto" : "stock";
}

/** BTC → BTCUSDT pour Binance ; laisse tel quel sinon. */
export function normalizeTradeSymbol(asset: string, broker: ExecutionBroker): string {
  const s = asset.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (broker !== "binance") return s;
  if (/USDT$|USDC$/.test(s)) return s;
  return `${s}USDT`;
}

function dayOfMonthUTC(d = new Date()): number {
  return d.getUTCDate();
}

/** Fenêtre d’achat du jour (UTC) — hors fenêtre = pas d’ordre. */
function isInWindow(strategy: Strategy, d = new Date()): boolean {
  const w = strategy.window;
  if (!w) return true;
  if (w.type === "day_of_month") {
    const day = dayOfMonthUTC(d);
    return day >= w.from && day <= w.to;
  }
  if (w.type === "day_of_week") {
    // 1=lun … 7=dim (ISO)
    const wd = d.getUTCDay();
    const iso = wd === 0 ? 7 : wd;
    return iso >= w.from && iso <= w.to;
  }
  return true;
}

function isLastDayOfWindow(strategy: Strategy, d = new Date()): boolean {
  const w = strategy.window;
  if (!w) return true;
  if (w.type === "day_of_month") return dayOfMonthUTC(d) === w.to;
  if (w.type === "day_of_week") {
    const wd = d.getUTCDay();
    const iso = wd === 0 ? 7 : wd;
    return iso === w.to;
  }
  return true;
}

/**
 * strategy_live : multi-actifs sur le broker du schedule.
 * - Crypto seulement si broker = binance (sinon skip audité).
 * - Sans trigger → DCA honoré en fin de fenêtre.
 * - Avec triggers → achat si match, sinon fallback fin de fenêtre.
 */
async function runStrategyLive(schedule: ExecutionSchedule): Promise<void> {
  const raw = schedule.strategyJson as Strategy | undefined;
  if (!raw || typeof raw !== "object") {
    throw new Error("Schedule strategy_live : strategyJson requis");
  }

  if (!isInWindow(raw)) {
    await appendAudit(
      "strategy_skip_window",
      { scheduleId: schedule.id, reason: "hors fenêtre d’achat" },
      schedule.broker,
    );
    return;
  }

  const allocation = (raw.allocation ?? []).filter((a) => a.weight > 0 && a.asset);
  if (allocation.length === 0) throw new Error("Allocation vide");

  const weightSum = allocation.reduce((s, a) => s + a.weight, 0) || 1;
  const baseBudget = Number(schedule.amount ?? raw.budget?.amount ?? 0);
  if (!(baseBudget > 0)) throw new Error("Budget invalide pour strategy_live");

  let fearGreed: number | null = null;
  try {
    fearGreed = (await fetchFearGreedIndex()).value;
  } catch {
    fearGreed = null;
  }

  const doc = compileStrategy(raw);
  const buyRules = doc.rules
    .filter(
      (r) =>
        r.enabled &&
        r.when === "tick" &&
        r.then.some((a) => a.action === "buy_tranche" || a.action === "buy_extra"),
    )
    .sort((a, b) => a.priority - b.priority);
  const hasTriggers = buyRules.some((r) => r.if);
  const lastDay = isLastDayOfWindow(raw);

  for (const { asset, weight } of allocation) {
    const routed = routeBrokerForSymbol(asset);
    if (routed !== schedule.broker) {
      await appendAudit(
        "strategy_skip_asset",
        {
          scheduleId: schedule.id,
          asset,
          reason: `hors ${schedule.broker} (routé vers ${routed})`,
        },
        schedule.broker,
      );
      continue;
    }

    const symbol = normalizeTradeSymbol(asset, schedule.broker);
    const assetType = inferAssetType(asset);
    const quote = assetType === "crypto" ? "USDT" : "USD";
    const from = new Date(Date.now() - 800 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    let closes: number[] = [];
    try {
      const series = await getHistoricalPrices(asset, assetType, "1d", from, to, {
        quote,
        strictQuote: assetType === "crypto",
      });
      closes = series.candles.map((c) => c.close);
    } catch (e) {
      await appendAudit(
        "strategy_skip_asset",
        {
          scheduleId: schedule.id,
          asset,
          reason: `données indisponibles : ${(e as Error).message}`,
        },
        schedule.broker,
      );
      continue;
    }

    const ctx: EvalContext = {
      closes,
      openPrice: closes.length > 1 ? closes[closes.length - 2]! : closes[0] ?? null,
      regime: "neutral",
      fearGreed,
    };

    let matchedReason: string | null = null;
    for (const rule of buyRules) {
      if (rule.if) {
        const result = evaluateCondition(rule.if, ctx);
        if (!result.matched) continue;
        matchedReason = result.reason ?? rule.id;
      } else {
        matchedReason = rule.id;
      }
      break;
    }

    // Sans trigger → DCA honoré en fin de fenêtre.
    // Avec triggers → achat si match, sinon fallback fin de fenêtre.
    const shouldBuy = hasTriggers ? Boolean(matchedReason) || lastDay : lastDay;

    if (!shouldBuy) {
      await appendAudit(
        "strategy_skip_conditions",
        {
          symbol,
          fearGreed,
          rsi: rsi(closes, 14),
          scheduleId: schedule.id,
        },
        schedule.broker,
      );
      continue;
    }

    const reason = matchedReason
      ? matchedReason
      : lastDay && hasTriggers
        ? "fallback : fin de fenêtre"
        : "achat programmé";

    const notional = Math.round(((baseBudget * weight) / weightSum) * 100) / 100;
    if (!(notional >= 1)) {
      await appendAudit(
        "strategy_skip_asset",
        { scheduleId: schedule.id, asset, reason: `notional trop faible (${notional})` },
        schedule.broker,
      );
      continue;
    }

    await placeOrder({
      broker: schedule.broker,
      environment: schedule.environment,
      symbol,
      side: "buy",
      type: "market",
      notional,
      confirmLive: schedule.environment === "live",
      clientOrderId: `ordium-strat-${schedule.id}-${asset}-${Date.now()}`.slice(0, 36),
    });
    await appendAudit(
      "strategy_order",
      { symbol, amount: notional, reason, scheduleId: schedule.id, asset },
      schedule.broker,
    );
  }
}

export async function runDueSchedules(
  now = new Date(),
  opts?: { force?: boolean; userKey?: string },
): Promise<{
  ran: string[];
  errors: { id: string; error: string }[];
}> {
  const { listExecutionUserKeys, runAsExecutionUserAsync } = await import("./userContext.js");

  // Un utilisateur ciblé (API manuelle) ou tous les comptes (scheduler).
  const users = opts?.userKey
    ? [opts.userKey]
    : await listExecutionUserKeys();

  if (users.length === 0) {
    return {
      ran: [],
      errors: [
        {
          id: "*",
          error:
            "Aucune automatisation active. Relance l’auto paper (ou lève le kill switch puis relance).",
        },
      ],
    };
  }

  const ran: string[] = [];
  const errors: { id: string; error: string }[] = [];

  for (const userKey of users) {
    const partial = await runAsExecutionUserAsync(userKey, () =>
      runDueSchedulesForCurrentUser(now, opts),
    );
    ran.push(...partial.ran);
    errors.push(...partial.errors);
  }

  return { ran, errors };
}

async function runDueSchedulesForCurrentUser(
  now: Date,
  opts?: { force?: boolean },
): Promise<{
  ran: string[];
  errors: { id: string; error: string }[];
}> {
  const ran: string[] = [];
  const errors: { id: string; error: string }[] = [];

  try {
    await assertKillSwitchClear();
  } catch (e) {
    return { ran, errors: [{ id: "*", error: (e as Error).message }] };
  }

  const schedules = await listSchedules();
  const due = schedules.filter((s) => {
    if (!s.enabled) return false;
    if (opts?.force) return true;
    return new Date(s.nextRunAt).getTime() <= now.getTime();
  });

  if (due.length === 0) {
    const enabled = schedules.filter((s) => s.enabled);
    if (enabled.length === 0) {
      // Pas d’erreur globale si d’autres users ont des schedules — silence.
      return { ran, errors };
    }
    errors.push({
      id: "*",
      error: `Rien à exécuter pour l’instant (prochain run : ${new Date(
        enabled[0]!.nextRunAt,
      ).toLocaleString("fr-FR")}). Utilise « Tester un run » pour forcer.`,
    });
    return { ran, errors };
  }

  for (const schedule of due) {
    try {
      if (schedule.kind === "dca_fixed") await runDcaFixed(schedule);
      else await runStrategyLive(schedule);

      const next = addMinutes(now.toISOString(), schedule.intervalMinutes);
      await updateScheduleRun(schedule.id, {
        lastRunAt: now.toISOString(),
        nextRunAt: next,
        lastError: undefined,
      });
      ran.push(schedule.id);
      await appendAudit(
        "schedule_run",
        { scheduleId: schedule.id, kind: schedule.kind, nextRunAt: next },
        schedule.broker,
      );
    } catch (e) {
      const msg = (e as Error).message;
      errors.push({ id: schedule.id, error: msg });
      await updateScheduleRun(schedule.id, {
        lastRunAt: now.toISOString(),
        lastError: msg,
        nextRunAt: addMinutes(now.toISOString(), schedule.intervalMinutes),
      });
      await appendAudit(
        "schedule_error",
        { scheduleId: schedule.id, error: msg },
        schedule.broker,
      );
    }
  }

  return { ran, errors };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    void runDueSchedules();
  }, intervalMs);
  void runDueSchedules();
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
