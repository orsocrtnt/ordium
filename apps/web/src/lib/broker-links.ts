import type { ConnectableBrokerId } from "./broker-guide";
import { getActiveUserScope, scopedStorageKey } from "./userScope";

const STORAGE_KEY_BASE = "ordium.broker-links.v1";

function storageKey(): string {
  return scopedStorageKey(STORAGE_KEY_BASE);
}

export type LinkedBroker = {
  id: ConnectableBrokerId;
  /** Compte ouvert / choisi par l’utilisateur (pas encore OAuth technique). */
  status: "chosen" | "opened";
  chosenAt: string;
};

export type BrokerLinksState = {
  brokers: LinkedBroker[];
  updatedAt: string;
};

export function loadBrokerLinks(): BrokerLinksState | null {
  if (typeof window === "undefined") return null;
  try {
    let raw = localStorage.getItem(storageKey());
    if (!raw && getActiveUserScope() === "demo") {
      raw = localStorage.getItem(STORAGE_KEY_BASE);
      if (raw) localStorage.setItem(storageKey(), raw);
    }
    if (!raw) return null;
    return JSON.parse(raw) as BrokerLinksState;
  } catch {
    return null;
  }
}

export function saveBrokerChoice(id: ConnectableBrokerId, status: "chosen" | "opened"): void {
  const prev = loadBrokerLinks();
  const others = (prev?.brokers ?? []).filter((b) => b.id !== id);
  const next: BrokerLinksState = {
    brokers: [...others, { id, status, chosenAt: new Date().toISOString() }],
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(storageKey(), JSON.stringify(next));
}

export function openBrokerSite(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Vrai si l’utilisateur a déjà lié / choisi un broker dans Ordium. */
export function hasLinkedBroker(): boolean {
  return (loadBrokerLinks()?.brokers?.length ?? 0) > 0;
}
