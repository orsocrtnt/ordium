/**
 * Helpers paper trading — connexion d’exécution + sync schedule stratégie.
 */

import { apiFetch } from "./api";
import {
  checkStrategyBrokerCompatibility,
  type ExecutionBroker,
} from "./brokerCompatibility";

export type PaperConnection = {
  id: string;
  broker: "alpaca" | "binance";
  environment: "paper" | "live";
  scopes: string[];
  label?: string;
};

export type ExecutionScheduleInfo = {
  id: string;
  kind: string;
  enabled: boolean;
  broker: string;
  environment: string;
  strategyId?: string;
  nextRunAt: string;
  lastRunAt?: string;
  lastError?: string;
};

export type ExecutionStatus = {
  connections: PaperConnection[];
  schedules: ExecutionScheduleInfo[];
  killSwitch?: { engaged: boolean; reason?: string };
};

export async function fetchExecutionStatus(): Promise<ExecutionStatus | null> {
  try {
    const res = await apiFetch("/api/execution/status");
    if (!res.ok) return null;
    return (await res.json()) as ExecutionStatus;
  } catch {
    return null;
  }
}

/** Connexion paper (Testnet Binance prioritaire si plusieurs). */
export function pickPaperConnection(
  connections: PaperConnection[],
): PaperConnection | null {
  const paper = connections.filter((c) => c.environment === "paper");
  if (paper.length === 0) return null;
  return paper.find((c) => c.broker === "binance") ?? paper[0]!;
}

export async function hasPaperExecutionConnection(): Promise<boolean> {
  const status = await fetchExecutionStatus();
  if (!status) return false;
  return pickPaperConnection(status.connections) != null;
}

export async function syncStrategyPaperSchedule(opts: {
  strategyId: string;
  strategyJson: unknown;
  amount: number;
  enabled: boolean;
}): Promise<{ schedule: ExecutionScheduleInfo; connection: PaperConnection } | { error: string }> {
  const status = await fetchExecutionStatus();
  if (!status) return { error: "API exécution injoignable" };
  const connection = pickPaperConnection(status.connections);
  if (!connection) {
    return { error: "Aucune connexion paper. Connecte Binance Testnet dans Exécution." };
  }

  if (!opts.enabled) {
    const existing = status.schedules.find((s) => s.strategyId === opts.strategyId);
    if (existing) {
      const res = await apiFetch(`/api/execution/schedules/${existing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error ?? "Impossible de pause le schedule" };
      return { schedule: data as ExecutionScheduleInfo, connection };
    }
    return {
      schedule: {
        id: "",
        kind: "strategy_live",
        enabled: false,
        broker: connection.broker,
        environment: "paper",
        strategyId: opts.strategyId,
        nextRunAt: new Date().toISOString(),
      },
      connection,
    };
  }

  const compat = checkStrategyBrokerCompatibility(
    opts.strategyJson as { allocation?: Array<{ asset?: string; weight?: number }> },
    connection.broker as ExecutionBroker,
  );
  if (!compat.ok) {
    return { error: compat.message ?? "Stratégie incompatible avec le broker connecté." };
  }

  // Une seule auto paper active : pause les autres côté client (l’API le refait aussi).
  const others = status.schedules.filter(
    (s) =>
      s.kind === "strategy_live" &&
      s.enabled &&
      s.strategyId !== opts.strategyId,
  );
  await Promise.all(
    others.map((s) =>
      apiFetch(`/api/execution/schedules/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }).catch(() => null),
    ),
  );

  const res = await apiFetch("/api/execution/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "strategy_live",
      broker: connection.broker,
      environment: "paper",
      amount: opts.amount,
      intervalMinutes: 1440,
      strategyJson: opts.strategyJson,
      strategyId: opts.strategyId,
      enabled: true,
    }),
  });
  const data = await res.json();
  if (!res.ok) return { error: data.error ?? "Impossible de créer le schedule" };
  return { schedule: data as ExecutionScheduleInfo, connection };
}
