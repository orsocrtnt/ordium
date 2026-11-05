import { mkdir, readFile, writeFile, access, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { decryptCredentials, encryptCredentials } from "./vault.js";
import {
  executionUserDir,
  getExecutionUserKey,
  legacyExecutionStorePath,
} from "./userContext.js";
import type {
  BrokerConnection,
  BrokerCredentials,
  BrokerScope,
  ExecutionBroker,
  ExecutionEnvironment,
  ExecutionSchedule,
  StoredConnectionSecrets,
} from "./types.js";

interface StoreFile {
  connections: BrokerConnection[];
  secrets: StoredConnectionSecrets[];
  schedules: ExecutionSchedule[];
  /** Adresses Binance autorisées : `${coin}:${network}:${address}` lowercase. */
  withdrawAllowlist: string[];
  dailyNotionalLimitUsd: number;
  dailyNotionalUsedUsd: number;
  dailyNotionalDate: string;
}

function storePath(): string {
  return path.join(executionUserDir(), "store.json");
}

function emptyStore(): StoreFile {
  return {
    connections: [],
    secrets: [],
    schedules: [],
    withdrawAllowlist: [],
    dailyNotionalLimitUsd: 10_000,
    dailyNotionalUsedUsd: 0,
    dailyNotionalDate: new Date().toISOString().slice(0, 10),
  };
}

async function migrateLegacyDemoIfNeeded(): Promise<void> {
  if (getExecutionUserKey() !== "demo") return;
  const target = storePath();
  try {
    await access(target);
    return; // déjà migré
  } catch {
    // continue
  }
  try {
    await access(legacyExecutionStorePath());
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(legacyExecutionStorePath(), target);
  } catch {
    // pas de legacy
  }
}

async function load(): Promise<StoreFile> {
  await migrateLegacyDemoIfNeeded();
  try {
    return { ...emptyStore(), ...(JSON.parse(await readFile(storePath(), "utf8")) as StoreFile) };
  } catch {
    return emptyStore();
  }
}

async function save(store: StoreFile): Promise<void> {
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeFile(storePath(), JSON.stringify(store, null, 2));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function listConnections(): Promise<BrokerConnection[]> {
  return (await load()).connections;
}

export async function upsertConnection(input: {
  broker: ExecutionBroker;
  environment: ExecutionEnvironment;
  credentials: BrokerCredentials;
  scopes: BrokerScope[];
  label?: string;
}): Promise<BrokerConnection> {
  const store = await load();
  const existing = store.connections.find(
    (c) => c.broker === input.broker && c.environment === input.environment,
  );
  const now = new Date().toISOString();
  const enc = encryptCredentials(input.credentials);

  if (existing) {
    existing.scopes = input.scopes;
    existing.label = input.label ?? existing.label;
    existing.updatedAt = now;
    store.secrets = store.secrets.filter((s) => s.connectionId !== existing.id);
    store.secrets.push({
      connectionId: existing.id,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      tag: enc.tag,
    });
    await save(store);
    return existing;
  }

  const conn: BrokerConnection = {
    id: randomBytes(8).toString("hex"),
    broker: input.broker,
    environment: input.environment,
    scopes: input.scopes,
    label: input.label,
    createdAt: now,
    updatedAt: now,
  };
  store.connections.push(conn);
  store.secrets.push({
    connectionId: conn.id,
    ciphertext: enc.ciphertext,
    iv: enc.iv,
    tag: enc.tag,
  });
  await save(store);
  return conn;
}

export async function getCredentials(
  broker: ExecutionBroker,
  environment: ExecutionEnvironment,
): Promise<BrokerCredentials> {
  const store = await load();
  const conn = store.connections.find(
    (c) => c.broker === broker && c.environment === environment,
  );
  if (!conn) {
    throw new Error(`Aucune connexion exécution ${broker}/${environment}. Activez l’exécution d’abord.`);
  }
  const secret = store.secrets.find((s) => s.connectionId === conn.id);
  if (!secret) throw new Error("Secrets manquants pour cette connexion");
  return decryptCredentials(secret);
}

export async function getConnection(
  broker: ExecutionBroker,
  environment: ExecutionEnvironment,
): Promise<BrokerConnection | null> {
  return (
    (await load()).connections.find(
      (c) => c.broker === broker && c.environment === environment,
    ) ?? null
  );
}

export async function deleteConnection(
  broker: ExecutionBroker,
  environment: ExecutionEnvironment,
): Promise<void> {
  const store = await load();
  const conn = store.connections.find(
    (c) => c.broker === broker && c.environment === environment,
  );
  if (!conn) return;
  store.connections = store.connections.filter((c) => c.id !== conn.id);
  store.secrets = store.secrets.filter((s) => s.connectionId !== conn.id);
  store.schedules = store.schedules.filter(
    (s) => !(s.broker === broker && s.environment === environment),
  );
  await save(store);
}

export async function listSchedules(): Promise<ExecutionSchedule[]> {
  return (await load()).schedules;
}

export async function saveSchedule(
  schedule: Omit<ExecutionSchedule, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
  },
): Promise<ExecutionSchedule> {
  const store = await load();
  const now = new Date().toISOString();
  if (schedule.id) {
    const idx = store.schedules.findIndex((s) => s.id === schedule.id);
    if (idx < 0) throw new Error("Schedule introuvable");
    const next: ExecutionSchedule = {
      ...store.schedules[idx]!,
      ...schedule,
      id: schedule.id,
      updatedAt: now,
    };
    store.schedules[idx] = next;
    await save(store);
    return next;
  }
  const created: ExecutionSchedule = {
    ...schedule,
    id: randomBytes(8).toString("hex"),
    createdAt: now,
    updatedAt: now,
  };
  store.schedules.push(created);
  await save(store);
  return created;
}

export async function deleteSchedule(id: string): Promise<void> {
  const store = await load();
  store.schedules = store.schedules.filter((s) => s.id !== id);
  await save(store);
}

export async function updateScheduleRun(
  id: string,
  patch: Partial<Pick<ExecutionSchedule, "nextRunAt" | "lastRunAt" | "lastError" | "enabled">>,
): Promise<void> {
  const store = await load();
  const s = store.schedules.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch, { updatedAt: new Date().toISOString() });
  await save(store);
}

