/**
 * Landing cinématique — scènes sticky « What Ordium can do ».
 */

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Scene = {
  id: string;
  kicker: string;
  title: string;
  body: string;
};

const SCENES: Scene[] = [
  {
    id: "import",
    kicker: "01 — Positions",
    title: "Import your holdings. No API yet.",
    body: "CSV, Excel, PDF, or a screenshot. Ordium extracts the lines — you confirm before anything runs.",
  },
  {
    id: "rules",
    kicker: "02 — Strategy",
    title: "Write the rules. In plain language.",
    body: "Dips, RSI, Fear & Greed, windows. Chat drafts the checklist — you tick what actually executes.",
  },
  {
    id: "backtest",
    kicker: "03 — Proof",
    title: "See if it would have held.",
    body: "Backtest on your real history. Same rules, same fees — conviction before automation.",
  },
  {
    id: "control",
    kicker: "04 — Control",
    title: "Paper first. Live when you’re ready.",
    body: "Kill switch, allowlists, one strategy live at a time. Automation stays on a leash.",
  },
  {
    id: "broker",
    kicker: "05 — Last mile",
    title: "Broker last — not first.",
    body: "Connect Alpaca or Binance only when the path is clear. Turn conviction into execution.",
  },
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Progress 0→1 for a sticky cinema track. */
function useCinemaProgress(trackRef: React.RefObject<HTMLElement | null>): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      setP(total > 0 ? scrolled / total : 0);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [trackRef]);
  return p;
}

