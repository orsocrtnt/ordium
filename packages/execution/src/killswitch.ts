import { mkdir, readFile, writeFile, access, copyFile } from "node:fs/promises";
import path from "node:path";
import {
  executionUserDir,
  getExecutionUserKey,
  legacyKillSwitchPath,
} from "./userContext.js";
import type { KillSwitchState } from "./types.js";

function filePath(): string {
  return path.join(executionUserDir(), "killswitch.json");
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
    await access(legacyKillSwitchPath());
    await mkdir(path.dirname(filePath()), { recursive: true });
    await copyFile(legacyKillSwitchPath(), filePath());
  } catch {
    // pas de legacy
  }
}

export async function getKillSwitch(): Promise<KillSwitchState> {
  await migrateLegacyDemoIfNeeded();
  try {
    return JSON.parse(await readFile(filePath(), "utf8")) as KillSwitchState;
  } catch {
    return { engaged: false, updatedAt: new Date().toISOString() };
  }
}

export async function setKillSwitch(
  engaged: boolean,
  reason?: string,
): Promise<KillSwitchState> {
  const state: KillSwitchState = {
    engaged,
    reason: engaged ? reason ?? "Kill switch engagé" : undefined,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(filePath()), { recursive: true });
  await writeFile(filePath(), JSON.stringify(state, null, 2));
  return state;
}

export async function assertKillSwitchClear(): Promise<void> {
  const ks = await getKillSwitch();
  if (ks.engaged) {
    throw new Error(`Kill switch actif : ${ks.reason ?? "exécution bloquée"}`);
  }
}
