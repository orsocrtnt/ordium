import type { BacktestResult } from "@ordium/engine";

function money(v: number, currency: string): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(v);
}

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} %`;
}

function row(label: string, a: string, b: string): string {
  return `  ${label.padEnd(26)}${a.padStart(16)}${b.padStart(18)}`;
}

const REGIME_LABEL: Record<string, string> = {
  bull: "haussier",
  neutral: "neutre",
  bear: "baissier",
};

export function printReport(
  result: BacktestResult,
  baseline: BacktestResult,
  currency: string,
): void {
  const lines: string[] = [];
  lines.push("");
  lines.push(`Backtest : ${result.strategyName}`);
  lines.push(`Période : ${result.from} → ${result.to}   Frais : ${result.feePct} %`);
  lines.push("");

  for (const w of result.warnings) lines.push(`  ⚠ ${w}`);
  if (result.warnings.length) lines.push("");

  lines.push(row("", "Stratégie", "DCA classique"));
  lines.push(row("Versé", money(result.contributed, currency), money(baseline.contributed, currency)));
  lines.push(row("Investi", money(result.invested, currency), money(baseline.invested, currency)));
  lines.push(row("Frais payés", money(result.fees, currency), money(baseline.fees, currency)));
  lines.push(row("Cash restant", money(result.cash, currency), money(baseline.cash, currency)));
  lines.push(row("Valeur des positions", money(result.holdingsValue, currency), money(baseline.holdingsValue, currency)));
  lines.push(row("Valeur totale", money(result.totalValue, currency), money(baseline.totalValue, currency)));
  lines.push(row("Performance (vs versé)", pct(result.roiPct), pct(baseline.roiPct)));
  lines.push(row("Drawdown max", `-${result.maxDrawdownPct.toFixed(1)} %`, `-${baseline.maxDrawdownPct.toFixed(1)} %`));
  lines.push(row("Nombre d'achats", String(result.purchases.length), String(baseline.purchases.length)));
  lines.push("");

  lines.push("  Prix moyen d'acquisition :");
  for (const a of result.perAsset) {
    const b = baseline.perAsset.find((x) => x.asset === a.asset);
    const fmt = (v: number | null) =>
      v == null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v);
    lines.push(row(`  ${a.asset}`, fmt(a.avgCost), fmt(b?.avgCost ?? null)));
  }
  lines.push("");

  const regimeCounts = result.windows.reduce<Record<string, number>>((acc, w) => {
    acc[w.regime] = (acc[w.regime] ?? 0) + 1;
    return acc;
  }, {});
  const regimeSummary = Object.entries(regimeCounts)
    .map(([r, n]) => `${n} ${REGIME_LABEL[r] ?? r}`)
    .join(", ");
  lines.push(`  Fenêtres : ${result.windows.length} (${regimeSummary})`);
  if (result.skipped.length > 0) {
    lines.push(`  Achats bloqués par les règles de cash : ${result.skipped.length}`);
  }
  lines.push("");

  const shown = result.purchases.slice(-8);
  if (shown.length > 0) {
    lines.push(`  Derniers achats (${shown.length}/${result.purchases.length}) :`);
    for (const p of shown) {
      lines.push(
        `    ${p.date}  ${p.asset.padEnd(5)} ${money(p.quoteAmount, currency).padStart(10)}  @ ${p.price.toLocaleString("fr-FR")}  [${p.reason}]`,
      );
    }
  }
  lines.push("");
  console.log(lines.join("\n"));
}
