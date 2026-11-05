import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  WITHDRAW_CONFIRM_PHRASE,
  appendAudit,
  cancelOrder,
  checkStrategyBrokerCompatibility,
  deleteConnection,
  deleteSchedule,
  enableExecution,
  getAllowlist,
  getKillSwitch,
  getLimits,
  listAudit,
  listOrderHistory,
  listConnections,
  listSchedules,
  placeOrder,
  routeBrokerForSymbol,
  runAsExecutionUserAsync,
  runDueSchedules,
  saveSchedule,
  setAllowlist,
  setDailyLimit,
  setKillSwitch,
  vaultKeyConfigured,
  withdraw,
  type ExecutionBroker,
  type ExecutionEnvironment,
  type ScheduleKind,
} from "@ordium/execution";
import { userKeyFromRequest } from "../lib/userKey.js";

/** Exécute le handler dans le store du compte (démo vs réel isolés). */
function withUser<T>(req: FastifyRequest, fn: () => Promise<T>): Promise<T> {
  return runAsExecutionUserAsync(userKeyFromRequest(req), fn);
}

/** Une seule strategy_live active à la fois. */
async function pauseOtherStrategyLive(keepId: string): Promise<void> {
  const all = await listSchedules();
  await Promise.all(
    all
      .filter((s) => s.kind === "strategy_live" && s.enabled && s.id !== keepId)
      .map((s) => saveSchedule({ ...s, id: s.id, enabled: false })),
  );
}

