/**
 * Client HTTP vers l'API Ordium (processus séparé du front Next.js).
 * En dev : http://localhost:4000 — configurable via NEXT_PUBLIC_API_URL.
 */

import { getActiveUserScope } from "./userScope";

export const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
  "http://localhost:4000";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  // Toujours envoyer le scope (demo / compte) — jamais de bucket partagé.
  headers.set("X-Ordium-User", getActiveUserScope() || "anon");
  return fetch(url, { ...init, headers });
}
