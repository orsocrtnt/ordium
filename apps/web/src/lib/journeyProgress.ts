/**
 * Progression du parcours Ordium (local + API).
 * Une étape n’est « faite » que si elle a vraiment été validée.
 */

import { loadStrategyStore } from "./strategyStore";
import { getActiveUserScope, scopedStorageKey } from "./userScope";

const MARKETS_KEY_BASE = "ordium_markets_visited";
const EXEC_TUTORIAL_KEY_BASE = "ordium_exec_tutorial_done";
const POSITIONS_SKIP_KEY_BASE = "ordium_positions_skipped";

function marketsKey(): string {
  return scopedStorageKey(MARKETS_KEY_BASE);
}

function execTutorialKey(): string {
  return scopedStorageKey(EXEC_TUTORIAL_KEY_BASE);
}

function positionsSkipKey(): string {
  return scopedStorageKey(POSITIONS_SKIP_KEY_BASE);
}

/** L’utilisateur a choisi de démarrer sans portefeuille existant. */
export function markPositionsSkipped(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(positionsSkipKey(), "1");
  } catch {
    // ignore
  }
}

export function hasSkippedPositions(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(positionsSkipKey()) === "1";
  } catch {
    return false;
  }
}

/** Étape 1 validée : portefeuille importé OU choix explicite « pas de position ». */
export function hasCompletedPositionsStep(hasPortfolio: boolean): boolean {
  return hasPortfolio || hasSkippedPositions();
}

export function markMarketsVisited(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(marketsKey(), "1");
  } catch {
    // ignore
  }
}

export function hasVisitedMarkets(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(marketsKey()) === "1") return true;
    // Migration démo uniquement
    if (getActiveUserScope() === "demo" && localStorage.getItem(MARKETS_KEY_BASE) === "1") {
      localStorage.setItem(marketsKey(), "1");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Au moins une stratégie créée avec contenu réel (pas le blank initial). */
export function hasCreatedStrategy(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const store = loadStrategyStore();
    return store.strategies.some(
      (s) =>
        s.assetsConfirmed === true ||
        (s.messages?.length ?? 0) > 0 ||
        (s.state.allocation?.length ?? 0) > 0,
    );
  } catch {
    return false;
  }
}

export function loadExecTutorialDone(): boolean[] {
  if (typeof window === "undefined") return [false, false, false, false];
  try {
    let raw = localStorage.getItem(execTutorialKey());
    if (!raw && getActiveUserScope() === "demo") {
      raw = localStorage.getItem(EXEC_TUTORIAL_KEY_BASE);
    }
    if (!raw) return [false, false, false, false];
    const parsed = JSON.parse(raw) as boolean[];
    if (!Array.isArray(parsed) || parsed.length < 4) return [false, false, false, false];
    return [0, 1, 2, 3].map((i) => Boolean(parsed[i]));
  } catch {
    return [false, false, false, false];
  }
}

export function saveExecTutorialDone(done: boolean[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(execTutorialKey(), JSON.stringify(done.slice(0, 4)));
  } catch {
    // ignore
  }
}
