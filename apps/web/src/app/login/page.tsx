"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/auth";
import { PASSWORD_RULES, validatePassword } from "@/lib/passwordPolicy";
import { getSupabaseConfig } from "@/lib/supabase";

type AuthMode = "signin" | "signup" | "check_email";

function LoginLoading() {
  return (
    <AppShell bare>
      <div className="flex min-h-[70vh] items-center justify-center">
        <p className="text-sm text-[var(--muted)]">Chargement…</p>
      </div>
    </AppShell>
  );
}

/** Connexion / inscription — après la page de présentation. */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, ready, login, loginDemo, signup, resendConfirmation, backend } = useAuth();

  const initialMode = (searchParams.get("mode") === "signup" ? "signup" : "signin") as AuthMode;
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState(initialMode === "signin" ? DEMO_EMAIL : "");
  const [password, setPassword] = useState(initialMode === "signin" ? DEMO_PASSWORD : "");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supabase = getSupabaseConfig();

  const passwordChecks = useMemo(() => validatePassword(password).checks, [password]);

  useEffect(() => {
    if (ready && session) router.replace("/start");
  }, [ready, session, router]);

  useEffect(() => {
    if (searchParams.get("error") === "confirm") {
      setError("Lien de confirmation invalide ou expiré. Demande un nouvel e-mail.");
      setMode("signin");
    }
  }, [searchParams]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    if (next === "signup") {
      setPassword("");
      setPasswordConfirm("");
      if (email === DEMO_EMAIL) setEmail("");
    } else if (next === "signin") {
      if (!email) {
        setEmail(DEMO_EMAIL);
        setPassword(DEMO_PASSWORD);
      }
    }
  };

  const submitSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await login(email, password);
    setBusy(false);
    if (!result.ok) {
      if (result.code === "account_missing") {
        setInfo(
          "Pas de compte avec ces identifiants. Tu peux en créer un — ton e-mail est déjà saisi.",
        );
        setPassword("");
        setPasswordConfirm("");
        setMode("signup");
        return;
      }
      setError(result.error);
      return;
    }
    router.push("/start");
  };

  const submitSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);

    if (password !== passwordConfirm) {
      setBusy(false);
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    const result = await signup(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.needsEmailConfirmation) {
      setPendingEmail(result.email);
      setMode("check_email");
      setPassword("");
      setPasswordConfirm("");
      return;
    }
    router.push("/start");
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await resendConfirmation(pendingEmail || email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInfo("E-mail de confirmation renvoyé.");
  };

  const demo = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await loginDemo();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push("/start");
  };

  if (!ready || session) {
    return <LoginLoading />;
  }

  return (
    <AppShell
      bare
      right={
        <Link href="/" className="hover:text-[var(--text)]">
          ← Présentation
        </Link>
      }
    >
      <div className="mx-auto flex min-h-[calc(100vh-57px)] max-w-md flex-col justify-center px-4 py-16 sm:px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          {mode === "signup" ? "Inscription" : mode === "check_email" ? "Confirmation" : "Connexion"}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
          {mode === "check_email"
            ? "Vérifie ta boîte mail"
            : mode === "signup"
              ? "Créer un compte Ordium"
              : "Entrez dans Ordium"}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {mode === "check_email"
            ? `Un lien de confirmation a été envoyé à ${pendingEmail || email}. Ouvre-le pour activer ton compte.`
            : mode === "signup"
              ? "Mot de passe solide requis. Tu confirmeras ton e-mail avant d’accéder à l’app."
              : "Compte démo pour explorer, ou ton compte Supabase."}
        </p>

        <div className="ord-card mt-8 p-6 sm:p-8">
          {mode === "check_email" ? (
            <div className="space-y-4">
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              {info && (
                <p className="rounded-lg border border-[var(--border)] bg-[#f7f7f4] px-3 py-2 text-sm text-[var(--text)]">
                  {info}
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void resend()}
                className="ord-btn ord-btn-primary w-full"
              >
                {busy ? "Envoi…" : "Renvoyer l’e-mail"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => switchMode("signin")}
                className="ord-btn ord-btn-ghost w-full"
              >
                Retour à la connexion
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => void (mode === "signup" ? submitSignUp(e) : submitSignIn(e))}
              className="space-y-4"
            >
              <div>
                <label className="ord-label" htmlFor="email">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="ord-input"
                />
              </div>
              <div>
                <label className="ord-label" htmlFor="password">
                  Mot de passe
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="ord-input"
                />
              </div>

              {mode === "signup" && (
                <>
                  <div>
                    <label className="ord-label" htmlFor="passwordConfirm">
                      Confirmer le mot de passe
                    </label>
                    <input
                      id="passwordConfirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      className="ord-input"
                    />
                  </div>
                  <ul className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[#fafaf8] px-3 py-3 text-xs text-[var(--muted)]">
                    {PASSWORD_RULES.map((rule) => {
                      const ok = passwordChecks[rule.id];
                      return (
                        <li
                          key={rule.id}
                          className={ok ? "text-[var(--accent)]" : undefined}
                        >
                          <span aria-hidden>{ok ? "✓" : "○"} </span>
                          {rule.label}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              {info && (
                <p className="rounded-lg border border-[var(--border)] bg-[#f7f7f4] px-3 py-2 text-sm text-[var(--text)]">
                  {info}
                </p>
              )}

              <button type="submit" disabled={busy} className="ord-btn ord-btn-primary w-full">
                {busy
                  ? mode === "signup"
                    ? "Création…"
                    : "Connexion…"
                  : mode === "signup"
                    ? "Créer mon compte"
                    : "Continuer"}
              </button>
            </form>
          )}

          {mode !== "check_email" && (
            <>
              <p className="mt-4 text-center text-sm text-[var(--muted)]">
                {mode === "signup" ? (
                  <>
                    Déjà un compte ?{" "}
                    <button
                      type="button"
                      className="font-medium text-[var(--accent)] hover:underline"
                      onClick={() => switchMode("signin")}
                    >
                      Se connecter
                    </button>
                  </>
                ) : (
                  <>
                    Pas encore de compte ?{" "}
                    <button
                      type="button"
                      className="font-medium text-[var(--accent)] hover:underline"
                      onClick={() => switchMode("signup")}
                    >
                      Créer un compte
                    </button>
                  </>
                )}
              </p>

              {mode === "signin" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void demo()}
                  className="ord-btn ord-btn-ghost mt-3 w-full"
                >
                  Entrer avec le compte démo
                </button>
              )}

              <div className="mt-6 space-y-2 border-t border-[var(--border)] pt-5 text-[11px] leading-relaxed text-[var(--muted)]">
                {mode === "signin" && (
                  <p>
                    Démo : <span className="text-[var(--text)]">{DEMO_EMAIL}</span> /{" "}
                    <span className="text-[var(--text)]">{DEMO_PASSWORD}</span>
                  </p>
                )}
                <p>
                  Backend : <span className="text-[var(--text)]">{backend}</span>
                  {supabase.configured
                    ? " — URL Supabase détectée."
                    : " — renseignez NEXT_PUBLIC_SUPABASE_* dans apps/web/.env.local."}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
