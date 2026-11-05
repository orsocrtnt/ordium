/**
 * Audit chat stratégie — tests qui documentent les incohérences.
 *
 * Convention :
 * - `describe("INCOHÉRENCE …")` : assertions sur le comportement ACTUEL divergents
 *   (passent tant que le bug existe — gardes de non-régression une fois corrigé :
 *    inverser l’expect et déplacer dans « CORRIGÉ »).
 * - Helpers `simulateClient*` reproduisent StrategyChat.tsx / finalizeTurn API
 *   sans dépendre de Next/Gemini.
 */
import { describe, expect, it } from "vitest";
import {
  SCHEDULE_PATCH_KEYS,
  extractAllocationHints,
  extractAllocationMode,
  extractScheduleHints,
  isSignalScopedAssetMention,
  stripScheduleFields,
} from "../src/scheduleHints.js";
import {
  extractRequiredFromText,
  mergeRequiredSchedule,
  missingRequired,
  needsAssetClassClarification,
  questionForRequired,
  type RequiredScheduleDraft,
} from "../src/requiredSchedule.js";

type Alloc = { asset: string; pct: number };

const CRYPTO3: Alloc[] = [
  { asset: "BTC", pct: 33.3 },
  { asset: "ETH", pct: 33.3 },
  { asset: "SOL", pct: 33.4 },
];

/** Miroir de StrategyChat sticky allocation (~577–603). */
function simulateClientStickyAllocation(
  prev: Alloc[] | undefined,
  safeFromText: { allocation?: Alloc[]; allocationMode?: string },
): Alloc[] | undefined {
  if (!safeFromText.allocation?.length) return prev;
  const prevN = prev?.length ?? 0;
  const nextN = safeFromText.allocation.length;
  const mode = safeFromText.allocationMode;
  if (mode === "add" && prevN > 0) {
    const seen = new Set(prev!.map((a) => a.asset.toUpperCase()));
    const merged = [...prev!];
    for (const row of safeFromText.allocation) {
      if (!seen.has(row.asset.toUpperCase())) {
        seen.add(row.asset.toUpperCase());
        merged.push(row);
      }
    }
    const each = Math.round((100 / merged.length) * 10) / 10;
    return merged.map((a, i) => ({
      asset: a.asset,
      pct:
        i === merged.length - 1
          ? Math.round((100 - each * (merged.length - 1)) * 10) / 10
          : each,
    }));
  }
  if (prevN > 1 && nextN === 1) return prev;
  return safeFromText.allocation;
}

/**
 * Miroir de appendAssistantFromTurn + draftOverride=safeFromText (~327–337, ~656) :
 * lastDraft ← interpreted.patch ← safeFromText (écrase sticky).
 */
function simulateClientDoubleMerge(
  prevDraft: { allocation?: Alloc[] },
  apiPatch: { allocation?: Alloc[] },
  safeFromText: { allocation?: Alloc[]; allocationMode?: string },
): Alloc[] | undefined {
  const afterSticky = {
    ...prevDraft,
    ...apiPatch,
    allocation: simulateClientStickyAllocation(prevDraft.allocation, safeFromText),
  };
  // BUG : safeFromText repassé en draftOverride après sticky
  return {
    ...afterSticky,
    ...safeFromText,
  }.allocation;
}

/** Miroir finalizeTurn F&G → wipe RSI (interpretStrategy ~714–727). */
function simulateApiFearGreedWipeRsi<T extends Record<string, unknown>>(patch: T): T {
  if (patch.fearGreedScaleEnabled === true || patch.fearGreedEnabled === true) {
    return {
      ...patch,
      dipEnabled: false,
      rsiEnabled: false,
      rsiScaleEnabled: false,
      athEnabled: false,
      reserveEnabled: false,
      regimeEnabled: false,
    };
  }
  return patch;
}

