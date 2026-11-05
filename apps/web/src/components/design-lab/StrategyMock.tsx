"use client";

import type { LabDirectionId } from "./directions";

function NavMock({ active }: { active: string }) {
  return (
    <div className="lab-nav-mock" aria-hidden>
      {["Parcours", "Marchés", "Stratégie", "Exécution"].map((label) => (
        <span key={label} data-active={label === active}>
          {label}
        </span>
      ))}
    </div>
  );
}

export function StrategyMock({ direction }: { direction: LabDirectionId }) {
  return (
    <div>
      <NavMock active="Stratégie" />
      <p className="lab-kicker">Builder</p>
      <h1 className="lab-title">Définir une stratégie</h1>
      <p className="lab-sub">Prompt + règles + backtest — maquette lab, sans moteur.</p>

      <div className="lab-strategy" style={{ marginTop: "1.25rem" }}>
        <div className="lab-card lab-strategy-side">
          <h4>Stratégies</h4>
          <div className="lab-strat-item" data-active="true">
            Dip buyer · BTC
          </div>
          <div className="lab-strat-item">Fear & Greed DCA</div>
          <div className="lab-strat-item">+ Nouvelle</div>
        </div>

        <div className="lab-card lab-strategy-chat" style={{ display: "flex", flexDirection: "column" }}>
          <h4>Chat</h4>
          <div className="lab-chat-bubble lab-chat-user">
            Achète plus quand Fear & Greed ≤ 35, fenêtre 7 jours.
          </div>
          <div className="lab-chat-bubble lab-chat-bot">
            J’ai drafté 3 règles. Coche celles à exécuter, puis lance un backtest.
          </div>
          <div className="lab-chat-input-row">
            <input className="lab-input" defaultValue="Affiner le sizing…" readOnly />
            <button type="button" className="lab-btn lab-btn-primary">
              Envoyer
            </button>
          </div>
        </div>

        <div className="lab-card lab-strategy-rules">
          <h4>Règles</h4>
          <div className="lab-rule">
            <span>Fear & Greed ≤ 35 → ×2</span>
            <span className="lab-toggle" data-on="true" aria-hidden />
          </div>
          <div className="lab-rule">
            <span>Fenêtre · jours 1–7</span>
            <span className="lab-toggle" data-on="true" aria-hidden />
          </div>
          <div className="lab-rule">
            <span>Monthly · 500 EUR</span>
            <span className="lab-toggle" data-on="false" aria-hidden />
          </div>
          <button type="button" className="lab-btn lab-btn-primary lab-btn-block" style={{ marginTop: "0.85rem" }}>
            Backtester
          </button>
        </div>
      </div>
      <p className="lab-foot">Maquette stratégie — direction : {direction}</p>
    </div>
  );
}