function SceneVisual({ sceneId, active }: { sceneId: string; active: boolean }) {
  return (
    <div
      className={`landing-visual ${active ? "is-active" : ""}`}
      data-scene={sceneId}
      aria-hidden
    >
      {sceneId === "import" && (
        <div className="lv-import">
          <div className="lv-file">
            <span>portfolio.xlsx</span>
          </div>
          <div className="lv-rows">
            {["BTC · 0.42", "ETH · 3.1", "GOOGL · 12"].map((row, i) => (
              <div key={row} className="lv-row" style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
                {row}
              </div>
            ))}
          </div>
        </div>
      )}
      {sceneId === "rules" && (
        <div className="lv-rules">
          <div className="lv-chat">“Buy more when Fear & Greed ≤ 35…”</div>
          <ul className="lv-bullets">
            <li>Fear & Greed ≤ 35 → ×2</li>
            <li>Window · days 1–7</li>
            <li>Monthly · 500 EUR</li>
          </ul>
        </div>
      )}
      {sceneId === "backtest" && (
        <div className="lv-chart">
          <svg viewBox="0 0 320 160" className="lv-svg">
            <path
              className="lv-path"
              d="M8 120 C 40 118, 55 90, 80 95 S 120 40, 150 55 S 200 20, 240 35 S 280 10, 312 28"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              className="lv-path-soft"
              d="M8 130 C 50 128, 90 110, 140 115 S 220 90, 312 98"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.35"
            />
          </svg>
          <div className="lv-metric">
            <span>Max DD</span>
            <strong>−18.4%</strong>
          </div>
        </div>
      )}
      {sceneId === "control" && (
        <div className="lv-control">
          <div className="lv-toggle">
            <span className="on">Paper</span>
            <span className="off">Live</span>
          </div>
          <div className="lv-kill">Kill switch · armed</div>
        </div>
      )}
      {sceneId === "broker" && (
        <ol className="lv-steps">
          {["Positions", "Markets", "Strategy", "Broker"].map((label, i) => (
            <li key={label} style={{ animationDelay: `${0.1 + i * 0.1}s` }}>
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              {label}
              {i < 3 ? <span className="check">✓</span> : <span className="pending">→</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function LandingCinema() {
  const reduced = usePrefersReducedMotion();
  const trackRef = useRef<HTMLElement>(null);
  const progress = useCinemaProgress(trackRef);
  const sceneIndex = Math.min(
    SCENES.length - 1,
    Math.floor(progress * SCENES.length + 1e-6),
  );
  const active = SCENES[sceneIndex]!;

  if (reduced) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          What Ordium can do
        </p>
        <div className="mt-10 space-y-12">
          {SCENES.map((s) => (
            <div key={s.id} className="grid gap-6 sm:grid-cols-2 sm:items-center">
              <div>
                <p className="text-xs font-medium text-[var(--muted)]">{s.kicker}</p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-[var(--text)]">
                  {s.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{s.body}</p>
              </div>
              <SceneVisual sceneId={s.id} active />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={trackRef}
      className="landing-cinema"
      style={{ height: `${SCENES.length * 100}vh` }}
      aria-label="What Ordium can do"
    >
      <div className="landing-cinema-sticky">
        <div className="landing-cinema-inner">
          <div className="landing-cinema-copy">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--accent)]">
              What Ordium can do
            </p>
            <p className="mt-6 text-xs font-medium tabular-nums text-[var(--muted)]">
              {active.kicker}
            </p>
            <h2 className="mt-3 text-3xl font-semibold leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-[2.75rem]">
              {active.title}
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[var(--muted)] sm:text-base">
              {active.body}
            </p>
            <div className="mt-8 flex gap-2" aria-hidden>
              {SCENES.map((s, i) => (
                <span
                  key={s.id}
                  className={`landing-dot ${i === sceneIndex ? "is-on" : ""}`}
                />
              ))}
            </div>
          </div>
          <div className="landing-cinema-stage">
            {SCENES.map((s, i) => (
              <SceneVisual key={s.id} sceneId={s.id} active={i === sceneIndex} />
            ))}
          </div>
        </div>
        <div
          className="landing-progress"
          style={{ transform: `scaleX(${progress})` }}
          aria-hidden
        />
      </div>
    </section>
  );
}

export function LandingHero() {
  return (
    <section className="landing-hero relative overflow-hidden">
      <div className="landing-hero-bg" aria-hidden />
      <div className="landing-hero-chart" aria-hidden>
        <svg viewBox="0 0 800 420" preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(11,110,79,0.18)" />
              <stop offset="100%" stopColor="rgba(11,110,79,0)" />
            </linearGradient>
          </defs>
          <path
            className="landing-hero-area"
            d="M0 320 C 80 300, 140 260, 200 270 S 320 180, 400 200 S 520 120, 600 140 S 720 80, 800 95 L 800 420 L 0 420 Z"
            fill="url(#heroFill)"
          />
          <path
            className="landing-hero-line"
            d="M0 320 C 80 300, 140 260, 200 270 S 320 180, 400 200 S 520 120, 600 140 S 720 80, 800 95"
            fill="none"
            stroke="#0b6e4f"
            strokeWidth="2.25"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-4 pb-16 pt-28 sm:px-6 sm:pb-24 lg:justify-center lg:pb-0 lg:pt-16">
        <p className="landing-hero-brand text-[11px] font-medium uppercase tracking-[0.28em] text-[var(--accent)] sm:text-xs">
          Ordium
        </p>
        <h1 className="landing-hero-title mt-5 max-w-3xl text-4xl font-semibold leading-[1.02] tracking-tight text-[var(--text)] sm:text-5xl lg:text-[3.75rem]">
          What Ordium can do.
          <span className="mt-3 block text-[1.05em] font-medium text-[var(--muted)] sm:mt-4">
            Turn conviction into execution
          </span>
        </h1>
        <p className="landing-hero-sub mt-6 max-w-lg text-base leading-relaxed text-[var(--muted)] sm:text-[17px]">
          Import holdings, define buy rules, backtest on your history — then automate what held.
        </p>
        <div className="landing-hero-cta mt-10 flex flex-wrap gap-3">
          <Link href="/login?mode=signup" className="ord-btn ord-btn-primary">
            Create an account
          </Link>
          <Link href="/login" className="ord-btn ord-btn-ghost">
            Sign in / demo
          </Link>
        </div>
        <p className="landing-hero-scroll mt-14 hidden text-[11px] uppercase tracking-[0.2em] text-[var(--muted)] lg:block">
          Scroll
        </p>
      </div>
    </section>
  );
}

export function LandingClose() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-elevated)]">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">
          Not another dashboard.
        </h2>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--muted)] sm:text-base">
          Ordium starts from what you actually hold, tests your rules before they run, and puts
          the broker at the end — not the beginning.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/login?mode=signup" className="ord-btn ord-btn-primary">
            Start free
          </Link>
          <Link href="/login" className="ord-btn ord-btn-ghost">
            Try the demo
          </Link>
        </div>
      </div>
    </section>
  );
}
