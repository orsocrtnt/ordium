import { describe, expect, it } from "vitest";
import {
  INVESTMENT_ADVICE_REFUSAL,
  isInvestmentAdviceRequest,
} from "../src/adviceGuard.js";

describe("isInvestmentAdviceRequest", () => {
  it("refuse conseil en investissement", () => {
    expect(isInvestmentAdviceRequest("donne moi un conseil en investissement")).toBe(true);
    expect(isInvestmentAdviceRequest("un conseil financier svp")).toBe(true);
    expect(isInvestmentAdviceRequest("conseille-moi")).toBe(true);
  });

  it("refuse « meilleure stratégie » (ex. Google)", () => {
    expect(isInvestmentAdviceRequest("donnes moi la meilleur stratégie sur google")).toBe(true);
    expect(isInvestmentAdviceRequest("quelle est la meilleure stratégie sur GOOGL ?")).toBe(true);
    expect(isInvestmentAdviceRequest("recommandes-moi une stratégie sur Google")).toBe(true);
  });

  it("laisse passer une config de règles utilisateur", () => {
    expect(
      isInvestmentAdviceRequest(
        "150 € chaque mois sur BTC ETH SOL le 29 si fear < 40",
      ),
    ).toBe(false);
    expect(isInvestmentAdviceRequest("je veux un DCA classique 200 euros mensuel")).toBe(false);
    expect(isInvestmentAdviceRequest("200")).toBe(false);
    expect(isInvestmentAdviceRequest("tt les mois")).toBe(false);
  });

  it("message de refus produit", () => {
    expect(INVESTMENT_ADVICE_REFUSAL).toMatch(/ne donne pas de conseil/i);
  });
});