export const executionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/execution/status", async (req) =>
    withUser(req, async () => {
      const [killSwitch, connections, schedules, limits, allowlist] = await Promise.all([
        getKillSwitch(),
        listConnections(),
        listSchedules(),
        getLimits(),
        getAllowlist(),
      ]);
      return {
        killSwitch,
        connections,
        schedules,
        limits,
        allowlistCount: allowlist.length,
        vaultKeyConfigured: vaultKeyConfigured(),
        withdrawConfirmPhrase: WITHDRAW_CONFIRM_PHRASE,
      };
    }),
  );

  app.post<{
    Body: {
      broker: ExecutionBroker;
      environment?: ExecutionEnvironment;
      apiKey: string;
      apiSecret: string;
      label?: string;
    };
  }>("/api/execution/enable", async (req, reply) =>
    withUser(req, async () => {
      const { broker, apiKey, apiSecret, label } = req.body ?? {};
      const environment = req.body?.environment ?? "paper";
      if (!broker || !apiKey?.trim() || !apiSecret?.trim()) {
        return reply.code(400).send({ error: "broker, apiKey, apiSecret requis" });
      }
      if (broker !== "alpaca" && broker !== "binance") {
        return reply.code(400).send({ error: "MVP : alpaca ou binance uniquement" });
      }
      try {
        return await enableExecution({
          broker,
          environment,
          credentials: { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() },
          label,
        });
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }),
  );

  app.delete<{
    Querystring: { broker: ExecutionBroker; environment?: ExecutionEnvironment };
  }>("/api/execution/connection", async (req, reply) =>
    withUser(req, async () => {
      const broker = req.query.broker;
      const environment = req.query.environment ?? "paper";
      if (!broker) return reply.code(400).send({ error: "broker requis" });
      await deleteConnection(broker, environment);
      await appendAudit("disable_execution", { environment }, broker);
      return { ok: true };
    }),
  );

  app.post<{
    Body: {
      broker?: ExecutionBroker;
      environment?: ExecutionEnvironment;
      symbol: string;
      side: "buy" | "sell";
      type?: "market" | "limit";
      quantity?: number;
      notional?: number;
      limitPrice?: number;
      confirmLive?: boolean;
    };
  }>("/api/execution/orders", async (req, reply) =>
    withUser(req, async () => {
      const body = req.body ?? ({} as never);
      if (!body.symbol || !body.side) {
        return reply.code(400).send({ error: "symbol et side requis" });
      }
      const broker = body.broker ?? routeBrokerForSymbol(body.symbol);
      const environment = body.environment ?? "paper";
      try {
        return await placeOrder({
          broker,
          environment,
          symbol: body.symbol,
          side: body.side,
          type: body.type ?? "market",
          quantity: body.quantity,
          notional: body.notional,
          limitPrice: body.limitPrice,
          confirmLive: body.confirmLive,
        });
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }),
  );

  app.delete<{
    Body: {
      broker: ExecutionBroker;
      environment?: ExecutionEnvironment;
      orderId: string;
      symbol?: string;
    };
  }>("/api/execution/orders", async (req, reply) =>
    withUser(req, async () => {
      const body = req.body ?? ({} as never);
      if (!body.broker || !body.orderId) {
        return reply.code(400).send({ error: "broker et orderId requis" });
      }
      try {
        await cancelOrder({
          broker: body.broker,
          environment: body.environment ?? "paper",
          orderId: body.orderId,
          symbol: body.symbol,
        });
        return { ok: true };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }),
  );

  app.post<{
    Body: {
      broker: ExecutionBroker;
      environment?: ExecutionEnvironment;
      asset: string;
      amount: number;
      address?: string;
      network?: string;
      addressTag?: string;
      confirmLive?: boolean;
      confirmPhrase?: string;
    };
  }>("/api/execution/withdraw", async (req, reply) =>
    withUser(req, async () => {
      const body = req.body ?? ({} as never);
      if (!body.broker || !body.asset || body.amount == null) {
        return reply.code(400).send({ error: "broker, asset, amount requis" });
      }
      try {
        return await withdraw({
          broker: body.broker,
          environment: body.environment ?? "live",
          asset: body.asset,
          amount: Number(body.amount),
          address: body.address,
          network: body.network,
          addressTag: body.addressTag,
          confirmLive: Boolean(body.confirmLive),
          confirmPhrase: body.confirmPhrase ?? "",
        });
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }),
  );

  app.get("/api/execution/schedules", async (req) =>
    withUser(req, async () => ({ schedules: await listSchedules() })),
  );

  app.post<{
    Body: {
      kind: ScheduleKind;
      broker: ExecutionBroker;
      environment?: ExecutionEnvironment;
      symbol?: string;
      amount?: number;
      intervalMinutes: number;
      strategyJson?: unknown;
      strategyId?: string;
      enabled?: boolean;
    };
  }>("/api/execution/schedules", async (req, reply) =>
    withUser(req, async () => {
      const body = req.body ?? ({} as never);
      if (!body.kind || !body.broker || !body.intervalMinutes) {
        return reply.code(400).send({ error: "kind, broker, intervalMinutes requis" });
      }
      const now = new Date().toISOString();
      const enabling = body.enabled !== false;

      if (body.kind === "strategy_live" && enabling) {
        const compat = checkStrategyBrokerCompatibility(
          body.strategyJson as { allocation?: Array<{ asset?: string; weight?: number }> },
          body.broker,
        );
        if (!compat.ok) {
          return reply.code(400).send({ error: compat.message, incompatible: compat.incompatible });
        }
      }

      try {
        // Upsert si strategyId déjà planifié (évite les doublons).
        if (body.strategyId) {
          const existing = (await listSchedules()).find(
            (s) => s.strategyId === body.strategyId && s.kind === body.kind,
          );
          if (existing) {
            const schedule = await saveSchedule({
              ...existing,
              id: existing.id,
              enabled: body.enabled ?? true,
              broker: body.broker,
              environment: body.environment ?? "paper",
              symbol: body.symbol,
              amount: body.amount,
              intervalMinutes: body.intervalMinutes,
              strategyJson: body.strategyJson ?? existing.strategyJson,
              strategyId: body.strategyId,
              nextRunAt: now,
              lastError: undefined,
            });
            if (body.kind === "strategy_live" && schedule.enabled) {
              await pauseOtherStrategyLive(schedule.id);
            }
            await appendAudit(
              "schedule_update",
              { scheduleId: schedule.id, kind: schedule.kind, strategyId: body.strategyId },
              schedule.broker,
            );
            return schedule;
          }
        }
        const schedule = await saveSchedule({
          kind: body.kind,
          enabled: body.enabled ?? true,
          broker: body.broker,
          environment: body.environment ?? "paper",
          symbol: body.symbol,
          amount: body.amount,
          intervalMinutes: body.intervalMinutes,
          strategyJson: body.strategyJson,
          strategyId: body.strategyId,
          nextRunAt: now,
        });
        if (body.kind === "strategy_live" && schedule.enabled) {
          await pauseOtherStrategyLive(schedule.id);
        }
        await appendAudit(
          "schedule_create",
          { scheduleId: schedule.id, kind: schedule.kind, strategyId: body.strategyId },
          schedule.broker,
        );
        return schedule;
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }),
  );

  app.patch<{
    Params: { id: string };
    Body: {
      enabled?: boolean;
      intervalMinutes?: number;
      amount?: number;
      symbol?: string;
      strategyJson?: unknown;
      strategyId?: string;
    };
  }>("/api/execution/schedules/:id", async (req, reply) =>
    withUser(req, async () => {
      const schedules = await listSchedules();
      const existing = schedules.find((s) => s.id === req.params.id);
      if (!existing) return reply.code(404).send({ error: "Schedule introuvable" });

      const nextJson = req.body.strategyJson ?? existing.strategyJson;
      const nextEnabled = req.body.enabled ?? existing.enabled;
      if (existing.kind === "strategy_live" && nextEnabled) {
        const compat = checkStrategyBrokerCompatibility(
          nextJson as { allocation?: Array<{ asset?: string; weight?: number }> },
          existing.broker,
        );
        if (!compat.ok) {
          return reply.code(400).send({ error: compat.message, incompatible: compat.incompatible });
        }
      }

      const schedule = await saveSchedule({
        ...existing,
        ...req.body,
        id: existing.id,
      });
      if (schedule.kind === "strategy_live" && schedule.enabled) {
        await pauseOtherStrategyLive(schedule.id);
      }
      return schedule;
    }),
  );

  app.delete<{ Params: { id: string } }>("/api/execution/schedules/:id", async (req) =>
    withUser(req, async () => {
      await deleteSchedule(req.params.id);
      return { ok: true };
    }),
  );

  app.post<{ Body?: { force?: boolean } }>("/api/execution/schedules/run-due", async (req) =>
    withUser(req, async () =>
      runDueSchedules(new Date(), {
        force: Boolean(req.body?.force),
        userKey: userKeyFromRequest(req),
      }),
    ),
  );

  app.get("/api/execution/allowlist", async (req) =>
    withUser(req, async () => ({ allowlist: await getAllowlist() })),
  );

  app.put<{ Body: { allowlist: string[] } }>("/api/execution/allowlist", async (req, reply) =>
    withUser(req, async () => {
      const list = req.body?.allowlist;
      if (!Array.isArray(list)) return reply.code(400).send({ error: "allowlist[] requis" });
      return { allowlist: await setAllowlist(list) };
    }),
  );

  app.get("/api/execution/killswitch", async (req) => withUser(req, () => getKillSwitch()));

  app.post<{ Body: { engaged: boolean; reason?: string } }>(
    "/api/execution/killswitch",
    async (req, reply) =>
      withUser(req, async () => {
        if (typeof req.body?.engaged !== "boolean") {
          return reply.code(400).send({ error: "engaged boolean requis" });
        }
        const state = await setKillSwitch(req.body.engaged, req.body.reason);
        await appendAudit("killswitch", { engaged: state.engaged, reason: state.reason });
        if (state.engaged) {
          const schedules = await listSchedules();
          for (const s of schedules) {
            if (s.enabled) await saveSchedule({ ...s, enabled: false, id: s.id });
          }
        }
        return state;
      }),
  );

  app.get("/api/execution/audit", async (req) =>
    withUser(req, async () => ({ entries: await listAudit(80) })),
  );

  app.get("/api/execution/orders/history", async (req) =>
    withUser(req, async () => ({
      orders: await listOrderHistory(400),
    })),
  );

  app.put<{ Body: { dailyNotionalLimitUsd: number } }>(
    "/api/execution/limits",
    async (req, reply) =>
      withUser(req, async () => {
        const n = req.body?.dailyNotionalLimitUsd;
        if (typeof n !== "number" || n <= 0) {
          return reply.code(400).send({ error: "dailyNotionalLimitUsd > 0 requis" });
        }
        await setDailyLimit(n);
        return getLimits();
      }),
  );
};
