import { describe, expect, it } from "vitest";
import {
  extractRequiredFromText,
  isRequiredFieldAnswered,
  mergeRequiredSchedule,
  missingRequired,
  missingRequiredQuestions,
  stripReplyQuestionsForAnswered,
} from "../src/requiredSchedule.js";

describe("requiredSchedule — logique unique des 5 champs", () => {
  const phrase =
    "je veux mettre tt les 5 du mois 200 sur du BTC ETH et sol et quand le fear est en dessous de 35 on double la mise";

  it("extrait budget + fréquence + fenêtre + actifs en une passe", () => {
    const d = extractRequiredFromText(phrase);
    expect(d.budgetAmount).toBe(200);
    expect(d.period).toBe("monthly");
    expect(d.windowFrom).toBe(5);
    expect(d.windowTo).toBe(5);
    expect(d.allocation?.map((a) => a.asset).sort()).toEqual(["BTC", "ETH", "SOL"]);
    expect(isRequiredFieldAnswered(d, "budget")).toBe(true);
    expect(isRequiredFieldAnswered(d, "frequency")).toBe(true);
    expect(isRequiredFieldAnswered(d, "window")).toBe(true);
    expect(isRequiredFieldAnswered(d, "assets")).toBe(true);
    // Montant unique multi-actifs sans « total/chacun » → clarification
    expect(isRequiredFieldAnswered(d, "budgetSplit")).toBe(false);
    expect(missingRequired(d)).toEqual(["budgetSplit", "startDate"]);
  });

  it("ne repose aucune question déjà satisfaite (strip reply)", () => {
    const d = extractRequiredFromText(phrase);
    const dirty =
      "OK, 200 € le 5 de chaque mois sur BTC, ETH et SOL. Quel montant par période ? (ex. 200 EUR) Quelle fréquence — chaque semaine ou chaque mois ?";
    const clean = stripReplyQuestionsForAnswered(dirty, d);
    expect(clean.toLowerCase()).not.toMatch(/montant|fr[ée]quence|semaine ou/);
    expect(missingRequiredQuestions(d, "EUR")[0]).toMatch(/au total|par actif/);
  });

  it("« au total » vs « chacun » résolvent le budget", () => {
    const base = extractRequiredFromText(phrase);
    const total = mergeRequiredSchedule(base, extractRequiredFromText("au total", { awaiting: "budgetSplit" }));
    expect(total.budgetSplit).toBe("total");
    expect(total.budgetAmount).toBe(200);
    expect(missingRequired(total)).toEqual(["startDate"]);

    const each = mergeRequiredSchedule(base, extractRequiredFromText("chacun", { awaiting: "budgetSplit" }));
    expect(each.budgetSplit).toBe("per_asset");
    expect(each.budgetAmount).toBe(600);
    expect(each.budgetQuotedAmount).toBe(200);
  });

  it("« on répartit » = total (ne repose pas la question)", () => {
    const base = extractRequiredFromText(phrase);
    const merged = mergeRequiredSchedule(
      base,
      extractRequiredFromText("on répartit", { awaiting: "budgetSplit" }),
    );
    expect(merged.budgetSplit).toBe("total");
    expect(merged.budgetAmount).toBe(200);
    expect(missingRequired(merged)).toEqual(["startDate"]);
    const dirty =
      "OK pour une répartition globale. Quelle est la date de début ? Les 200 €, c’est au total ou 200 € par actif (donc 600 €) ?";
    const clean = stripReplyQuestionsForAnswered(dirty, merged);
    expect(clean.toLowerCase()).not.toMatch(/par actif|donc 600/);
    expect(clean.toLowerCase()).toMatch(/date/);
  });

  it("« 200 chacun » dans le message initial → 600 sans question", () => {
    const d = extractRequiredFromText(
      "200 chacun sur BTC ETH SOL tt les mois le 5",
    );
    expect(d.budgetAmount).toBe(600);
    expect(d.budgetSplit).toBe("per_asset");
    expect(isRequiredFieldAnswered(d, "budgetSplit")).toBe(true);
  });

  it("merge conserve le précédent et écrase avec l’extrait", () => {
    const prev = extractRequiredFromText("100 euros tous les mois le 1 sur BTC");
    const next = extractRequiredFromText("passe à 250 et le 5 du mois");
    const merged = mergeRequiredSchedule(prev, next);
    expect(merged.budgetAmount).toBe(250);
    expect(merged.windowFrom).toBe(5);
    expect(merged.period).toBe("monthly");
    expect(merged.allocation?.[0]?.asset).toBe("BTC");
  });

  it("ordre montant avant jour reste cohérent", () => {
    const d = extractRequiredFromText(
      "je veux mettre 200 tt les 5 du mois sur le btc quand le fear est en dessous de 35 mettre le double",
    );
    // 1 seul actif → pas de clarification split
    expect(missingRequired(d)).toEqual(["startDate"]);
    expect(d.budgetAmount).toBe(200);
  });

  it("awaiting startDate court ne pollue pas le budget", () => {
    const d = extractRequiredFromText("15/03/2023", { awaiting: "startDate" });
    expect(d.from).toBe("2023-03-15");
    expect(d.budgetAmount).toBeUndefined();
    expect(d.horizon).toBe("custom");
  });

  it("awaiting assets « oui » → portefeuille", () => {
    const d = extractRequiredFromText("oui", { awaiting: "assets" });
    expect(d.assetsChoice).toBe("portfolio");
  });
});
