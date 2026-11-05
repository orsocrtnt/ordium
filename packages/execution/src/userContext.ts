/**
 * Portée utilisateur pour le store d’exécution (AsyncLocalStorage).
 * Chaque compte (démo inclus) a son propre dossier data/execution/users/{key}/.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { executionDataRoot } from "./paths.js";

const als = new AsyncLocalStorage<string>();

export function sanitizeExecutionUserKey(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "anon") return "anon";
  if (s === "demo") return "demo";
  return (
    s
      .replace(/@/g, "_at_")
      .replace(/[^a-z0-9._+-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 80) || "anon"
  );
}

export function getExecutionUserKey(): string {
  return sanitizeExecutionUserKey(als.getStore() ?? "anon");
}

export function runAsExecutionUser<T>(userKey: string, fn: () => T): T {
  return als.run(sanitizeExecutionUserKey(userKey), fn);
}

export async function runAsExecutionUserAsync<T>(
  userKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(sanitizeExecutionUserKey(userKey), fn);
}

/** Dossier data pour l’utilisateur courant. */
export function executionUserDir(userKey = getExecutionUserKey()): string {
  return path.join(executionDataRoot(), "users", sanitizeExecutionUserKey(userKey));
}

/** Ancien fichier unique (pré-isolation) — réservé à la migration démo. */
export function legacyExecutionStorePath(): string {
  return path.join(executionDataRoot(), "store.json");
}

export function legacyKillSwitchPath(): string {
  return path.join(executionDataRoot(), "killswitch.json");
}

export function legacyAuditPath(): string {
  return path.join(executionDataRoot(), "audit.jsonl");
}

/** Liste les clés utilisateur ayant un store (pour le scheduler). */
export async function listExecutionUserKeys(): Promise<string[]> {
  const root = path.join(executionDataRoot(), "users");
  const keys = new Set<string>();
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) keys.add(sanitizeExecutionUserKey(e.name));
    }
  } catch {
    // pas encore de dossier users/
  }
  // Legacy store.json → traité comme démo tant qu’il existe
  try {
    const { access } = await import("node:fs/promises");
    await access(legacyExecutionStorePath());
    keys.add("demo");
  } catch {
    // pas de legacy
  }
  return [...keys].filter((k) => k !== "anon");
}
