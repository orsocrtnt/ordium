/**
 * Portée utilisateur pour localStorage + header API.
 * Chaque compte (démo inclus) a son propre espace de données.
 */

const SCOPE_STORAGE = "ordium.active_user_v1";

let memoryScope = "anon";

/** Slug stable et sûr pour clé fichier / localStorage. */
export function userScopeFromEmail(email: string | null | undefined, isDemo = false): string {
  if (isDemo) return "demo";
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return "anon";
  // demo@ordium.app → même bucket que le flag isDemo
  if (e === "demo@ordium.app") return "demo";
  return e
    .replace(/@/g, "_at_")
    .replace(/[^a-z0-9._+-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

export function getActiveUserScope(): string {
  if (typeof window === "undefined") return memoryScope;
  try {
    const fromLs = localStorage.getItem(SCOPE_STORAGE);
    if (fromLs) {
      memoryScope = fromLs;
      return fromLs;
    }
  } catch {
    // ignore
  }
  return memoryScope;
}

export function setActiveUserScope(email: string | null | undefined, isDemo = false): string {
  const scope = userScopeFromEmail(email, isDemo);
  memoryScope = scope;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(SCOPE_STORAGE, scope);
      window.dispatchEvent(new CustomEvent("ordium:user-scope", { detail: { scope } }));
    } catch {
      // ignore
    }
  }
  return scope;
}

export function clearActiveUserScope(): void {
  memoryScope = "anon";
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(SCOPE_STORAGE);
      window.dispatchEvent(new CustomEvent("ordium:user-scope", { detail: { scope: "anon" } }));
    } catch {
      // ignore
    }
  }
}

/** Préfixe une clé localStorage avec la portée courante. */
export function scopedStorageKey(baseKey: string, scope = getActiveUserScope()): string {
  return `${baseKey}::${scope}`;
}
