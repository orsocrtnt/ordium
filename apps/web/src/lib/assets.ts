import { displayNameForAsset, normalizeAsset } from "@ordium/portfolio/normalize";
import type { Holding } from "@ordium/portfolio";

/** Construit une table ticker → nom complet depuis les holdings importés. */
export function nameMapFromHoldings(holdings: Holding[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of holdings) {
    const key = normalizeAsset(h.asset);
    const label = displayNameForAsset(key, h.name);
    if (label) map.set(key, label);
    map.set(h.asset.toUpperCase(), label);
  }
  return map;
}

/** Affiche le nom complet d'un actif (jamais le seul ticker si on a mieux). */
export function assetLabel(
  asset: string,
  names?: Map<string, string> | Record<string, string>,
): string {
  const key = normalizeAsset(asset);
  const fromMap =
    names instanceof Map
      ? (names.get(key) ?? names.get(asset) ?? names.get(asset.toUpperCase()))
      : (names?.[key] ?? names?.[asset] ?? names?.[asset.toUpperCase()]);
  return displayNameForAsset(key, fromMap);
}
