"use client";

import type { Condition, LintIssue, Rule, RuleDocument } from "@ordium/engine";

function formatCondition(c: Condition | undefined): string {
  if (!c) return "toujours";
  if ("all" in c) return c.all.map(formatCondition).join(" ET ");
  if ("any" in c) return `(${c.any.map(formatCondition).join(" OU ")})`;
  if ("not" in c) return `NON(${formatCondition(c.not)})`;
  switch (c.type) {
    case "always":
      return "toujours";
    case "regime":
      return `régime = ${c.value}`;
    case "rsi":
      return `RSI(${c.period ?? 14}) ${c.op ?? "lte"} ${c.value}`;
    case "dip":
      return `baisse ≥ ${c.drop_pct} % vs ouverture`;
    case "new_ath":
      return `nouveau plus haut (${c.lookback_days} j)`;
    case "drawdown":
      return `drawdown ${c.op ?? "gte"} ${c.value} %`;
    case "rise":
      return `hausse ${c.op ?? "gte"} ${c.value} %`;
    case "volatility":
      return `vol(${c.period ?? 30}j) ${c.op ?? "gte"} ${c.value} %`;
    case "macd":
      return `MACD hist ${c.op ?? "gt"} ${c.value}`;
    case "bollinger":
      return `%B(${c.period ?? 20}) ${c.op ?? "lte"} ${c.value}`;
    case "price_vs_sma":
      return `prix ${c.op ?? "lt"} SMA(${c.period})`;
    case "fear_greed":
      return `Fear&Greed ${c.op ?? "lte"} ${c.value}`;
  }
}

function formatAction(rule: Rule): string {
  return rule.then
    .map((a) => {
      switch (a.action) {
        case "buy_tranche":
          return "acheter 1 tranche";
        case "buy_remaining":
          return "investir le reste (fallback)";
        case "scale_budget":
          return `budget × ${a.factor}`;
        case "veto_buy":
          return "bloquer l'achat";
        case "buy_extra":
          return `achat exceptionnel ${a.pct_of_budget} % du budget`;
      }
    })
    .join(", ");
}

const WHEN_LABEL: Record<string, string> = {
  window_open: "ouverture de fenêtre",
  tick: "chaque jour",
  window_end: "fin de fenêtre",
};

const SEVERITY_CLS: Record<string, string> = {
  error: "border-red-200 bg-red-50 text-red-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-zinc-200 bg-white text-zinc-600",
};

export function RulesPanel({
  rules,
  lint,
}: {
  rules: RuleDocument;
  lint: LintIssue[];
}) {
  const sorted = [...rules.rules].sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-4">
      {lint.length > 0 && (
        <div className="space-y-2">
          {lint.map((issue, i) => (
            <div
              key={`${issue.code}-${i}`}
              className={`rounded-lg border px-3 py-2 text-xs ${SEVERITY_CLS[issue.severity]}`}
            >
              <span className="font-semibold uppercase">{issue.severity}</span>
              <span className="mx-2 text-zinc-600">·</span>
              {issue.message}
              {issue.suggestion && (
                <p className="mt-1 opacity-80">→ {issue.suggestion}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-zinc-900">
          Moteur de règles
          <span className="ml-2 text-xs font-normal text-zinc-500">
            compilation v{rules.version} — {sorted.length} règle
            {sorted.length > 1 ? "s" : ""}
            {rules.constraints.length > 0 &&
              ` · ${rules.constraints.length} contrainte${rules.constraints.length > 1 ? "s" : ""}`}
          </span>
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          Votre formulaire est compilé en blocs universels (quand / si / alors). C'est ce document
          que le moteur exécute — et que le futur éditeur no-code ou le langage naturel produiront.
        </p>

        <div className="space-y-2">
          {sorted.map((rule) => (
            <div
              key={rule.id}
              className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-white px-3 py-2 text-xs"
            >
              <span className="text-zinc-600">quand</span>
              <span className="text-sky-400">{WHEN_LABEL[rule.when] ?? rule.when}</span>
              <span className="text-zinc-600">si</span>
              <span className="text-zinc-700">{formatCondition(rule.if)}</span>
              <span className="text-zinc-600">alors</span>
              <span className="text-emerald-700">{formatAction(rule)}</span>
              <span className="text-zinc-700 col-span-2 font-mono">{rule.id}</span>
            </div>
          ))}
        </div>

        {rules.constraints.length > 0 && (
          <div className="mt-3 border-t border-zinc-200 pt-3">
            <p className="mb-2 text-xs font-semibold text-zinc-600">Contraintes (inviolables)</p>
            {rules.constraints.map((c, i) => (
              <p key={i} className="text-xs text-zinc-700">
                {c.type === "min_cash_reserve_pct"
                  ? `Toujours conserver ≥ ${c.value} % de liquidités`
                  : `Dépense max par fenêtre : ${c.value}`}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
