/**
 * Persistance locale multi-stratégies (navigateur).
 * Activer/désactiver = flag `enabled` (prêt pour exécution plus tard).
 */

import { blankEditorState, type EditorState } from "./strategy";
import type { InterpretResponse } from "@/components/StrategyPromptTypes";
import { getActiveUserScope, scopedStorageKey } from "./userScope";

/** Message de discussion persisté avec la stratégie. */
export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: InterpretResponse;
  summaryBullets?: string[];
  applied?: boolean;
  /** Patch en cours de construction (après interprétation + réponses). */
  draftPatch?: Record<string, unknown>;
  /** Champ obligatoire en attente de réponse. */
  awaitingField?:
    | "budget"
    | "frequency"
    | "window"
    | "assets"
    | "budgetSplit"
    | "assetClassMix"
    | "startDate";
  /** Question mise en évidence (gras) sous la réponse. */
  question?: string;
  /** Suggestions cliquables sous la question. */
  suggestions?: string[];
  /** Actions conversationnelles (rejet / reset). */
  actions?: ("restart" | "alternatives" | "revise")[];
};

export type SavedStrategy = {
  id: string;
  name: string;
  /** Incluse dans le pool « prêtes à automatiser ». */
  enabled: boolean;
  state: EditorState;
  /** Historique de discussion (prompt ↔ Ordium). */
  messages: StoredChatMessage[];
  /**
   * True une fois les actifs choisis pour la 1ʳᵉ simulation.
   * Tant que false : on propose le questionnaire d’actifs avant de simuler.
   */
  assetsConfirmed?: boolean;
  createdAt: string;
  updatedAt: string;
};

type StorePayload = {
  version: 3;
  activeId: string;
  strategies: SavedStrategy[];
};

const KEY_BASE = "ordium_strategies_v3";
const LEGACY_KEYS = ["ordium_strategies_v2", "ordium_strategies_v1"];

function storageKey(): string {
  return scopedStorageKey(KEY_BASE);
}

function uid(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyStore(): StorePayload {
  const now = new Date().toISOString();
  const first: SavedStrategy = {
    id: uid(),
    name: "Ma stratégie",
    enabled: false,
    state: blankEditorState(),
    messages: [],
    assetsConfirmed: false,
    createdAt: now,
    updatedAt: now,
  };
  return { version: 3, activeId: first.id, strategies: [first] };
}

function normalizeStrategy(s: SavedStrategy & { messages?: StoredChatMessage[] }): SavedStrategy {
  const state = s.state ?? blankEditorState();
  const allocation = Array.isArray(state.allocation)
    ? state.allocation.map((a) => ({ ...a }))
    : blankEditorState().allocation;
  return {
    ...s,
    messages: Array.isArray(s.messages) ? s.messages : [],
    assetsConfirmed:
      typeof s.assetsConfirmed === "boolean" ? s.assetsConfirmed : allocation.some((a) => a.pct > 0),
    state: {
      ...blankEditorState(),
      ...state,
      regimeReferenceAsset:
        typeof state.regimeReferenceAsset === "string"
          ? state.regimeReferenceAsset
          : blankEditorState().regimeReferenceAsset,
      // Toujours indépendant sauf choix explicite "reference" après migration v3.
      regimeScope: state.regimeScope === "reference" ? "reference" : "per_asset",
      fallbackNeutral:
        typeof state.fallbackNeutral === "boolean" ? state.fallbackNeutral : true,
      horizon: state.horizon ?? null,
      allocation,
    },
  };
}

/** Au plus une stratégie `enabled` — garde `preferId` si elle l’était, sinon la première trouvée. */
export function ensureSingleEnabled(
  strategies: SavedStrategy[],
  preferId?: string | null,
): SavedStrategy[] {
  const enabledIds = strategies.filter((s) => s.enabled).map((s) => s.id);
  if (enabledIds.length <= 1) return strategies;
  const keep =
    preferId && enabledIds.includes(preferId) ? preferId : enabledIds[0]!;
  return strategies.map((s) =>
    s.enabled && s.id !== keep ? { ...s, enabled: false } : s,
  );
}

/** Active `id` et désactive toutes les autres. Passe `null` pour tout désactiver. */
export function withExclusiveEnabled(
  strategies: SavedStrategy[],
  id: string | null,
): SavedStrategy[] {
  const now = new Date().toISOString();
  return strategies.map((s) => {
    const shouldEnable = id != null && s.id === id;
    if (s.enabled === shouldEnable) return s;
    return { ...s, enabled: shouldEnable, updatedAt: now };
  });
}

/** Force le régime par actif — corrige les strats restées en mode indice unique. */
function forcePerAssetRegime(parsed: { activeId: string; strategies: SavedStrategy[] }): StorePayload {
  return {
    version: 3,
    activeId: parsed.activeId,
    strategies: parsed.strategies.map((s) => {
      const n = normalizeStrategy(s);
      return {
        ...n,
        state: {
          ...n.state,
          regimeScope: "per_asset",
          fallbackNeutral: n.state.fallbackNeutral !== false,
        },
      };
    }),
  };
}

export function loadStrategyStore(): StorePayload {
  if (typeof window === "undefined") return emptyStore();
  try {
    const key = storageKey();
    let rawV3 = localStorage.getItem(key);
    // Migration : anciennes clés globales → uniquement pour le compte démo.
    if (!rawV3 && getActiveUserScope() === "demo") {
      rawV3 = localStorage.getItem(KEY_BASE);
      if (rawV3) {
        localStorage.setItem(key, rawV3);
      }
    }
    let rawLegacy: string | null = null;
    if (!rawV3 && getActiveUserScope() === "demo") {
      for (const k of LEGACY_KEYS) {
        rawLegacy = localStorage.getItem(k);
        if (rawLegacy) break;
      }
    }
    const raw = rawV3 ?? rawLegacy;

    if (!raw) {
      const init = emptyStore();
      localStorage.setItem(key, JSON.stringify(init));
      return init;
    }

    let parsed = JSON.parse(raw) as { version?: number; activeId: string; strategies: SavedStrategy[] };
    if (!parsed?.strategies?.length) {
      const init = emptyStore();
      localStorage.setItem(key, JSON.stringify(init));
      return init;
    }

    // v3 : première charge depuis v1/v2 → force per_asset (bug : beaucoup restaient en "reference").
    if (!rawV3 || parsed.version !== 3) {
      parsed = forcePerAssetRegime(parsed);
      localStorage.setItem(key, JSON.stringify(parsed));
      if (getActiveUserScope() === "demo") {
        for (const k of LEGACY_KEYS) {
          try {
            localStorage.removeItem(k);
          } catch {
            // ignore
          }
        }
      }
    }

    const normalized: StorePayload = {
      version: 3,
      activeId: parsed.activeId,
      strategies: ensureSingleEnabled(
        parsed.strategies.map((s) => normalizeStrategy(s)),
        parsed.activeId,
      ),
    };
    if (!normalized.strategies.some((s) => s.id === normalized.activeId)) {
      normalized.activeId = normalized.strategies[0]!.id;
    }
    return normalized;
  } catch {
    return emptyStore();
  }
}

export function saveStrategyStore(store: StorePayload): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ ...store, version: 3 }));
  } catch {
    // quota
  }
}

export function createStrategy(name = "Nouvelle stratégie"): SavedStrategy {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name,
    enabled: false,
    state: blankEditorState(),
    messages: [],
    assetsConfirmed: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Nom affiché : trim seulement aux bords, espaces internes conservés. */
export function sanitizeStrategyName(raw: string, fallback = "Sans titre"): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}
