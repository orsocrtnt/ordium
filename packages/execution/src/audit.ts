import { mkdir, readFile, writeFile, access, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  executionUserDir,
  getExecutionUserKey,
  legacyAuditPath,
} from "./userContext.js";
import type { AuditEntry, ExecutionBroker, ExecutionEnvironment, OrderSide } from "./types.js";

function filePath(): string {
  return path.join(executionUserDir(), "audit.jsonl");
}

async function migrateLegacyDemoIfNeeded(): Promise<void> {
  if (getExecutionUserKey() !== "demo") return;
  try {
    await access(filePath());
    return;
  } catch {
    // continue
  }
  try {
    await access(legacyAuditPath());
    await mkdir(path.dirname(filePath()), { recursive: true });
    await copyFile(legacyAuditPath(), filePath());
  } catch {
    // pas de legacy
  }
}

export async function appendAudit(
  action: string,
  detail: Record<string, unknown>,
  broker?: ExecutionBroker,
): Promise<AuditEntry> {
  await migrateLegacyDemoIfNeeded();
  const entry: AuditEntry = {
    id: randomBytes(8).toString("hex"),
    at: new Date().toISOString(),
    action,
    broker,
    detail,
  };
  await mkdir(path.dirname(filePath()), { recursive: true });
  await writeFile(filePath(), `${JSON.stringify(entry)}\n`, { flag: "a" });
  return entry;
}

export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  await migrateLegacyDemoIfNeeded();
  try {
    const raw = await readFile(filePath(), "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => JSON.parse(l) as AuditEntry)
      .reverse();
  } catch {
    return [];
  }
}

export type OrderHistoryItem = {
  id: string;
  at: string;
  broker: ExecutionBroker;
  action: "place_order" | "cancel_order";
  orderId?: string;
  symbol?: string;
  side?: OrderSide;
  status?: string;
  environment?: ExecutionEnvironment;
  quantity?: number;
  notional?: number;
};

function asNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Historique des ordres placés / annulés via Ordium (audit local). */
export async function listOrderHistory(limit = 400): Promise<OrderHistoryItem[]> {
  const entries = await listAudit(Math.max(limit * 3, 600));
  const out: OrderHistoryItem[] = [];
  for (const e of entries) {
    if (e.action !== "place_order" && e.action !== "cancel_order") continue;
    if (e.broker !== "binance" && e.broker !== "alpaca") continue;
    const d = e.detail ?? {};
    out.push({
      id: e.id,
      at: e.at,
      broker: e.broker,
      action: e.action,
      orderId: asStr(d.orderId),
      symbol: asStr(d.symbol),
      side: d.side === "buy" || d.side === "sell" ? d.side : undefined,
      status: asStr(d.status),
      environment:
        d.environment === "paper" || d.environment === "live" ? d.environment : undefined,
      quantity: asNum(d.quantity),
      notional: asNum(d.notional),
    });
    if (out.length >= limit) break;
  }
  return out;
}