/** Miroir sticky F&G client (~555–567) — restaure prev si message sans fear. */
function simulateClientFearSticky(
  prev: RequiredScheduleDraft,
  merged: RequiredScheduleDraft,
  userText: string,
): RequiredScheduleDraft {
  const mentionsFear = /\bfear\b|\bgreed\b|\bpeur\b/i.test(userText);
  if (mentionsFear) return merged;
  return {
    ...merged,
    fearGreedValue: prev.fearGreedValue ?? merged.fearGreedValue,
    fearGreedEnabled: prev.fearGreedEnabled ?? merged.fearGreedEnabled,
    fearGreedScaleEnabled: prev.fearGreedScaleEnabled ?? merged.fearGreedScaleEnabled,
  };
}

function assetsOf(a: Alloc[] | undefined) {
  return (a ?? []).map((x) => x.asset).sort();
}

describe("INCOHÉRENCE #1 — double merge client annule « ajoute »", () => {
  it("engine unionne ; client draftOverride collapse à AMZN seul", () => {
    const prev = {
      allocation: CRYPTO3,
      budgetAmount: 200,
      period: "monthly" as const,
      windowFrom: 5,
      windowTo: 5,
      budgetSplit: "total" as const,
      fearGreedScaleEnabled: true,
      assetsChoice: "custom" as const,
    };
    const extracted = extractRequiredFromText("ajoute Amazon");
    expect(extracted.allocationMode).toBe("add");
    expect(assetsOf(extracted.allocation)).toEqual(["AMZN"]);

    const engine = mergeRequiredSchedule(prev, extracted);
    expect(assetsOf(engine.allocation)).toEqual(["AMZN", "BTC", "ETH", "SOL"]);

    const clientFinal = simulateClientDoubleMerge(
      prev,
      { allocation: engine.allocation },
      {
        allocation: extracted.allocation,
        allocationMode: extracted.allocationMode,
      },
    );
    // Comportement actuel cassé
    expect(assetsOf(clientFinal)).toEqual(["AMZN"]);
    // Divergence engine vs client
    expect(assetsOf(clientFinal)).not.toEqual(assetsOf(engine.allocation));
  });

  it("sticky seul (sans draftOverride) serait correct", () => {
    const sticky = simulateClientStickyAllocation(CRYPTO3, {
      allocation: [{ asset: "AMZN", pct: 100 }],
      allocationMode: "add",
    });
    expect(assetsOf(sticky)).toEqual(["AMZN", "BTC", "ETH", "SOL"]);
  });
});

describe("INCOHÉRENCE #2 — client vs engine sur 1 nouveau ticker sans « ajoute »", () => {
  it("engine unionne GOOGL ; sticky client garde l’ancien panier", () => {
    const prev = {
      allocation: CRYPTO3,
      budgetAmount: 200,
      period: "monthly" as const,
      windowFrom: 5,
      windowTo: 5,
      budgetSplit: "total" as const,
      assetsChoice: "custom" as const,
    };
    // Pas « ajoute » → mode replace, mais merge engine traite 1 ticker vs multi comme add
    const extracted = extractRequiredFromText("mets aussi Google");
    expect(extractAllocationMode("mets aussi Google")).toBe("replace");

    const engine = mergeRequiredSchedule(prev, extracted);
    const clientSticky = simulateClientStickyAllocation(prev.allocation, {
      allocation: extracted.allocation,
      allocationMode: extracted.allocationMode,
    });

    // Si extract voit GOOGL
    if (extracted.allocation?.length === 1) {
      expect(assetsOf(engine.allocation)).toContain("GOOGL");
      expect(assetsOf(clientSticky)).toEqual(["BTC", "ETH", "SOL"]);
      expect(assetsOf(clientSticky)).not.toEqual(assetsOf(engine.allocation));
    } else {
      // Si le parseur ne voit pas Google, documenter le trou extract
      expect(extracted.allocation ?? null).toBeNull();
    }
  });
});

