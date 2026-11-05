"use client";

import { useState } from "react";
import type { LabDirectionId } from "./directions";

export function LoginMock({ direction }: { direction: LabDirectionId }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  return (
    <div className="lab-login" key={`${direction}-${mode}`}>
      <p className="lab-kicker">{mode === "signup" ? "Inscription" : "Connexion"}</p>
      <h1 className="lab-title">
        {mode === "signup" ? "Créer un compte Ordium" : "Entrez dans Ordium"}
      </h1>
      <p className="lab-sub">
        {mode === "signup"
          ? "Mot de passe solide requis. Confirmation e-mail avant l’app."
          : "Compte démo pour explorer, ou ton compte Supabase."}
      </p>

      <div className="lab-card">
        <form onSubmit={(e) => e.preventDefault()}>
          <div className="lab-field">
            <label className="lab-label" htmlFor={`lab-email-${direction}`}>
              E-mail
            </label>
            <input
              id={`lab-email-${direction}`}
              className="lab-input"
              type="email"
              defaultValue="demo@ordium.app"
            />
          </div>
          <div className="lab-field">
            <label className="lab-label" htmlFor={`lab-password-${direction}`}>
              Mot de passe
            </label>
            <input
              id={`lab-password-${direction}`}
              className="lab-input"
              type="password"
              defaultValue="••••••••••"
            />
          </div>
          <button type="submit" className="lab-btn lab-btn-primary lab-btn-block">
            {mode === "signup" ? "Créer mon compte" : "Continuer"}
          </button>
        </form>

        <p className="lab-switch">
          {mode === "signup" ? (
            <>
              Déjà un compte ?{" "}
              <button type="button" className="lab-link" onClick={() => setMode("signin")}>
                Se connecter
              </button>
            </>
          ) : (
            <>
              Pas encore de compte ?{" "}
              <button type="button" className="lab-link" onClick={() => setMode("signup")}>
                Créer un compte
              </button>
            </>
          )}
        </p>

        {mode === "signin" && (
          <button type="button" className="lab-btn lab-btn-ghost lab-btn-block">
            Entrer avec le compte démo
          </button>
        )}

        <div className="lab-foot">Maquette — direction : {direction}</div>
      </div>
    </div>
  );
}
