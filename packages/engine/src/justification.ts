/**
 * Justificatifs de montants — auditabilité des règles inviolables.
 */

import type { AmountJustification, PurchaseKind, Regime } from "./types.js";

const REGIME_FR: Record<Regime, string> = {
  bull: "haussier",
  neutral: "neutre",
  bear: "baissier",
};

function fmtNum(n: number, digits = 2): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isInteger(r) ? String(r) : r.toFixed(digits).replace(/\.?0+$/, "");
}

function fmtMult(m: number): string {
  return `×${fmtNum(m, 3)}`;
}

export function regimeLabelFr(regime: Regime): string {
  return REGIME_FR[regime];
}

export function buildWindowJustification(opts: {
  baseBudget: number;
  multiplier: number;
  regime: Regime;
  windowBudget: number;
  envelopeMin: number;
  envelopeMax: number;
  /** Détail par actif (mode indépendant). */
  perAsset?: Record<
    string,
    { regime: Regime; multiplier: number; plannedBudget: number; invested?: number }
  >;
}): AmountJustification {
  const { baseBudget, multiplier, regime, windowBudget, envelopeMin, envelopeMax, perAsset } =
    opts;
  const regimeFr = regimeLabelFr(regime);

  const entries = perAsset ? Object.entries(perAsset) : [];
  const regimes = new Set(entries.map(([, a]) => a.regime));
  const mixed = entries.length >= 2 && regimes.size > 1;

  let summary: string;
  if (entries.length >= 1 && perAsset != null) {
    // Toujours détailler les € par actif — évite l’illusion « 200 × 0,85 » globale.
    const bits = entries
      .map(([asset, a]) => {
        const amt = a.invested != null && a.invested > 0 ? a.invested : a.plannedBudget;
        return `${asset} ${fmtNum(amt)}€ (${regimeLabelFr(a.regime)} ${fmtMult(a.multiplier)})`;
      })
      .slice(0, 8);
    const more = entries.length > 8 ? "…" : "";
    const sameNote =
      !mixed && entries.length >= 2
        ? " — même régime sur chaque courbe, montants calculés séparément"
        : "";
    summary = `${fmtNum(windowBudget)} € = ${bits.join(" + ")}${more}${sameNote}`;
  } else if (Math.abs(multiplier - 1) < 1e-9) {
    summary = `${fmtNum(windowBudget)} € = budget de base ${fmtNum(baseBudget)} € (régime ${regimeFr}, ${fmtMult(1)})`;
  } else {
    summary = `${fmtNum(windowBudget)} € = ${fmtNum(baseBudget)} × ${fmtNum(multiplier, 3)} (régime ${regimeFr})`;
  }

  return {
    summary,
    baseBudget,
    multiplier,
    regime,
    windowBudget,
    envelopeMin,
    envelopeMax,
    formula:
      entries.length >= 1
        ? "windowBudget = Σ (base × weight_i × mult_i)"
        : "windowBudget = clamp(baseBudget × multiplier, envelopeMin, envelopeMax)",
  };
}

export function buildPurchaseJustification(opts: {
  baseBudget: number;
  multiplier: number;
  regime: Regime;
  windowBudget: number;
  envelopeMin: number;
  envelopeMax: number;
  assetWeight: number;
  trancheFraction: number;
  kind: PurchaseKind;
  quoteAmount: number;
  clipped?: boolean;
  /** true = windowBudget est déjà la sleeve actif (base×poids×mult). */
  perAssetSleeve?: boolean;
}): AmountJustification {
  const {
    baseBudget,
    multiplier,
    regime,
    windowBudget,
    envelopeMin,
    envelopeMax,
    assetWeight,
    trancheFraction,
    kind,
    quoteAmount,
    clipped,
    perAssetSleeve,
  } = opts;
  const regimeFr = regimeLabelFr(regime);
  const pct = fmtNum(assetWeight * 100, 1);
  const parts = perAssetSleeve
    ? [
        `${fmtNum(baseBudget)} × ${pct}% × ${fmtNum(multiplier, 3)} (${regimeFr}, courbe de cet actif)`,
        `= ${fmtNum(windowBudget)} € sleeve`,
      ]
    : [
        `${fmtNum(baseBudget)} × ${fmtNum(multiplier, 3)} (${regimeFr})`,
        `= ${fmtNum(windowBudget)} € fenêtre`,
        `× ${pct} % actif`,
      ];
  if (Math.abs(trancheFraction - 1) > 1e-9) {
    parts.push(`× tranche ${fmtNum(trancheFraction * 100, 1)} %`);
  }
  parts.push(`→ ${fmtNum(quoteAmount)} €`);
  if (clipped) parts.push("(plafonné)");
  if (kind === "extra") parts.push("[extra hors tranche, cash fenêtre]");

  return {
    summary: parts.join(" "),
    baseBudget,
    multiplier,
    regime,
    windowBudget,
    envelopeMin,
    envelopeMax,
    assetWeight,
    trancheFraction,
    clipped: Boolean(clipped),
    formula: perAssetSleeve
      ? kind === "extra"
        ? "min(sleeve × extra%, cash restant sleeve)"
        : "min(sleeve × trancheFraction, cash restant, plafond sleeve)"
      : kind === "extra"
        ? "min(windowBudget × weight × extra%, cash restant fenêtre)"
        : "min(windowBudget × weight × trancheFraction, cash restant, plafond fenêtre)",
  };
}