export async function getAllowlist(): Promise<string[]> {
  return (await load()).withdrawAllowlist;
}

export async function setAllowlist(entries: string[]): Promise<string[]> {
  const store = await load();
  store.withdrawAllowlist = [
    ...new Set(entries.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ];
  await save(store);
  return store.withdrawAllowlist;
}

export function allowlistKey(coin: string, network: string, address: string): string {
  return `${coin}:${network}:${address}`.toLowerCase();
}

export async function assertInAllowlist(
  coin: string,
  network: string,
  address: string,
): Promise<void> {
  const key = allowlistKey(coin, network, address);
  const list = await getAllowlist();
  if (!list.includes(key)) {
    throw new Error(
      `Adresse non autorisée. Ajoutez « ${key} » à l’allowlist de retraits avant.`,
    );
  }
}

export async function assertDailyLimit(notionalUsd: number): Promise<void> {
  const store = await load();
  if (store.dailyNotionalDate !== today()) {
    store.dailyNotionalDate = today();
    store.dailyNotionalUsedUsd = 0;
  }
  if (store.dailyNotionalUsedUsd + notionalUsd > store.dailyNotionalLimitUsd) {
    throw new Error(
      `Plafond journalier dépassé (${store.dailyNotionalLimitUsd} USD). Kill switch ou attendez demain.`,
    );
  }
  store.dailyNotionalUsedUsd += notionalUsd;
  await save(store);
}

export async function getLimits(): Promise<{
  dailyNotionalLimitUsd: number;
  dailyNotionalUsedUsd: number;
  dailyNotionalDate: string;
}> {
  const store = await load();
  if (store.dailyNotionalDate !== today()) {
    return {
      dailyNotionalLimitUsd: store.dailyNotionalLimitUsd,
      dailyNotionalUsedUsd: 0,
      dailyNotionalDate: today(),
    };
  }
  return {
    dailyNotionalLimitUsd: store.dailyNotionalLimitUsd,
    dailyNotionalUsedUsd: store.dailyNotionalUsedUsd,
    dailyNotionalDate: store.dailyNotionalDate,
  };
}

export async function setDailyLimit(limitUsd: number): Promise<void> {
  const store = await load();
  store.dailyNotionalLimitUsd = limitUsd;
  await save(store);
}