describe("INCOHÉRENCE #3 — F&G finalize API efface RSI", () => {
  it("après « RSI sous 30 on double » + F&G déjà on → RSI wipe", () => {
    const prev: RequiredScheduleDraft = {
      budgetAmount: 200,
      period: "monthly",
      windowFrom: 5,
      windowTo: 5,
      budgetSplit: "total",
      fearGreedScaleEnabled: true,
      allocation: CRYPTO3,
      assetsChoice: "custom",
    };
    const extracted = extractRequiredFromText("et le RSI sous 30 on double");
    const merged = mergeRequiredSchedule(prev, extracted);
    // Extract pose bien le scale RSI
    const withSignals = {
      ...merged,
      fearGreedScaleEnabled: true,
      rsiScaleEnabled: extracted.rsiScaleEnabled ?? true,
      rsiEnabled: false as const,
      rsiLowLte: 30,
      rsiLowFactor: 2,
    };
    const afterApi = simulateApiFearGreedWipeRsi(withSignals);
    expect(afterApi.fearGreedScaleEnabled).toBe(true);
    expect(afterApi.rsiEnabled).toBe(false);
    expect(afterApi.rsiScaleEnabled).toBe(false);
  });
});

describe("INCOHÉRENCE #4 — sticky F&G client annule equity_only", () => {
  it("API coupe F&G ; client sans « fear » dans le message le restaure", () => {
    const prev: RequiredScheduleDraft = {
      budgetAmount: 200,
      period: "monthly",
      windowFrom: 5,
      windowTo: 5,
      budgetSplit: "total",
      fearGreedScaleEnabled: true,
      allocation: [
        ...CRYPTO3,
        { asset: "AMZN", pct: 25 },
      ].map((a, _, arr) => ({ asset: a.asset, pct: 100 / arr.length })),
      assetsChoice: "custom",
      assetClassPolicy: undefined,
    };
    const extracted = extractRequiredFromText("actions only");
    const engine = mergeRequiredSchedule(prev, extracted);
    expect(engine.assetClassPolicy).toBe("equity_only");

    // Comme interpretStrategy après applyAssetClassPolicy
    const apiCleared: RequiredScheduleDraft = {
      ...engine,
      fearGreedScaleEnabled: false,
      fearGreedEnabled: false,
    };

    const clientRestored = simulateClientFearSticky(prev, apiCleared, "actions only");
    expect(clientRestored.fearGreedScaleEnabled).toBe(true);
    expect(apiCleared.fearGreedScaleEnabled).toBe(false);
  });
});

describe("INCOHÉRENCE #5 — stripScheduleFields laisse allocation / from", () => {
  it("SCHEDULE_PATCH_KEYS n’inclut pas allocation ni from", () => {
    expect(SCHEDULE_PATCH_KEYS).not.toContain("allocation");
    expect(SCHEDULE_PATCH_KEYS).not.toContain("from");
    expect(SCHEDULE_PATCH_KEYS).not.toContain("horizon");
    expect(SCHEDULE_PATCH_KEYS).not.toContain("assetsChoice");
    expect(SCHEDULE_PATCH_KEYS).not.toContain("assetClassPolicy");

    const stripped = stripScheduleFields({
      budgetAmount: 999,
      allocation: [{ asset: "FAKE", pct: 100 }],
      from: "2099-01-01",
      horizon: "custom",
      assetsChoice: "custom",
    });
    expect(stripped.budgetAmount).toBeUndefined();
    expect(stripped.allocation).toEqual([{ asset: "FAKE", pct: 100 }]);
    expect(stripped.from).toBe("2099-01-01");
  });
});

describe("INCOHÉRENCE #6 — seuil RSI peut devenir budget", () => {
  it("« RSI sous 30 on double » peut polluer budgetAmount", () => {
    const h = extractScheduleHints("je veux RSI sous 30 on double");
    const req = extractRequiredFromText("je veux RSI sous 30 on double");
    // Documente le comportement actuel (souvent budget=30 via loose retry)
    const budget = h.budgetAmount ?? req.budgetAmount;
    if (budget != null) {
      expect(budget).toBe(30);
      // Signal d’alarme audit : 30 est le seuil RSI, pas un budget
      expect(budget).toBe(h.rsiLowLte ?? req.rsiLowLte ?? 30);
    } else {
      // Si corrigé un jour : RSI scale sans budget
      expect(h.rsiScaleEnabled || req.rsiScaleEnabled).toBe(true);
    }
  });

  it("F&G seuil n’est PAS un budget (référence saine)", () => {
    const h = extractScheduleHints("quand fear sous 35 on double");
    expect(h.budgetAmount).toBeUndefined();
    expect(h.fearGreedScaleEnabled).toBe(true);
  });
});

