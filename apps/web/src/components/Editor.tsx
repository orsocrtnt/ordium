"use client";

import { useEffect, useRef, useState } from "react";
import { assetLabel } from "@/lib/assets";
import { fmtMoney } from "@/lib/format";
import {
  monthsAgoIso,
  yesterdayIso,
  type EditorState,
  type ExtraBuyRow,
} from "@/lib/strategy";

interface EditorProps {
  state: EditorState;
  onChange: (next: EditorState | ((s: EditorState) => EditorState)) => void;
  /** Préféré : patch partiel sans state périmé. */
  onPatch?: (patch: Partial<EditorState>) => void;
  /** Noms complets des actifs (ticker → label). */
  assetNames?: Map<string, string>;
  /** Pour le raccourci « depuis 1er achat ». */
  firstTransactionDate?: string | null;
}

function Section({
  title,
  hint,
  children,
  enabled,
  onToggle,
  tone = "default",
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
  /** `advanced` = style grisé + badge. */
  tone?: "default" | "advanced";
}) {
  const active = enabled ?? true;
  const advanced = tone === "advanced";
  return (
    <div
      className={`rounded-xl border p-4 ${
        advanced
          ? "border-dashed border-zinc-300 bg-zinc-50/80"
          : "border-[var(--border)] bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`text-sm font-semibold ${
                advanced ? "text-zinc-600" : "text-[var(--text)]"
              }`}
            >
              {title}
            </h3>
            {advanced && (
              <span className="rounded bg-zinc-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Avancé
              </span>
            )}
          </div>
          {hint && (
            <p className={`mt-0.5 text-xs ${advanced ? "text-zinc-400" : "text-[var(--muted)]"}`}>
              {hint}
            </p>
          )}
        </div>
        {onToggle && (
          <button
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => onToggle(!active)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              active ? (advanced ? "bg-zinc-500" : "bg-[var(--accent)]") : "bg-zinc-200"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                active ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        )}
      </div>
      {(!onToggle || active) && children && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

/** Bloc repliable pour un sous-ensemble de curseurs « touchy » dans une section. */
function AdvancedNest({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-100/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="mt-0.5 text-zinc-400" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-600">{title}</span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              Paramètre avancé
            </span>
          </span>
          {summary && !open && (
            <span className="mt-0.5 block text-[11px] text-zinc-400">{summary}</span>
          )}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-zinc-200/80 px-3 py-3">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            À modifier seulement si tu maîtrises l’indicateur. Les valeurs par défaut conviennent
            dans la plupart des cas.
          </p>
          {children}
        </div>
      )}
    </div>
  );
}

/** Zone grisée regroupant toutes les options avancées, fermée par défaut. */
function AdvancedZone({
  activeCount,
  children,
}: {
  activeCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-100/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-zinc-100"
        aria-expanded={open}
      >
        <span className="text-zinc-400" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-zinc-600">Paramètres avancés</span>
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Expert
            </span>
            {activeCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                {activeCount} actif{activeCount > 1 ? "s" : ""}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[11px] text-zinc-400">
            Indicateurs techniques, paliers, volatilité, frais — seulement si tu les connais bien.
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-zinc-200 px-3 py-3 sm:px-4">
          <p className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900/80">
            Ces réglages changent fortement le comportement de la stratégie. Si tu n’es pas sûr,
            laisse les valeurs par défaut ou désactive le module.
          </p>
          {children}
        </div>
      )}
    </div>
  );
}

function clamp(n: number, min?: number, max?: number): number {
  let v = n;
  if (min != null && Number.isFinite(min)) v = Math.max(min, v);
  if (max != null && Number.isFinite(max)) v = Math.min(max, v);
  return v;
}

function roundToStep(n: number, step: number): number {
  if (!(step > 0)) return n;
  const decimals = Math.min(6, (String(step).split(".")[1] ?? "").length);
  const rounded = Math.round(n / step) * step;
  return Number(rounded.toFixed(decimals));
}

function formatNum(n: number, step: number): string {
  const decimals = Math.min(4, (String(step).split(".")[1] ?? "").length);
  if (decimals === 0) return String(Math.round(n));
  const s = n.toFixed(decimals);
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * Curseur + champ : valeur locale pendant le drag / la frappe,
 * commit parent au relâchement ou au blur — évite les sauts et le jank.
 */
function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  const [local, setLocal] = useState(value);
  const [text, setText] = useState(() => formatNum(value, step));
  const [focused, setFocused] = useState(false);
  const dragging = useRef(false);
  const localRef = useRef(local);
  localRef.current = local;

  useEffect(() => {
    if (dragging.current || focused) return;
    setLocal(value);
    setText(formatNum(value, step));
  }, [value, step, focused]);

  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) {
      setLocal(value);
      setText(formatNum(value, step));
      return;
    }
    const next = roundToStep(clamp(raw, min, max), step);
    setLocal(next);
    setText(formatNum(next, step));
    if (next !== value) onChange(next);
  };

  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    commit(localRef.current);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <span className="min-w-0 truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            value={focused ? text : formatNum(local, step)}
            onFocus={() => {
              setFocused(true);
              setText(formatNum(local, step));
            }}
            onChange={(e) => {
              const t = e.target.value.replace(",", ".");
              if (t !== "" && !/^-?\d*\.?\d*$/.test(t)) return;
              setText(t);
              const n = Number(t);
              if (t !== "" && t !== "-" && t !== "." && Number.isFinite(n)) {
                setLocal(clamp(n, min, max));
              }
            }}
            onBlur={() => {
              setFocused(false);
              commit(text === "" || text === "-" || text === "." ? value : Number(text));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-[4.25rem] rounded-md border border-[var(--border)] bg-white px-2 py-1 text-right text-sm tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]"
            aria-label={label}
          />
          {suffix && <span className="w-4 text-[var(--muted)]">{suffix}</span>}
        </span>
      </div>
      <input
        type="range"
        className="ord-range"
        min={min}
        max={max}
        step={step}
        value={clamp(local, min, max)}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onChange={(e) => {
          const v = Number(e.target.value);
          localRef.current = v;
          setLocal(v);
          setText(formatNum(v, step));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        aria-label={label}
      />
    </div>
  );
}

/** Champ nombre seul (budget, etc.) — brouillon local, pas de saut à 0 en cours de frappe. */
function NumField({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const [text, setText] = useState(() => formatNum(value, step));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatNum(value, step));
  }, [value, step, focused]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={focused ? text : formatNum(value, step)}
      onFocus={() => {
        setFocused(true);
        setText(formatNum(value, step));
      }}
      onChange={(e) => {
        const t = e.target.value.replace(",", ".");
        if (t !== "" && !/^-?\d*\.?\d*$/.test(t)) return;
        setText(t);
      }}
      onBlur={() => {
        setFocused(false);
        const n = Number(text);
        if (text === "" || !Number.isFinite(n)) {
          setText(formatNum(value, step));
          return;
        }
        const next = roundToStep(clamp(n, min, max), step);
        setText(formatNum(next, step));
        if (next !== value) onChange(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={className}
    />
  );
}

const inputCls =
  "rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]";

export function Editor({
  state,
  onChange,
  onPatch,
  assetNames,
  firstTransactionDate = null,
}: EditorProps) {
  const regimeReferenceAsset =
    typeof state.regimeReferenceAsset === "string" ? state.regimeReferenceAsset : "";
  const set = (patch: Partial<EditorState>) => {
    if (onPatch) onPatch(patch);
    else onChange((s) => ({ ...s, ...patch }));
  };
  const windowMax = state.period === "weekly" ? 7 : 31;
  const dayLabel = (d: number) =>
    state.period === "weekly"
      ? ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][d - 1]
      : `le ${d}`;
  const periodWord = state.period === "weekly" ? "semaine" : "mois";

  const monthlyRows = state.allocation
    .filter((a) => a.pct > 0)
    .map((row) => ({
      asset: row.asset,
      label: assetLabel(row.asset, assetNames),
      pct: row.pct,
      amount: (state.budgetAmount * row.pct) / 100,
    }));

  return (
    <div className="space-y-3">
      <Section
        title="Période de simulation"
        hint="Horizon du backtest. Le budget périodique reste le même — allonger la période augmente le total versé."
      >
        <label className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
          <span>Commencer le</span>
          <input
            type="date"
            value={state.from}
            max={state.to}
            onChange={(e) => set({ from: e.target.value, horizon: "custom" })}
            className={inputCls}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
          <span>Jusqu&apos;au</span>
          <input
            type="date"
            value={state.to}
            min={state.from}
            onChange={(e) => set({ to: e.target.value, horizon: null })}
            className={inputCls}
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              [12, "1 an", "1y" as const],
              [36, "3 ans", "3y" as const],
            ] as const
          ).map(([months, label, horizon]) => {
            const from = monthsAgoIso(months);
            const active = state.horizon === horizon || (!state.horizon && state.from === from);
            return (
              <button
                key={months}
                type="button"
                onClick={() => set({ from, to: yesterdayIso(), horizon })}
                className={`rounded-md px-2 py-1 text-[11px] ${
                  active
                    ? "bg-[var(--text)] text-white"
                    : "border border-[var(--border)] text-[var(--muted)] hover:bg-zinc-50"
                }`}
              >
                {label}
              </button>
            );
          })}
          {firstTransactionDate && (
            <button
              type="button"
              onClick={() =>
                set({
                  from: firstTransactionDate.slice(0, 10),
                  to: yesterdayIso(),
                  horizon: "since_first_buy",
                })
              }
              className={`rounded-md px-2 py-1 text-[11px] ${
                state.horizon === "since_first_buy"
                  ? "bg-[var(--text)] text-white"
                  : "border border-[var(--border)] text-[var(--muted)] hover:bg-zinc-50"
              }`}
            >
              Depuis 1er achat
            </button>
          )}
        </div>
      </Section>

      <Section
        title="Budget déclaré"
        hint={`Montant versé chaque ${periodWord}. Ce montant est celui du backtest — il n’est plus calé sur le portefeuille.`}
      >
        <div className="flex items-center gap-2">
          <NumField
            min={10}
            step={10}
            value={state.budgetAmount}
            onChange={(v) => set({ budgetAmount: v })}
            className={`${inputCls} w-24 text-right tabular-nums`}
          />
          <select
            value={state.currency}
            onChange={(e) => set({ currency: e.target.value })}
            className={inputCls}
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </select>
          <select
            value={state.period}
            onChange={(e) => {
              const period = e.target.value as EditorState["period"];
              set({
                period,
                windowFrom: 1,
                windowTo: period === "weekly" ? 3 : 7,
              });
            }}
            className={inputCls}
          >
            <option value="monthly">par mois</option>
            <option value="weekly">par semaine</option>
          </select>
        </div>

        {monthlyRows.length > 0 && (
          <ul className="mt-1 max-h-56 space-y-1.5 overflow-y-auto border-t border-zinc-100 pt-3">
            {monthlyRows.map((row) => (
              <li
                key={row.asset}
                className="flex items-baseline justify-between gap-3 text-xs text-[var(--muted)]"
              >
                <span className="min-w-0 truncate text-[var(--text)]" title={row.label}>
                  {row.label}
                </span>
                <span className="shrink-0 tabular-nums text-[var(--text)]">
                  {fmtMoney(row.amount, state.currency, 0)}
                  <span className="ml-1.5 text-zinc-400">{row.pct} %</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Fenêtre d'investissement"
        hint="Le moteur choisit le moment conforme à vos règles dans cette fenêtre"
      >
        <div className="flex items-center gap-2 text-sm text-[var(--text)]">
          <span className="text-xs text-[var(--muted)]">de</span>
          <select
            value={state.windowFrom}
            onChange={(e) => {
              const windowFrom = Number(e.target.value);
              set({
                windowFrom,
                windowTo: Math.max(windowFrom, state.windowTo),
              });
            }}
            className={inputCls}
          >
            {Array.from({ length: windowMax }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--muted)]">à</span>
          <select
            value={state.windowTo}
            onChange={(e) => set({ windowTo: Number(e.target.value) })}
            className={inputCls}
          >
            {Array.from({ length: windowMax }, (_, i) => i + 1)
              .filter((d) => d >= state.windowFrom)
              .map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
          </select>
        </div>
      </Section>

      <Section title="Fractionnement" hint="Divise chaque budget en plusieurs achats">
        <SliderField
          label="Nombre d'achats"
          value={state.tranches}
          min={1}
          max={30}
          step={1}
          onChange={(v) => set({ tranches: v })}
        />
        <AdvancedNest
          title="Répartition des montants"
          summary={state.distribution === "random" ? "aléatoire" : "fixe (égale)"}
        >
          <label className="flex items-center justify-between gap-3 text-xs text-zinc-500">
            <span>Mode</span>
            <select
              value={state.distribution}
              onChange={(e) =>
                set({ distribution: e.target.value as EditorState["distribution"] })
              }
              className={inputCls}
            >
              <option value="equal">fixe (égale)</option>
              <option value="random">aléatoire</option>
            </select>
          </label>
        </AdvancedNest>
      </Section>

      <Section
        title="Gestion du marché"
        hint="Réduit le budget en hausse, l’augmente en baisse — selon la tendance."
        enabled={state.regimeEnabled}
        onToggle={(v) => set({ regimeEnabled: v })}
      >
        <p className="rounded-lg border border-[var(--border)] bg-[var(--accent-soft)]/60 px-3 py-2 text-[11px] leading-relaxed text-[var(--accent)]">
          Tendance mesurée sur le{" "}
          <span className="font-medium">MSCI World</span>
          {" — "}le marché actions mondial pour ton portefeuille. Tu peux choisir un autre
          indice de référence à la création.
        </p>
        <SliderField
          label="Marché haussier : multiplier par"
          value={state.bullMult}
          min={0}
          max={5}
          step={0.05}
          suffix="×"
          onChange={(v) => set({ bullMult: v })}
        />
        <SliderField
          label="Marché baissier : multiplier par"
          value={state.bearMult}
          min={0}
          max={5}
          step={0.05}
          suffix="×"
          onChange={(v) => set({ bearMult: v })}
        />
        <AdvancedNest
          title="Définir haussier / baissier / neutre"
          summary={`${
            regimeReferenceAsset.trim()
              ? regimeReferenceAsset === "IWDA.AS"
                ? "MSCI World"
                : regimeReferenceAsset
              : "plus gros poids"
          } · SMA ${state.regimeSmaPeriod}j · ±${state.regimeBandPct}%`}
        >
          <label className="flex items-center justify-between gap-3 text-xs text-zinc-500">
            <span>Indice / actif de référence</span>
            <select
              value={regimeReferenceAsset}
              onChange={(e) => set({ regimeReferenceAsset: e.target.value })}
              className={inputCls}
            >
              <option value="IWDA.AS">MSCI World (IWDA) — défaut</option>
              <option value="CSPX.L">S&amp;P 500 (CSPX)</option>
              <option value="">Plus gros poids de l’allocation</option>
              {state.allocation
                .filter(
                  (a) =>
                    a.pct > 0 &&
                    a.asset !== "IWDA.AS" &&
                    a.asset !== "IWDA" &&
                    a.asset !== "CSPX.L",
                )
                .map((a) => (
                  <option key={a.asset} value={a.asset}>
                    {assetLabel(a.asset, assetNames)}
                  </option>
                ))}
            </select>
          </label>
          <p className="text-[11px] text-zinc-500">
            Change l’indice de référence ici si tu veux juger la tendance sur autre chose que le
            MSCI World.
          </p>
          <SliderField
            label="Période SMA (jours)"
            value={state.regimeSmaPeriod}
            min={20}
            max={400}
            step={5}
            suffix="j"
            onChange={(v) => set({ regimeSmaPeriod: v })}
          />
          <SliderField
            label="Bande neutre autour de la SMA"
            value={state.regimeBandPct}
            min={0}
            max={15}
            step={0.5}
            suffix="%"
            onChange={(v) => set({ regimeBandPct: v })}
          />
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Haussier si prix &gt; SMA × (1 + bande/100). Baissier si prix &lt; SMA × (1 − bande/100).
            Sinon neutre.
          </p>
          <SliderField
            label="Marché neutre : multiplier par"
            value={state.neutralMult}
            min={0}
            max={5}
            step={0.05}
            suffix="×"
            onChange={(v) => set({ neutralMult: v })}
          />
        </AdvancedNest>
      </Section>

      <Section
        title="Acheter les baisses"
        hint="Déclenche un achat si le prix baisse dans la fenêtre"
        enabled={state.dipEnabled}
        onToggle={(v) => set({ dipEnabled: v })}
      >
        <SliderField
          label="Baisse déclenchante"
          value={state.dipPct}
          min={0.5}
          max={50}
          step={0.5}
          suffix="%"
          onChange={(v) => set({ dipPct: v })}
        />
      </Section>

      <Section
        title="Privilégier un RSI faible"
        hint="Déclenche un achat quand le RSI passe sous le seuil (clôtures journalières)"
        enabled={state.rsiEnabled}
        onToggle={(v) => set({ rsiEnabled: v })}
      >
        <SliderField
          label="Seuil RSI"
          value={state.rsiValue}
          min={1}
          max={99}
          step={1}
          onChange={(v) => set({ rsiValue: v })}
        />
      </Section>

      <Section
        title="Éviter les nouveaux sommets"
        hint="Ne pas acheter le jour d'un nouveau plus haut"
        enabled={state.athEnabled}
        onToggle={(v) => set({ athEnabled: v })}
      >
        <SliderField
          label="Période d'observation"
          value={state.athLookback}
          min={5}
          max={400}
          step={1}
          suffix="j"
          onChange={(v) => set({ athLookback: v })}
        />
      </Section>

      <Section
        title="Réserve de liquidités"
        hint="Toujours conserver un minimum de cash"
        enabled={state.reserveEnabled}
        onToggle={(v) => set({ reserveEnabled: v })}
      >
        <SliderField
          label="Réserve minimale"
          value={state.reservePct}
          min={0}
          max={90}
          step={1}
          suffix="%"
          onChange={(v) => set({ reservePct: v })}
        />
      </Section>

      <AdvancedZone
        activeCount={
          [
            state.fearGreedEnabled,
            state.macdEnabled,
            state.bollingerEnabled,
            state.smaBuyEnabled,
            state.ddTiersEnabled,
            state.riseTiersEnabled,
            state.volEnabled,
            state.extraBuysEnabled,
            state.feePct !== 0.1,
          ].filter(Boolean).length
        }
      >
        <Section
          tone="advanced"
          title="Fear & Greed (crypto)"
          hint="Index Alternative.me 0–100. Ex. ≤ 25 = Extreme Fear"
          enabled={state.fearGreedEnabled}
          onToggle={(v) => set({ fearGreedEnabled: v })}
        >
          <SliderField
            label="Acheter si Fear & Greed ≤"
            value={state.fearGreedValue}
            min={0}
            max={100}
            step={1}
            onChange={(v) => set({ fearGreedValue: v })}
          />
        </Section>

        <Section
          tone="advanced"
          title="MACD positif"
          hint="Acheter quand l’histogramme MACD (12/26/9) est > 0"
          enabled={state.macdEnabled}
          onToggle={(v) => set({ macdEnabled: v })}
        />

        <Section
          tone="advanced"
          title="Bollinger — bande basse"
          hint="%B bas = prix près de la bande inférieure"
          enabled={state.bollingerEnabled}
          onToggle={(v) => set({ bollingerEnabled: v })}
        >
          <SliderField
            label="Seuil %B"
            value={state.bollingerPctB}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => set({ bollingerPctB: v })}
          />
        </Section>

        <Section
          tone="advanced"
          title="Prix sous SMA"
          hint="Acheter si le prix de clôture est sous la moyenne mobile"
          enabled={state.smaBuyEnabled}
          onToggle={(v) => set({ smaBuyEnabled: v })}
        >
          <SliderField
            label="Période SMA"
            value={state.smaBuyPeriod}
            min={5}
            max={400}
            step={1}
            onChange={(v) => set({ smaBuyPeriod: v })}
          />
        </Section>

        <Section
          tone="advanced"
          title="Paliers de drawdown"
          hint="Multiplie le budget selon la baisse depuis le plus haut (paliers exclusifs)"
          enabled={state.ddTiersEnabled}
          onToggle={(v) => set({ ddTiersEnabled: v })}
        >
          <SliderField
            label="Lookback"
            value={state.tierLookback}
            min={30}
            max={1000}
            step={5}
            suffix="j"
            onChange={(v) => set({ tierLookback: v })}
          />
          {state.ddTiers.map((tier, i) => (
            <div
              key={`dd-${i}`}
              className="space-y-2 rounded-lg border border-zinc-200 bg-white/70 px-2 py-2"
            >
              <SliderField
                label={`Palier ${i + 1} — baisse ≥`}
                value={tier.gtePct}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(gtePct) => {
                  onChange((s) => ({
                    ...s,
                    ddTiers: s.ddTiers.map((t, j) => (j === i ? { ...t, gtePct } : t)),
                  }));
                }}
              />
              <SliderField
                label="Multiplicateur"
                value={tier.factor}
                min={0}
                max={5}
                step={0.05}
                suffix="×"
                onChange={(factor) => {
                  onChange((s) => ({
                    ...s,
                    ddTiers: s.ddTiers.map((t, j) => (j === i ? { ...t, factor } : t)),
                  }));
                }}
              />
            </div>
          ))}
        </Section>

        <Section
          tone="advanced"
          title="Paliers de hausse"
          hint="Réduit typiquement le budget après une remontée depuis le plus bas"
          enabled={state.riseTiersEnabled}
          onToggle={(v) => set({ riseTiersEnabled: v })}
        >
          {state.riseTiers.map((tier, i) => (
            <div
              key={`rise-${i}`}
              className="space-y-2 rounded-lg border border-zinc-200 bg-white/70 px-2 py-2"
            >
              <SliderField
                label={`Palier ${i + 1} — hausse ≥`}
                value={tier.gtePct}
                min={0}
                max={500}
                step={1}
                suffix="%"
                onChange={(gtePct) => {
                  onChange((s) => ({
                    ...s,
                    riseTiers: s.riseTiers.map((t, j) => (j === i ? { ...t, gtePct } : t)),
                  }));
                }}
              />
              <SliderField
                label="Multiplicateur"
                value={tier.factor}
                min={0}
                max={5}
                step={0.05}
                suffix="×"
                onChange={(factor) => {
                  onChange((s) => ({
                    ...s,
                    riseTiers: s.riseTiers.map((t, j) => (j === i ? { ...t, factor } : t)),
                  }));
                }}
              />
            </div>
          ))}
        </Section>

        <Section
          tone="advanced"
          title="Volatilité"
          hint="Bloque ou réduit les achats si la vol réalisée annualisée dépasse le seuil"
          enabled={state.volEnabled}
          onToggle={(v) => set({ volEnabled: v })}
        >
          <SliderField
            label="Période"
            value={state.volPeriod}
            min={5}
            max={120}
            step={1}
            suffix="j"
            onChange={(v) => set({ volPeriod: v })}
          />
          <SliderField
            label="Seuil vol. annualisée"
            value={state.volMaxPct}
            min={5}
            max={500}
            step={1}
            suffix="%"
            onChange={(v) => set({ volMaxPct: v })}
          />
          <label className="flex items-center justify-between gap-3 text-xs text-zinc-500">
            <span>Mode</span>
            <select
              value={state.volMode}
              onChange={(e) => set({ volMode: e.target.value as EditorState["volMode"] })}
              className={inputCls}
            >
              <option value="veto">bloquer l&apos;achat</option>
              <option value="scale">réduire le budget</option>
            </select>
          </label>
          {state.volMode === "scale" && (
            <SliderField
              label="Multiplicateur si vol élevée"
              value={state.volScaleFactor}
              min={0}
              max={5}
              step={0.05}
              suffix="×"
              onChange={(v) => set({ volScaleFactor: v })}
            />
          )}
        </Section>

        <Section
          tone="advanced"
          title="Achats exceptionnels"
          hint="Achats hors DCA, répétés avec cooldown"
          enabled={state.extraBuysEnabled}
          onToggle={(v) => set({ extraBuysEnabled: v })}
        >
          {state.extraBuys.map((row, i) => (
            <div
              key={`extra-${i}`}
              className="space-y-2 rounded-lg border border-zinc-200 bg-white/70 px-2 py-2"
            >
              <label className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                <span>Déclencheur</span>
                <select
                  value={row.trigger}
                  onChange={(e) => {
                    const extraBuys = state.extraBuys.map((r, j) =>
                      j === i
                        ? { ...r, trigger: e.target.value as ExtraBuyRow["trigger"] }
                        : r,
                    );
                    set({ extraBuys });
                  }}
                  className={inputCls}
                >
                  <option value="rsi_below">RSI bas</option>
                  <option value="dip">Baisse dans la fenêtre</option>
                  <option value="fear_greed">Fear &amp; Greed bas</option>
                  <option value="macd">MACD &gt; 0</option>
                  <option value="bollinger">Bollinger %B bas</option>
                </select>
              </label>
              <SliderField
                label={
                  row.trigger === "rsi_below"
                    ? "Seuil RSI"
                    : row.trigger === "dip"
                      ? "Baisse %"
                      : row.trigger === "fear_greed"
                        ? "Seuil F&G"
                        : row.trigger === "bollinger"
                          ? "%B ×100"
                          : "Valeur"
                }
                value={row.value}
                min={0}
                max={100}
                step={1}
                onChange={(v) => {
                  onChange((s) => ({
                    ...s,
                    extraBuys: s.extraBuys.map((r, j) => (j === i ? { ...r, value: v } : r)),
                  }));
                }}
              />
              <SliderField
                label="% du budget"
                value={row.pctOfBudget}
                min={1}
                max={100}
                step={1}
                suffix="%"
                onChange={(v) => {
                  onChange((s) => ({
                    ...s,
                    extraBuys: s.extraBuys.map((r, j) =>
                      j === i ? { ...r, pctOfBudget: v } : r,
                    ),
                  }));
                }}
              />
              <SliderField
                label="Cooldown"
                value={row.cooldownDays}
                min={1}
                max={365}
                step={1}
                suffix="j"
                onChange={(v) => {
                  onChange((s) => ({
                    ...s,
                    extraBuys: s.extraBuys.map((r, j) =>
                      j === i ? { ...r, cooldownDays: v } : r,
                    ),
                  }));
                }}
              />
            </div>
          ))}
        </Section>

        <Section tone="advanced" title="Frais" hint="Appliqués à chaque achat simulé">
          <SliderField
            label="Frais de transaction"
            value={state.feePct}
            min={0}
            max={2}
            step={0.05}
            suffix="%"
            onChange={(v) => set({ feePct: v })}
          />
        </Section>
      </AdvancedZone>
    </div>
  );
}
