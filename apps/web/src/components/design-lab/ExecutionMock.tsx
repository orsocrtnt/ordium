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

export function ExecutionMock({ direction }: { direction: LabDirectionId }) {
  return (
    <div>
      <NavMock active="Exécution" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <div>
          <p className="lab-kicker">Exécution</p>
          <h1 className="lab-title">Paper · Binance Testnet</h1>
          <p className="lab-sub">Kill switch, allowlist, une stratégie live à la fois.</p>
        </div>
        <span className="lab-status-pill">
          <span className="lab-status-dot" />
          Paper connecté
        </span>
      </div>

      {direction === "signal" && (
        <div className="lab-kpi-row">
          <div className="lab-kpi">
            <div className="lab-kpi-label">Notional jour</div>
            <div className="lab-kpi-value">$420</div>
          </div>
          <div className="lab-kpi">
            <div className="lab-kpi-label">Limite</div>
            <div className="lab-kpi-value">$2 000</div>
          </div>
          <div className="lab-kpi">
            <div className="lab-kpi-label">Schedules</div>
            <div className="lab-kpi-value">1 on</div>
          </div>
        </div>
      )}

      <div className="lab-exec-grid">
        <div className="lab-card">
          <h4 style={{ fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--lab-muted)", marginBottom: "0.65rem" }}>
            Connexion
          </h4>
          <div className="lab-field">
            <label className="lab-label" htmlFor="lab-api-key">
              API Key
            </label>
            <input id="lab-api-key" className="lab-input" defaultValue="bn••••••••" readOnly />
          </div>
          <div className="lab-field">
            <label className="lab-label" htmlFor="lab-api-secret">
              Secret
            </label>
            <input id="lab-api-secret" className="lab-input" type="password" defaultValue="••••••••" readOnly />
          </div>
          <button type="button" className="lab-btn lab-btn-primary" style={{ marginTop: "0.85rem" }}>
            Enregistrer
          </button>
        </div>

        <div className="lab-card">
          <h4 style={{ fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--lab-muted)", marginBottom: "0.65rem" }}>
            Stratégie auto
          </h4>
          <div className="lab-rule">
            <span>Dip buyer · BTC</span>
            <span className="lab-toggle" data-on="true" aria-hidden />
          </div>
          <div className="lab-rule">
            <span>Kill switch</span>
            <span className="lab-toggle" data-on="false" aria-hidden />
          </div>
          <p style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--lab-muted)" }}>
            Intervalle 60 min · prochain run dans 12 min
          </p>
        </div>

        <div className="lab-card" style={direction === "signal" ? undefined : { gridColumn: "1 / -1" }}>
          <h4 style={{ fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--lab-muted)", marginBottom: "0.65rem" }}>
            Derniers ordres
          </h4>
          <table className="lab-table">
            <thead>
              <tr>
                <th>Heure</th>
                <th>Symbole</th>
                <th>Side</th>
                <th>Notional</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>14:02</td>
                <td>BTCUSDT</td>
                <td>BUY</td>
                <td>$120</td>
                <td>filled</td>
              </tr>
              <tr>
                <td>12:40</td>
                <td>ETHUSDT</td>
                <td>BUY</td>
                <td>$80</td>
                <td>filled</td>
              </tr>
              <tr>
                <td>09:15</td>
                <td>BTCUSDT</td>
                <td>BUY</td>
                <td>$50</td>
                <td>skipped</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="lab-foot">Maquette exécution — direction : {direction}</p>
    </div>
  );
}
