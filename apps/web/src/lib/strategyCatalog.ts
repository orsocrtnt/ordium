/**
 * Re-export du catalogue stratégies (source de vérité : @ordium/engine).
 * Utile pour l’UI web sans dépendre du chemin API.
 */
export {
  STRATEGY_PRESETS,
  readyPresets,
  explainPatch,
  buildPatchFromPresetIds,
  type StrategyFormPatch,
  type StrategyPreset,
  type StrategyStatus,
} from "@ordium/engine";
