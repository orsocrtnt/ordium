import { describe, expect, it } from "vitest";
import {
  extractAllocationHints,
  extractAllocationMode,
  isSignalScopedAssetMention,
  partitionAllocationByClass,
  unionEqualAllocation,
} from "../src/scheduleHints.js";
import {
  extractRequiredFromText,
  mergeRequiredSchedule,
  missingRequired,
  needsAssetClassClarification,
} from "../src/requiredSchedule.js";

describe("allocation sticky / crypto-equity", () => {
  it("« RSI pour Amazon » n’est pas une allocation AMZN 100%", () => {
    expect(isSignalScopedAssetMention("ok je veux que pour Amazon on mette le RSI")).toBe(true);
    expect(extractAllocationHints("ok je veux que pour Amazon on mette le RSI")).toBeNull();
  });

  it("« ajoute Amazon » = mode add", () => {
    expect(extractAllocationMode("ajoute Amazon")).toBe("add");
    const alloc = extractAllocationHints("ajoute Amazon");
    expect(alloc?.map((a) => a.asset)).toEqual(["AMZN"]);
  });

  it("merge add conserve BTC ETH SOL + AMZN", () => {
    const base = extractRequiredFromText(
      "200 au total tt les 5 du mois sur BTC ETH SOL quand fear sous 35 on double",
    );
    expect(base.allocation?.map((a) => a.asset).sort()).toEqual(["BTC", "ETH", "SOL"]);
    const withFear = {
      ...base,
      fearGreedScaleEnabled: true as const,
      budgetSplit: "total" as const,
    };
    const merged = mergeRequiredSchedule(
      withFear,
      extractRequiredFromText("ajoute Amazon"),
    );
    expect(merged.allocation?.map((a) => a.asset).sort()).toEqual([
      "AMZN",
      "BTC",
      "ETH",
      "SOL",
    ]);
    expect(needsAssetClassClarification(merged)).toBe(true);
    expect(missingRequired(merged)).toContain("assetClassMix");
  });

  it("RSI pour Amazon ne wipe pas l’allocation précédente", () => {
    const prev = mergeRequiredSchedule(
      {
        budgetAmount: 400,
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
        from: "2024-01-01",
        horizon: "custom",
      },
      extractRequiredFromText("ok je veux que pour Amazon on mette le RSI"),
    );
    expect(prev.allocation?.map((a) => a.asset).sort()).toEqual([
      "AMZN",
      "BTC",
      "ETH",
      "SOL",
    ]);
    expect(partitionAllocationByClass(prev.allocation).equity).toContain("AMZN");
  });

  it("unionEqualAllocation déduplique", () => {
    expect(
      unionEqualAllocation(
        [
          { asset: "BTC", pct: 50 },
          { asset: "ETH", pct: 50 },
        ],
        [{ asset: "BTC", pct: 100 }],
      ).map((a) => a.asset),
    ).toEqual(["BTC", "ETH"]);
  });
});
