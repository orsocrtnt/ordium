import { describe, expect, it } from "vitest";
import {
  extractRegimeHints,
  extractScheduleHints,
  normalizeFrChat,
} from "../src/scheduleHints.js";

describe("normalizeFrChat", () => {
  it("étend tt → toutes", () => {
    expect(normalizeFrChat("tt les mois")).toContain("toutes les mois");
  });
});

describe("extractScheduleHints", () => {
  it("comprend « je veux que ça soit tt les mois »", () => {
    const h = extractScheduleHints("je veux que ça soit tt les mois");
    expect(h.period).toBe("monthly");
  });

  it("comprend « tous les mois » / « mensuel » / « au mois »", () => {
    expect(extractScheduleHints("tous les mois").period).toBe("monthly");
    expect(extractScheduleHints("mensuel").period).toBe("monthly");
    expect(extractScheduleHints("plutôt au mois").period).toBe("monthly");
  });

  it("comprend « chaque semaine » / « hebdo »", () => {
    expect(extractScheduleHints("chaque semaine").period).toBe("weekly");
    expect(extractScheduleHints("hebdo").period).toBe("weekly");
  });

  it("comprend montant nu et phrases", () => {
    expect(extractScheduleHints("200", { looseBudget: true }).budgetAmount).toBe(200);
    expect(extractScheduleHints("je mets 200").budgetAmount).toBe(200);
    expect(extractScheduleHints("environ 300 euros").currency).toBe("EUR");
  });

  it("ne prend pas +15% pour un budget", () => {
    const h = extractScheduleHints(
      "fais un DCA classique avec +15% en baisse et -15% en hausse sur l'investissement",
    );
    expect(h.budgetAmount).toBeUndefined();
    expect(h.period).toBeUndefined();
    expect(h.windowFrom).toBeUndefined();
  });

  it("comprend fenêtre naturelle", () => {
    expect(extractScheduleHints("du 1 au 7")).toMatchObject({
      windowFrom: 1,
      windowTo: 7,
    });
    expect(extractScheduleHints("les premiers jours")).toMatchObject({
      windowFrom: 1,
      windowTo: 7,
    });
  });

  it("comprend un seul jour : « le 1 du mois »", () => {
    expect(extractScheduleHints("le 1 du mois")).toMatchObject({
      windowFrom: 1,
      windowTo: 1,
    });
    expect(extractScheduleHints("le 1er du mois")).toMatchObject({
      windowFrom: 1,
      windowTo: 1,
    });
    expect(extractScheduleHints("1er")).toMatchObject({
      windowFrom: 1,
      windowTo: 1,
    });
    expect(extractScheduleHints("uniquement le 1")).toMatchObject({
      windowFrom: 1,
      windowTo: 1,
    });
  });

  it("extrait plusieurs infos d’une phrase", () => {
    const h = extractScheduleHints("je mets 200 tt les mois du 1 au 7");
    expect(h.budgetAmount).toBe(200);
    expect(h.period).toBe("monthly");
    expect(h.windowFrom).toBe(1);
    expect(h.windowTo).toBe(7);
  });

  it("comprend l’horizon de simulation", () => {
    expect(extractScheduleHints("1 an").horizon).toBe("1y");
    expect(extractScheduleHints("sur 3 ans").horizon).toBe("3y");
    expect(extractScheduleHints("depuis mon premier achat").horizon).toBe("since_first_buy");
  });

  it("comprend une date de début libre", () => {
    expect(extractScheduleHints("15/03/2023")).toMatchObject({
      horizon: "custom",
      from: "2023-03-15",
    });
    expect(extractScheduleHints("mars 2024")).toMatchObject({
      horizon: "custom",
      from: "2024-03-01",
    });
    expect(extractScheduleHints("2025/01/01")).toMatchObject({
      horizon: "custom",
      from: "2025-01-01",
    });
    expect(extractScheduleHints("01/01/2025")).toMatchObject({
      horizon: "custom",
      from: "2025-01-01",
    });
  });

  it("ne transforme pas une date en fenêtre 1–1", () => {
    const h = extractScheduleHints("01/01/2025");
    expect(h.windowFrom).toBeUndefined();
    expect(h.windowTo).toBeUndefined();
    expect(h.from).toBe("2025-01-01");
  });

  it("somme 50 BTC + 50 ETH + 50 SOL → budget 150 et allocation", () => {
    const h = extractScheduleHints(
      "envoyer tt les mois 50 sur BTC 50 ETH et 50 SOL que quand le fear est en dessous de 35",
    );
    expect(h.budgetAmount).toBe(150);
    expect(h.period).toBe("monthly");
    expect(h.fearGreedEnabled).toBe(true);
    expect(h.fearGreedValue).toBe(35);
    expect(h.allocation?.map((a) => a.asset).sort()).toEqual(["BTC", "ETH", "SOL"]);
  });

  it("comprend « entre le 1 et 7 »", () => {
    expect(extractScheduleHints("entre le 1 et 7")).toMatchObject({
      windowFrom: 1,
      windowTo: 7,
    });
  });

  it("comprend typo « 1 u 7 » et « 1 a 7 »", () => {
    expect(extractScheduleHints("1 u 7")).toMatchObject({
      windowFrom: 1,
      windowTo: 7,
    });
    expect(extractScheduleHints("1 a 7")).toMatchObject({
      windowFrom: 1,
      windowTo: 7,
    });
  });

  it("ne confond JAMAIS une année / date avec le budget", () => {
    expect(extractScheduleHints("mars 2024", { looseBudget: true }).budgetAmount).toBeUndefined();
    expect(extractScheduleHints("2024", { looseBudget: true }).budgetAmount).toBeUndefined();
    expect(extractScheduleHints("15/03/2024", { looseBudget: true }).budgetAmount).toBeUndefined();
    expect(extractScheduleHints("depuis 2024", { looseBudget: true })).toMatchObject({
      from: "2024-01-01",
      horizon: "custom",
    });
    expect(extractScheduleHints("depuis 2024", { looseBudget: true }).budgetAmount).toBeUndefined();
    // Année nue hors contexte date → pas de `from` (évite 2000 → date).
    expect(extractScheduleHints("2024", { looseBudget: true }).from).toBeUndefined();
    expect(extractScheduleHints("2024", { looseBudget: true }).budgetAmount).toBeUndefined(); // année calendaire rejetée

    const mixed = extractScheduleHints("je mets 200 depuis mars 2024");
    expect(mixed.budgetAmount).toBe(200);
    expect(mixed.from).toBe("2024-03-01");

    // 2000 € reste un budget valide.
    expect(extractScheduleHints("2000", { looseBudget: true }).budgetAmount).toBe(2000);
    expect(extractScheduleHints("2000 euros").budgetAmount).toBe(2000);
  });

  it("ne confond JAMAIS le jour du mois (29) avec le budget", () => {
    const h = extractScheduleHints(
      "achète le 29 du mois si le fear est en dessous de 40 50 de bTC, ETH et de SOL",
    );
    expect(h.budgetAmount).toBeUndefined();
    expect(h.windowFrom).toBe(29);
    expect(h.windowTo).toBe(29);
    expect(h.fearGreedEnabled).toBe(true);
    expect(h.fearGreedValue).toBe(40);
    expect(h.allocation?.map((a) => a.asset).sort()).toEqual(["BTC", "ETH", "SOL"]);
    expect(h.allocation?.every((a) => a.pct >= 33 && a.pct <= 34)).toBe(true);
  });

  it("« le 29 du mois » seul → fenêtre 29–29, pas de budget", () => {
    const h = extractScheduleHints("le 29 du mois");
    expect(h).toMatchObject({ windowFrom: 29, windowTo: 29 });
    expect(h.budgetAmount).toBeUndefined();
  });

  it("comprend « tout les mois » (typo) comme mensuel", () => {
    expect(extractScheduleHints("tout les mois").period).toBe("monthly");
    expect(normalizeFrChat("tout les mois")).toContain("tous les mois");
  });

  it("ne confond JAMAIS fear 35 avec le budget (modulation ×2 / ×0.5)", () => {
    const revise =
      "je veux changer si fear 35 on investi 2 fois plus que d'habitude sinon normalement mais si fear 80 on investit 0,5 fois";
    const h = extractScheduleHints(revise);
    expect(h.budgetAmount).toBeUndefined();
    expect(h.fearGreedScaleEnabled).toBe(true);
    expect(h.fearGreedEnabled).toBe(false);
    expect(h.fearGreedLowLte).toBe(35);
    expect(h.fearGreedLowFactor).toBe(2);
    expect(h.fearGreedHighGte).toBe(80);
    expect(h.fearGreedHighFactor).toBe(0.5);
  });

  it("BTC + Amazon + Tesla → allocation égale AMZN/TSLA", () => {
    const h = extractScheduleHints("non je veux sur BTC Amazon et tesla");
    expect(h.allocation?.map((a) => a.asset).sort()).toEqual(["AMZN", "BTC", "TSLA"]);
    expect(h.allocation?.every((a) => a.pct >= 33 && a.pct <= 34)).toBe(true);
  });

  it("150 € répartis BTC ETH SOL conserve le fear du message", () => {
    const h = extractScheduleHints("150 euros répartie sur BTC ETH SOL");
    expect(h.budgetAmount).toBe(150);
    expect(h.allocation?.map((a) => a.asset).sort()).toEqual(["BTC", "ETH", "SOL"]);
    expect(h.fearGreedValue).toBeUndefined();
  });

  it("révision fear 40 seule ne crée pas de budget", () => {
    const h = extractScheduleHints("modifie je veux si fear en dessous de 40");
    expect(h.budgetAmount).toBeUndefined();
    expect(h.fearGreedEnabled).toBe(true);
    expect(h.fearGreedValue).toBe(40);
  });

  it("« que si fear » → gate + requireSignal", () => {
    const h = extractScheduleHints("acheter 150 que si fear tombe en dessous de 35");
    expect(h.budgetAmount).toBe(150);
    expect(h.fearGreedEnabled).toBe(true);
    expect(h.fearGreedValue).toBe(35);
    expect(h.requireSignal).toBe(true);
    expect(h.fearGreedScaleEnabled).toBeUndefined();
  });

  it("RSI scale : double / moitié", () => {
    const h = extractScheduleHints(
      "si rsi en dessous de 30 on double si au dessus de 70 on divise par 2",
    );
    expect(h.rsiScaleEnabled).toBe(true);
    expect(h.rsiEnabled).toBe(false);
    expect(h.rsiLowLte).toBe(30);
    expect(h.rsiHighGte).toBe(70);
  });

  it("reprend budget 150 + scale F&G sans confondre 35", () => {
    const h = extractScheduleHints(
      "non je reprend on investi 150 en tt si fear en dessous de 35 on double si au dessus de 80 on divise par 2 si entre les deux on reste sur le montant normal",
    );
    expect(h.budgetAmount).toBe(150);
    expect(h.fearGreedScaleEnabled).toBe(true);
    expect(h.fearGreedEnabled).toBe(false);
    expect(h.fearGreedLowLte).toBe(35);
    expect(h.fearGreedHighGte).toBe(80);
  });

  it("gate F&G simple reste un seuil d'achat (pas scale)", () => {
    const h = extractScheduleHints(
      "envoyer tt les mois 50 sur BTC 50 ETH et 50 SOL que quand le fear est en dessous de 35",
    );
    expect(h.budgetAmount).toBe(150);
    expect(h.fearGreedEnabled).toBe(true);
    expect(h.fearGreedValue).toBe(35);
    expect(h.fearGreedScaleEnabled).toBeUndefined();
  });

  it("« 200 tt les 5 du mois » → budget + mensuel + jour 5 (pas confusion 200/jour)", () => {
    const h = extractScheduleHints(
      "je veux mettre 200 tt les 5 du mois sur le btc quand le fear est en dessous de 35 mettre le double",
    );
    expect(h.budgetAmount).toBe(200);
    expect(h.period).toBe("monthly");
    expect(h.windowFrom).toBe(5);
    expect(h.windowTo).toBe(5);
    expect(h.allocation).toEqual([{ asset: "BTC", pct: 100 }]);
    expect(h.fearGreedScaleEnabled).toBe(true);
    expect(h.fearGreedLowLte).toBe(35);
    expect(h.fearGreedLowFactor).toBe(2);
    expect(h.fearGreedEnabled).toBe(false);
  });

  it("« tt les 5 du mois » seul → mensuel jour 5", () => {
    expect(extractScheduleHints("tt les 5 du mois")).toMatchObject({
      period: "monthly",
      windowFrom: 5,
      windowTo: 5,
    });
  });

  it("« 200 € tous les mois le 5 » → fenêtre 5–5", () => {
    expect(extractScheduleHints("200 € tous les mois le 5")).toMatchObject({
      budgetAmount: 200,
      period: "monthly",
      windowFrom: 5,
      windowTo: 5,
    });
  });

  it("montant APRÈS le jour : « tt les 5 du mois 200 sur BTC ETH SOL » + fear ×2", () => {
    const h = extractScheduleHints(
      "je veux mettre tt les 5 du mois 200 sur du BTC ETH et sol et quand le fear est en dessous de 35 on double la mise",
    );
    expect(h.budgetAmount).toBe(200);
    expect(h.period).toBe("monthly");
    expect(h.windowFrom).toBe(5);
    expect(h.windowTo).toBe(5);
    expect(h.allocation?.map((a) => a.asset).sort()).toEqual(["BTC", "ETH", "SOL"]);
    expect(h.fearGreedScaleEnabled).toBe(true);
    expect(h.fearGreedLowLte).toBe(35);
    expect(h.fearGreedLowFactor).toBe(2);
    expect(h.fearGreedEnabled).toBe(false);
  });

  it("« 200 sur BTC » sans verbe ni devise", () => {
    expect(extractScheduleHints("200 sur BTC chaque mois le 1")).toMatchObject({
      budgetAmount: 200,
      period: "monthly",
      windowFrom: 1,
      windowTo: 1,
    });
  });
});

describe("extractRegimeHints", () => {
  it("mappe +15% baisse / -15% hausse → multiplicateurs", () => {
    const h = extractRegimeHints(
      "fais un DCA classique avec +15% en baisse et -15% en hausse sur l'investissement",
    );
    expect(h).toMatchObject({
      regimeEnabled: true,
      bearMult: 1.15,
      bullMult: 0.85,
    });
  });
});