describe("INCOHÉRENCE #7 — firstTransactionDate engine OK mais API ne le passe pas", () => {
  it("extract avec firstTransactionDate + « depuis mon premier achat » pose from", () => {
    const out = extractRequiredFromText("depuis mon premier achat", {
      awaiting: "startDate",
      firstTransactionDate: "2023-06-15",
    });
    expect(out.from).toBe("2023-06-15");
    expect(out.horizon).toBe("since_first_buy");
  });

  it("sans firstTransactionDate le même texte ne résout pas la date portefeuille", () => {
    const out = extractRequiredFromText("depuis mon premier achat", {
      awaiting: "startDate",
    });
    // Sans la date portefeuille, pas de from ISO portefeuille
    expect(out.from === "2023-06-15").toBe(false);
  });
});

describe("INCOHÉRENCE #8 — « RSI pour X » ne wipe pas alloc mais n’active pas RSI", () => {
  it("signal-scoped pour BTC / AMZN / ETH — générique, pas Amazon-only", () => {
    for (const phrase of [
      "je veux le RSI pour Amazon",
      "RSI pour BTC",
      "mettre le RSI sur ETH",
    ]) {
      expect(isSignalScopedAssetMention(phrase)).toBe(true);
      expect(extractAllocationHints(phrase)).toBeNull();
    }
  });

  it("après merge, rsiEnabled reste off → assetClassMix peut demander sans RSI actif", () => {
    const prev = mergeRequiredSchedule(
      {
        budgetAmount: 200,
        period: "monthly",
        windowFrom: 5,
        windowTo: 5,
        budgetSplit: "total",
        fearGreedScaleEnabled: true,
        allocation: [
          { asset: "BTC", pct: 25 },
          { asset: "ETH", pct: 25 },
          { asset: "SOL", pct: 25 },
          { asset: "AMZN", pct: 25 },
        ],
        assetsChoice: "custom",
      },
      extractRequiredFromText("ok je veux que pour Amazon on mette le RSI"),
    );
    expect(assetsOf(prev.allocation)).toEqual(["AMZN", "BTC", "ETH", "SOL"]);
    expect(prev.rsiEnabled).toBeUndefined();
    expect(prev.rsiScaleEnabled).toBeUndefined();
    // Clarification classe encore liée au F&G (ok) mais l’intent RSI est perdu
    expect(needsAssetClassClarification(prev)).toBe(true);
  });
});

describe("INCOHÉRENCE #9 — questionForRequired(assetClassMix) ignore le draft", () => {
  it("hardcode fearGreedScaleEnabled: true même pour appel générique", () => {
    const q = questionForRequired("assetClassMix");
    expect(q.toLowerCase()).toMatch(/fear|greed|crypto|mix|actions/);
  });
});

describe("INCOHÉRENCE #10 — parcours user type (engine seul, sans bugs client)", () => {
  it("200 tt les 5 + fear → split → ajoute Amazon → mix", () => {
    let d = extractRequiredFromText(
      "200 tt les 5 du mois sur BTC ETH SOL quand fear sous 35 on double",
    );
    expect(d.budgetAmount).toBe(200);
    expect(d.period).toBe("monthly");
    expect(d.windowFrom).toBe(5);
    expect(assetsOf(d.allocation)).toEqual(["BTC", "ETH", "SOL"]);
    expect(d.fearGreedScaleEnabled).toBe(true);
    expect(missingRequired(d)).toContain("budgetSplit");

    d = mergeRequiredSchedule(d, extractRequiredFromText("répartis"));
    expect(d.budgetSplit).toBe("total");
    expect(missingRequired(d)).not.toContain("budgetSplit");

    d = mergeRequiredSchedule(d, extractRequiredFromText("ajoute Amazon"));
    expect(assetsOf(d.allocation)).toEqual(["AMZN", "BTC", "ETH", "SOL"]);
    expect(missingRequired(d)).toContain("assetClassMix");

    d = mergeRequiredSchedule(d, extractRequiredFromText("garde le mix"));
    expect(d.assetClassPolicy).toBe("mixed_ok");
    expect(missingRequired(d)).toContain("startDate");
  });
});
