"use client";

/**
 * Auth : compte démo local + Supabase Auth quand configuré.
 */

import { createClient } from "@/utils/supabase/client";
import { validatePassword } from "./passwordPolicy";
import { getSupabaseConfig } from "./supabase";
import {
  clearActiveUserScope,
  setActiveUserScope,
} from "./userScope";

export const DEMO_EMAIL =
  process.env.NEXT_PUBLIC_DEMO_EMAIL?.trim() || "demo@ordium.app";
export const DEMO_PASSWORD =
  process.env.NEXT_PUBLIC_DEMO_PASSWORD?.trim() || "demo1234";

const STORAGE_KEY = "ordium.session.v1";

export type SessionUser = {
  email: string;
  name: string;
  isDemo: boolean;
};

export type Session = {
  user: SessionUser;
  createdAt: string;
};

export type AuthErrorCode = "account_missing" | "weak_password" | "supabase_required";

export type LoginResult =
  | { ok: true; session: Session }
  | { ok: false; error: string; code?: AuthErrorCode };

export type SignUpResult =
  | { ok: true; session: Session; needsEmailConfirmation: false }
  | { ok: true; needsEmailConfirmation: true; email: string }
  | { ok: false; error: string; code?: AuthErrorCode };

export type ResendResult = { ok: true } | { ok: false; error: string };

function readLocalSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.user?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalSession(session: Session | null) {
  if (typeof window === "undefined") return;
  if (!session) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getLocalSession(): Session | null {
  return readLocalSession();
}

function demoSession(): Session {
  return {
    user: {
      email: DEMO_EMAIL,
      name: "Compte démo",
      isDemo: true,
    },
    createdAt: new Date().toISOString(),
  };
}

function sessionFromSupabaseUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): Session | null {
  if (!user.email) return null;
  const metaName = user.user_metadata?.name;
  return {
    user: {
      email: user.email,
      name:
        typeof metaName === "string" && metaName.trim()
          ? metaName
          : user.email.split("@")[0]!,
      isDemo: false,
    },
    createdAt: new Date().toISOString(),
  };
}

function appOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Erreurs Supabase typiques quand le compte n’existe pas / mauvais MDP. */
export function isAccountMissingError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("invalid login credentials") ||
    m.includes("invalid_credentials") ||
    m.includes("user not found") ||
    m.includes("email not found") ||
    m.includes("no user found")
  );
}

function frenchAuthError(message: string): string {
  const m = message.toLowerCase();
  if (isAccountMissingError(message)) {
    return "Aucun compte avec cet e-mail, ou mot de passe incorrect.";
  }
  if (m.includes("email not confirmed") || m.includes("not confirmed")) {
    return "Confirme d’abord ton e-mail (lien reçu à l’inscription).";
  }
  if (m.includes("user already registered") || m.includes("already been registered")) {
    return "Un compte existe déjà avec cet e-mail. Connecte-toi.";
  }
  if (m.includes("password")) {
    return message;
  }
  return message;
}

/** Connexion : démo locale d’abord, sinon Supabase Auth. */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResult> {
  const e = email.trim().toLowerCase();
  const p = password;

  if (e === DEMO_EMAIL.toLowerCase() && p === DEMO_PASSWORD) {
    const session = demoSession();
    writeLocalSession(session);
    setActiveUserScope(session.user.email, true);
    return { ok: true, session };
  }

  const config = getSupabaseConfig();
  if (!config.configured) {
    return {
      ok: false,
      error:
        "Identifiants incorrects. Utilisez le compte démo, ou configurez Supabase dans .env.local.",
      code: "supabase_required",
    };
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: e,
      password: p,
    });
    if (error) {
      const msg = frenchAuthError(error.message);
      return {
        ok: false,
        error: msg,
        code: isAccountMissingError(error.message) ? "account_missing" : undefined,
      };
    }
    const session = sessionFromSupabaseUser(data.user ?? {});
    if (!session) {
      return { ok: false, error: "Connexion Supabase sans e-mail utilisateur." };
    }
    writeLocalSession(null); // session portée par les cookies Supabase
    setActiveUserScope(session.user.email, false);
    return { ok: true, session };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Erreur Supabase",
    };
  }
}

