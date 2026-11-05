"use client";

import type { LabDirectionId } from "./directions";
import { START_STEPS } from "./directions";

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

function StepCard({
  step,
}: {
  step: (typeof START_STEPS)[number];
}) {
  return (
    <div className={`lab-card ${step.done ? "lab-card-done" : ""}`}>
      <div className="lab-step">
        <div className="lab-step-body">
          <span className={`lab-badge ${step.done ? "lab-badge-done" : ""}`}>
            {step.done ? "✓" : step.n}
          </span>
          <div>
            <p className="lab-step-meta">
              Étape {step.n}
              {step.done ? " · fait" : ""}
            </p>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        </div>
        <button type="button" className="lab-btn lab-btn-primary">
          {step.cta}
        </button>
      </div>
    </div>
  );
}

export function StartMock({ direction }: { direction: LabDirectionId }) {
  const intro = (
    <>
      <p className="lab-kicker">Parcours Ordium</p>
      <h1 className="lab-title">Conviction → exécution</h1>
      <p className="lab-sub">
        D’abord vos lignes et vos règles — sans friction API. La connexion broker arrive en dernier.
      </p>
    </>
  );

  if (direction === "rail") {
    return (
      <div>
        <NavMock active="Parcours" />
        {intro}
        <div className="lab-progress">
          <div className="lab-progress-bar">
            <div className="lab-progress-fill" />
          </div>
          <p className="lab-progress-label">Étape 1 sur 3 · Positions faites</p>
        </div>
        <div className="lab-start-wrap">
          <div className="lab-rail" aria-hidden>
            {START_STEPS.map((s, i) => (
              <div
                key={s.n}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: i < START_STEPS.length - 1 ? 1 : undefined }}
              >
                <span className={`lab-badge ${s.done ? "lab-badge-done" : ""}`}>
                  {s.done ? "✓" : s.n}
                </span>
                {i < START_STEPS.length - 1 && (
                  <div className="lab-rail-line" data-done={s.done} />
                )}
              </div>
            ))}
          </div>
          <div className="lab-start-list">
            {START_STEPS.map((s) => (
              <StepCard key={s.n} step={s} />
            ))}
          </div>
        </div>
        <p className="lab-foot">Maquette parcours — direction : rail</p>
      </div>
    );
  }

  return (
    <div>
      <NavMock active="Parcours" />
      {intro}

      {direction === "signal" && (
        <div className="lab-kpi-row">
          <div className="lab-kpi">
            <div className="lab-kpi-label">Positions</div>
            <div className="lab-kpi-value">12</div>
          </div>
          <div className="lab-kpi">
            <div className="lab-kpi-label">Stratégies</div>
            <div className="lab-kpi-value">1</div>
          </div>
          <div className="lab-kpi">
            <div className="lab-kpi-label">Paper</div>
            <div className="lab-kpi-value">Off</div>
          </div>
        </div>
      )}

      <div className="lab-start-list">
        {START_STEPS.map((s) => (
          <StepCard key={s.n} step={s} />
        ))}
      </div>
      <p className="lab-foot">Maquette parcours — direction : {direction}</p>
    </div>
  );
}
