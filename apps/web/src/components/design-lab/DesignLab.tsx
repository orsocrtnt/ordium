"use client";

import { useMemo, useState } from "react";
import {
  DIRECTIONS,
  SCREENS,
  type LabDirectionId,
  type LabScreenId,
} from "./directions";
import { LoginMock } from "./LoginMock";
import { StartMock } from "./StartMock";
import { StrategyMock } from "./StrategyMock";
import { ExecutionMock } from "./ExecutionMock";

export function DesignLab() {
  const [dir, setDir] = useState<LabDirectionId>("current");
  const [screen, setScreen] = useState<LabScreenId>("start");
  const active = useMemo(() => DIRECTIONS.find((d) => d.id === dir)!, [dir]);

  return (
    <div className="lab-root" data-dir={dir}>
      <div className="lab-picker">
        <div className="lab-picker-row">
          <span className="lab-picker-label">Écran</span>
          <div className="lab-picker-inner" role="tablist" aria-label="Écrans">
            {SCREENS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={screen === s.id}
                className="lab-chip lab-chip-screen"
                data-active={screen === s.id}
                onClick={() => setScreen(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="lab-picker-row">
          <span className="lab-picker-label">Direction</span>
          <div className="lab-picker-inner" role="tablist" aria-label="Directions design">
            {DIRECTIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={dir === d.id}
                className="lab-chip"
                data-active={dir === d.id}
                onClick={() => setDir(d.id)}
              >
                {d.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lab-meta">
        <h2>{active.skill}</h2>
        <p>{active.summary}</p>
        <div className="lab-meta-tags">
          <span>{active.fonts}</span>
          <span>{active.colors}</span>
          <span>{active.motion}</span>
        </div>
      </div>

      <div className="lab-stage" data-screen={screen}>
        {screen === "login" && <LoginMock direction={dir} />}
        {screen === "start" && <StartMock direction={dir} />}
        {screen === "strategy" && <StrategyMock direction={dir} />}
        {screen === "execution" && <ExecutionMock direction={dir} />}
      </div>
    </div>
  );
}
