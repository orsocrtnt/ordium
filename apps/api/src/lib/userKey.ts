/**
 * Identifiant utilisateur côté API (header X-Ordium-User).
 * Isole portefeuilles / données par compte.
 */

import type { FastifyRequest } from "fastify";

export function sanitizeUserKey(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "anon") return "anon";
  if (s === "demo") return "demo";
  return (
    s
      .replace(/@/g, "_at_")
      .replace(/[^a-z0-9._+-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 80) || "anon"
  );
}

export function userKeyFromRequest(req: FastifyRequest): string {
  const header = req.headers["x-ordium-user"];
  const raw = Array.isArray(header) ? header[0] : header;
  return sanitizeUserKey(raw);
}
