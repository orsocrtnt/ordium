import { normalizeFrChat } from "./scheduleHints.js";

/**
 * Ordium n’est pas un conseiller : on refuse toute demande d’avis / « meilleure
 * stratégie » / recommandation d’investissement. L’utilisateur définit ses règles.
 */
export const INVESTMENT_ADVICE_REFUSAL =
  "Je ne donne pas de conseil en investissement. Ordium exécute uniquement les règles que tu définis toi-même — sans te dire quoi acheter ni quelle stratégie est « la meilleure ». Décris ce que TU veux automatiser (budget, fréquence, fenêtres, règles…), et je te l’aide à configurer.";

/** Détecte une demande de conseil / recommandation (pas une config de règles). */
export function isInvestmentAdviceRequest(text: string): boolean {
  const t = normalizeFrChat(text);
  if (!t.trim()) return false;

  // Explicite : « conseil en investissement / financier »
  if (
    /\b(conseil|conseils|advice)\b/.test(t) &&
    /\b(invest|investissement|financier|finance|bourse|placement|trading|crypto)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(conseille[- ]?moi|donne[- ]?moi\s+(un|des)\s+conseil|je\s+veux\s+un\s+conseil)\b/.test(t)) {
    return true;
  }

  // « meilleure / bonne stratégie », « que me recommandes-tu »
  if (
    /\b(meilleure?|meilleur|optimale?|ideale?|parfaite?)\b.{0,40}\b(strateg|approche|methode|allocation|placement|portefeuille)\b/.test(
      t,
    ) ||
    /\b(strateg|approche|methode|placement)\b.{0,40}\b(meilleure?|meilleur|optimale?|ideale?)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(quelle|quel)\b.{0,30}\b(strateg|approche|methode)\b.{0,40}\b(choisir|prendre|adopter|utiliser|faire)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(recommand(e|es|er|ation)|sugger(e|es|er)|propose[- ]?moi|dis[- ]?moi\s+quoi)\b/.test(t) &&
    /\b(strateg|investir|acheter|placement|action|crypto|etf|googl|google|btc|eth)\b/.test(t)
  ) {
    return true;
  }

  // « faut-il / dois-je / should I » investir / acheter
  if (
    /\b(faut[- ]il|dois[- ]je|devrais[- ]je|est[- ]ce\s+que\s+je\s+(dois|devrais)|should\s+i)\b.{0,40}\b(investir|acheter|vendre|placer)\b/.test(
      t,
    )
  ) {
    return true;
  }

  // « donne-moi la meilleure stratégie sur X » (ticker / ticker-like)
  if (
    /\b(donn(e|es|ez)[- ]?moi|trouve[- ]?moi|quelle\s+est)\b.{0,40}\b(meilleure?|bon(ne)?)\b.{0,40}\bstrateg/.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}
