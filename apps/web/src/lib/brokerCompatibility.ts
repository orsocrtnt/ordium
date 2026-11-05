/**
 * Compatibilité stratégie ↔ broker (UI).
 * Source de vérité : @ordium/execution/brokerRoute
 */

import {
  checkStrategyBrokerCompatibility,
  routeBrokerForSymbol,
  type BrokerCompatResult,
  type ExecutionBroker,
} from "@ordium/execution/brokerRoute";
import type { EditorState } from "./strategy";
import type { SavedStrategy } from "./strategyStore";

export type { BrokerCompatResult, ExecutionBroker };
export { routeBrokerForSymbol, checkStrategyBrokerCompatibility };

/** Allocation éditeur → format moteur (weight), accepte pct ou weight. */
export function allocationForCompatCheck(
  state: Pick<EditorState, "allocation"> | null | undefined,
): { allocation: Array<{ asset: string; weight: number }> } {
  const allocation: Array<{ asset: string; weight: number }> = [];
  for (const a of state?.allocation ?? []) {
    const asset = (a.asset ?? "").trim();
    if (!asset) continue;
    const pct = Number(a.pct);
    const weight =
      Number.isFinite(pct) && pct > 0 ? (pct > 1 ? pct / 100 : pct) : 0;
    if (weight > 0) allocation.push({ asset: asset.toUpperCase(), weight });
  }
  return { allocation };
}

export function checkSavedStrategyBrokerCompat(
  strategy: SavedStrategy,
  broker: ExecutionBroker,
): BrokerCompatResult {
  return checkStrategyBrokerCompatibility(allocationForCompatCheck(strategy.state), broker);
}

export function isStrategyCompatibleWithBroker(
  strategy: SavedStrategy,
  broker: ExecutionBroker,
): boolean {
  return checkSavedStrategyBrokerCompat(strategy, broker).ok;
}
