/**
 * Persistance locale multi-stratégies (navigateur).
 * Activer/désactiver = flag `enabled` (prêt pour exécution plus tard).
 */

import { blankEditorState, type EditorState } from "./strategy";
import type { InterpretResponse } from "@/components/StrategyPromptTypes";

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
  awaitingField?: "budget" | "frequency" | "window" | "startDate";
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
  createdAt: string;
  updatedAt: string;
};

type StorePayload = {
  version: 1;
  activeId: string;
  strategies: SavedStrategy[];
};

const KEY = "ordium_strategies_v1";

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
    createdAt: now,
    updatedAt: now,
  };
  return { version: 1, activeId: first.id, strategies: [first] };
}

function normalizeStrategy(s: SavedStrategy & { messages?: StoredChatMessage[] }): SavedStrategy {
  const state = s.state ?? blankEditorState();
  return {
    ...s,
    messages: Array.isArray(s.messages) ? s.messages : [],
    state: {
      ...blankEditorState(),
      ...state,
      regimeReferenceAsset:
        typeof state.regimeReferenceAsset === "string"
          ? state.regimeReferenceAsset
          : blankEditorState().regimeReferenceAsset,
      horizon: state.horizon ?? null,
      allocation: Array.isArray(state.allocation)
        ? state.allocation.map((a) => ({ ...a }))
        : blankEditorState().allocation,
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

export function loadStrategyStore(): StorePayload {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const init = emptyStore();
      localStorage.setItem(KEY, JSON.stringify(init));
      return init;
    }
    const parsed = JSON.parse(raw) as StorePayload;
    if (!parsed?.strategies?.length) {
      const init = emptyStore();
      localStorage.setItem(KEY, JSON.stringify(init));
      return init;
    }
    parsed.strategies = ensureSingleEnabled(
      parsed.strategies.map((s) => normalizeStrategy(s)),
      parsed.activeId,
    );
    if (!parsed.strategies.some((s) => s.id === parsed.activeId)) {
      parsed.activeId = parsed.strategies[0]!.id;
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export function saveStrategyStore(store: StorePayload): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
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
    createdAt: now,
    updatedAt: now,
  };
}

/** Nom affiché : trim seulement aux bords, espaces internes conservés. */
export function sanitizeStrategyName(raw: string, fallback = "Sans titre"): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}