export async function loginAsDemo(): Promise<LoginResult> {
  return loginWithPassword(DEMO_EMAIL, DEMO_PASSWORD);
}

/** Inscription Supabase + confirmation e-mail. */
export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<SignUpResult> {
  const e = email.trim().toLowerCase();
  const p = password;

  if (e === DEMO_EMAIL.toLowerCase()) {
    return {
      ok: false,
      error: "Cet e-mail est réservé au compte démo. Choisis-en un autre.",
    };
  }

  const policy = validatePassword(p);
  if (!policy.ok) {
    return {
      ok: false,
      error: `Mot de passe trop faible : ${policy.errors.join(", ")}.`,
      code: "weak_password",
    };
  }

  const config = getSupabaseConfig();
  if (!config.configured) {
    return {
      ok: false,
      error: "Configurez Supabase (NEXT_PUBLIC_SUPABASE_*) dans .env.local pour créer un compte.",
      code: "supabase_required",
    };
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: e,
      password: p,
      options: {
        emailRedirectTo: `${appOrigin()}/auth/callback`,
      },
    });
    if (error) {
      return { ok: false, error: frenchAuthError(error.message) };
    }

    // Identities vide = e-mail déjà enregistré (Supabase anti-énumération).
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return {
        ok: false,
        error: "Un compte existe déjà avec cet e-mail. Connecte-toi.",
      };
    }

    if (data.session && data.user) {
      const session = sessionFromSupabaseUser(data.user);
      if (session) {
        writeLocalSession(null);
        setActiveUserScope(session.user.email, false);
        return { ok: true, session, needsEmailConfirmation: false };
      }
    }

    // Compte créé, confirmation en attente — scope déjà posé pour un éventuel retour.
    setActiveUserScope(e, false);
    return { ok: true, needsEmailConfirmation: true, email: e };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur Supabase";

    // Cas réseau/DNS fréquents en dev : “Load failed”, “Failed to fetch”, “Network request failed”…
    // Au lieu de bloquer l’utilisateur, on crée un compte local (bucket user via localStorage).
    const isSupabaseNetworkFailure =
      /load failed|failed to fetch|network request failed|could not resolve host|eai_again|dns/i.test(
        msg,
      );

    if (isSupabaseNetworkFailure) {
      const session: Session = {
        user: {
          email: e,
          name: e.split("@")[0] || e,
          isDemo: false,
        },
        createdAt: new Date().toISOString(),
      };
      writeLocalSession(session);
      setActiveUserScope(e, false);
      return { ok: true, session, needsEmailConfirmation: false };
    }

    return {
      ok: false,
      error:
        msg === "Load failed"
          ? "Impossible d'atteindre Supabase (reseau/DNS). Verifie NEXT_PUBLIC_SUPABASE_URL et la connectivite, ou utilise le compte demo."
          : msg,
    };
  }
}

export async function resendConfirmationEmail(email: string): Promise<ResendResult> {
  const e = email.trim().toLowerCase();
  if (!e) return { ok: false, error: "Indique un e-mail." };

  const config = getSupabaseConfig();
  if (!config.configured) {
    return { ok: false, error: "Supabase non configuré." };
  }

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: e,
      options: {
        emailRedirectTo: `${appOrigin()}/auth/callback`,
      },
    });
    if (error) return { ok: false, error: frenchAuthError(error.message) };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Erreur Supabase",
    };
  }
}

export async function logout(): Promise<void> {
  writeLocalSession(null);
  clearActiveUserScope();
  if (!getSupabaseConfig().configured) return;
  try {
    const supabase = createClient();
    await supabase.auth.signOut();
  } catch {
    // ignore
  }
}

/** Restaure la session (démo localStorage ou Supabase cookies). */
export async function restoreSession(): Promise<Session | null> {
  const local = readLocalSession();
  if (local) {
    setActiveUserScope(local.user.email, local.user.isDemo);
    return local;
  }

  if (!getSupabaseConfig().configured) return null;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const session = sessionFromSupabaseUser(data.user ?? {});
    if (session) setActiveUserScope(session.user.email, false);
    return session;
  } catch {
    return null;
  }
}

export function authBackendLabel(): string {
  const { configured } = getSupabaseConfig();
  return configured ? "Supabase" : "Démo locale";
}
