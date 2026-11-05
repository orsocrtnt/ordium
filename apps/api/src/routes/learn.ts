import type { FastifyInstance } from "fastify";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { INVESTMENT_ADVICE_REFUSAL, isInvestmentAdviceRequest } from "@ordium/engine";

type ChatHistoryItem = { role: "user" | "assistant"; text: string };

type Topic =
  | "rsi"
  | "macd"
  | "bollinger"
  | "sma"
  | "ema"
  | "alligator"
  | "stochastic"
  | "atr"
  | "adx"
  | "ichimoku"
  | "fibonacci"
  | "vwap"
  | "cci"
  | "williams"
  | "obv"
  | "supertrend"
  | "parabolic-sar"
  | "fear-greed";

type TopicDef = {
  id: Topic;
  label: string;
  detect: RegExp;
  blurb: string;
  oneLiner: string;
  explain: string;
  calc: string;
  followUp: string;
};

function geminiModelCandidates(): string[] {
  const preferred = process.env.GEMINI_MODEL?.trim();
  const defaults = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-flash-lite-latest",
    "gemini-2.0-flash",
  ];
  return preferred ? [preferred, ...defaults.filter((m) => m !== preferred)] : defaults;
}

function normalizeFr(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const TOPIC_DEFS: TopicDef[] = [
  {
    id: "rsi",
    label: "RSI",
    detect: /\brsi\b/,
    blurb: "le RSI mesure le rythme récent du prix (montée/baisse trop rapide), sur un score de 0 à 100",
    oneLiner: "• RSI : score 0–100 qui mesure le rythme du prix (trop monté / trop baissé récemment).",
    explain:
      "Le RSI, c’est un score qui mesure le rythme du prix. En gros : est-ce que ça vient de monter trop vite, ou de baisser trop vite ? Ça aide à sentir si le marché est un peu “échauffé” ou un peu “vidé”, mais ça ne prédit pas demain.",
    calc: "En gros : on regarde les hausses et les baisses récentes du prix, souvent sur 14 périodes. On compare “force moyenne des hausses” vs “force moyenne des baisses”, puis on transforme ça en un score entre 0 et 100. Haut = ça a monté fort récemment. Bas = ça a baissé fort.",
    followUp:
      "OK, plus simple : le RSI, c’est juste un score entre 0 et 100 qui dit si le prix a trop grimpé ou trop chuté récemment. Haut = ça a monté fort. Bas = ça a baissé fort. C’est un thermomètre du rythme, pas une boule de cristal.",
  },
  {
    id: "macd",
    label: "MACD",
    detect: /\bmacd\b/,
    blurb: "le MACD regarde plutôt si le mouvement accélère ou ralentit",
    oneLiner: "• MACD : regarde si le mouvement accélère ou ralentit.",
    explain:
      "Le MACD sert surtout à lire le momentum : est-ce que le mouvement du prix gagne en force ou la perd. C’est utile pour sentir un changement de rythme, mais ça peut aussi se tromper quand le marché hésite.",
    calc: "En gros : on compare une moyenne rapide du prix et une moyenne plus lente. Quand la rapide s’éloigne de la lente, ça montre que le mouvement accélère. Quand elles se rapprochent, ça ralentit. L’histogramme, c’est juste une façon visuelle de voir cet écart.",
    followUp:
      "Plus simple : le MACD regarde si le mouvement accélère ou ralentit. Genre : “oui ça monte, mais est-ce que ça monte de plus en plus fort, ou ça fatigue ?”",
  },
  {
    id: "bollinger",
    label: "Bollinger",
    detect: /bollinger|bandes? de boll/,
    blurb: "Bollinger dessine un couloir autour du prix pour voir s’il reste dans sa zone habituelle",
    oneLiner: "• Bollinger : un couloir autour du prix, pour voir s’il reste dans sa zone habituelle.",
    explain:
      "Les bandes de Bollinger, c’est comme un couloir autour du prix. Elles montrent si le prix reste dans sa zone habituelle, ou s’il commence à trop s’en éloigner. Pas un signal magique d’achat/vente : juste un repère visuel.",
    calc: "En gros : on met une moyenne du prix au milieu, puis une bande au-dessus et une bande en dessous selon à quel point le prix bouge en ce moment. Si le marché est nerveux, le couloir s’élargit. S’il est calme, le couloir se resserre. Donc ce n’est pas magique : c’est juste moyenne + volatilité récente.",
    followUp:
      "En vrai simple : Bollinger, c’est un couloir autour du prix. Au milieu = zone habituelle. Trop haut ou trop bas = le prix s’éloigne de ce qu’il faisait récemment. Ça sert à voir si le marché est calme ou un peu trop tendu.",
  },
  {
    id: "alligator",
    label: "Alligator",
    detect: /\balligator\b|moyenne mobile alligator|moyennes mobiles alligator/,
    blurb: "l’Alligator utilise 3 moyennes décalées pour lire si le marché dort, se réveille, ou digère une tendance",
    oneLiner: "• Alligator : 3 moyennes décalées pour voir si le marché dort, se réveille, ou suit une tendance.",
    explain:
      "L’Alligator (Williams), c’est 3 moyennes mobiles décalées — mâchoire, dents, lèvres. Quand elles sont entrelacées, le marché “dort”. Quand elles s’écartent, une tendance se met en place. Ce n’est pas une moyenne simple : c’est un outil de lecture de tendance.",
    calc: "En gros : trois moyennes (souvent 13, 8 et 5 périodes), chacune décalée dans le futur. On regarde surtout leur écartement et leur ordre, plus que leur valeur absolue.",
    followUp:
      "Plus simple : imagine 3 lignes qui s’enroulent = marché calme. Elles s’ouvrent comme une gueule = une tendance démarre. L’Alligator sert à ça : sentir le “sommeil” vs le “réveil” du marché.",
  },
  {
    id: "ema",
    label: "EMA",
    detect: /\bema\b|moyenne (mobile )?exponentielle|exponential moving/,
    blurb: "l’EMA est une moyenne qui donne plus de poids aux prix récents, donc elle réagit plus vite qu’une SMA",
    oneLiner: "• EMA : moyenne qui privilégie les prix récents, donc plus réactive qu’une SMA.",
    explain:
      "L’EMA (moyenne mobile exponentielle), c’est comme une SMA, mais elle donne plus de poids aux prix récents. Résultat : elle réagit plus vite aux changements. Utile pour suivre une tendance sans être trop “en retard”.",
    calc: "En gros : chaque nouveau prix compte davantage que les anciens. On applique un coefficient (selon la période), donc la ligne bouge plus vite qu’une moyenne simple.",
    followUp:
      "Plus simple : EMA = moyenne “qui écoute surtout le présent”. SMA = moyenne “qui traite tous les jours pareil”. L’EMA bouge plus vite.",
  },
  {
    id: "sma",
    label: "SMA",
    detect: /\bsma\b|\bmsa\b|moyenne mobile simple|moyenne glissante|moyenne mobile(?!s?\s+alligator)/,
    blurb: "la SMA lisse le prix pour mieux voir la tendance générale",
    oneLiner: "• SMA : moyenne des derniers prix, pour lisser et mieux voir la tendance.",
    explain:
      "La SMA (moyenne mobile simple), c’est une moyenne des derniers prix. Elle lisse le graphique pour mieux voir la tendance. Une SMA courte réagit vite ; une SMA longue est plus lente mais plus stable.",
    calc: "Très simple : on prend les derniers prix sur une période (ex. 20 jours), on les additionne, on divise par le nombre de jours. Chaque jour a le même poids. Résultat = une ligne plus lisse que le prix brut.",
    followUp:
      "Plus simple : une SMA, c’est juste la moyenne des derniers prix. Genre “où était le prix en moyenne ces derniers jours ?”. Ça calme le bruit du graphique pour mieux voir la tendance.",
  },
  {
    id: "stochastic",
    label: "Stochastique",
    detect: /\bstochast/,
    blurb: "le Stochastique compare le prix actuel à sa fourchette récente, pour sentir s’il est haut ou bas dans cette zone",
    oneLiner: "• Stochastique : compare le prix à sa fourchette récente (haut/bas de la zone).",
    explain:
      "Le Stochastique regarde où se situe le prix actuel dans sa fourchette récente (plus haut / plus bas). Haut dans la fourchette = plutôt “tendu vers le haut”. Bas = plutôt “tendu vers le bas”. C’est un outil de rythme, pas une prédiction.",
    calc: "En gros : on compare le cours de clôture à l’écart entre le plus haut et le plus bas sur une période, puis on lisse un peu le résultat. Score souvent entre 0 et 100.",
    followUp:
      "Plus simple : “est-ce que le prix est plutôt en haut ou en bas de ce qu’il a fait ces derniers jours ?” C’est l’idée du Stochastique.",
  },
  {
    id: "atr",
    label: "ATR",
    detect: /\batr\b|average true range|amplitude (moyenne|vraie)/,
    blurb: "l’ATR mesure l’amplitude des mouvements (la “taille” des bougies), pas la direction",
    oneLiner: "• ATR : mesure l’amplitude des mouvements (volatilité), pas la direction.",
    explain:
      "L’ATR mesure à quel point le prix bouge, pas s’il monte ou baisse. ATR élevé = marché nerveux, grandes variations. ATR bas = marché calme. Utile pour dimensionner un stop ou sentir la volatilité.",
    calc: "En gros : on regarde l’amplitude vraie de chaque période (haut-bas, en tenant compte des gaps), puis on moyenne ça. Le résultat = une taille de mouvement typique récente.",
    followUp:
      "Plus simple : ATR = “à quel point ça secoue en ce moment ?”. Pas “dans quel sens ça va”.",
  },
  {
    id: "adx",
    label: "ADX",
    detect: /\badx\b/,
    blurb: "l’ADX mesure la force d’une tendance, pas son sens (hausse ou baisse)",
    oneLiner: "• ADX : mesure la force d’une tendance (pas si c’est haussier ou baissier).",
    explain:
      "L’ADX ne dit pas si ça monte ou ça baisse : il dit si la tendance est forte ou faible. ADX haut = tendance claire. ADX bas = marché sans direction nette (range).",
    calc: "En gros : on combine des mesures de pression haussière et baissière, puis on en tire un score de “force de tendance”. Plus le score est haut, plus le marché “tire” dans une direction.",
    followUp:
      "Plus simple : ADX = thermomètre de “y a-t-il vraiment une tendance ?”. Pas un thermomètre de direction.",
  },
  {
    id: "ichimoku",
    label: "Ichimoku",
    detect: /\bichimoku\b|nuage (ichimoku|kumo)/,
    blurb: "Ichimoku est un tableau de bord : tendance, supports/résistances et momentum dans un même “nuage”",
    oneLiner: "• Ichimoku : nuage + lignes pour lire tendance, supports et momentum d’un coup.",
    explain:
      "Ichimoku, c’est un pack : plusieurs lignes + un “nuage”. Ça sert à lire d’un coup la tendance, les zones de support/résistance, et un peu le momentum. Dense au début, très visuel une fois habitué.",
    calc: "En gros : plusieurs moyennes / milieux de fourchettes sur des périodes différentes, dont certaines décalées. Le nuage (Kumo) est la zone entre deux de ces lignes.",
    followUp:
      "Plus simple : Ichimoku = une carte complète du marché. Le nuage te dit surtout “au-dessus = plutôt tendance haussière, en dessous = plutôt baissière” — en version très vulgarisée.",
  },
  {
    id: "fibonacci",
    label: "Fibonacci",
    detect: /\bfibo(nacci)?\b|retracement/,
    blurb: "Fibonacci trace des niveaux de retracement pour repérer des zones où le prix a souvent réagi",
    oneLiner: "• Fibonacci : niveaux de retracement pour repérer des zones de réaction fréquentes.",
    explain:
      "Les retracements de Fibonacci, ce sont des niveaux tracés entre un point bas et un point haut (ou l’inverse). L’idée : le prix “reprend son souffle” souvent autour de certains ratios. Ce sont des zones possibles, pas des murs magiques.",
    calc: "En gros : on prend un swing (bas→haut ou haut→bas), on applique des ratios (38,2 %, 50 %, 61,8 %…), et on obtient des lignes horizontales sur le graphique.",
    followUp:
      "Plus simple : tu traces l’escalier d’une grosse montée (ou descente), puis tu marques où le prix pourrait faire une pause en redescendant (ou remontant).",
  },
  {
    id: "vwap",
    label: "VWAP",
    detect: /\bvwap\b/,
    blurb: "le VWAP est le prix moyen pondéré par le volume, souvent utilisé comme référence intraday",
    oneLiner: "• VWAP : prix moyen pondéré par le volume (référence surtout intraday).",
    explain:
      "Le VWAP, c’est le prix moyen de la séance, pondéré par les volumes. Au-dessus du VWAP = les échanges se font plutôt “chers” vs la moyenne du jour. En dessous = plutôt “moins chers”. Très utilisé en intraday.",
    calc: "En gros : (prix × volume) cumulés / volume cumulé, depuis le début de la séance (ou de la période choisie).",
    followUp:
      "Plus simple : VWAP = “le prix moyen réellement payé aujourd’hui, en tenant compte de combien ça a été échangé”.",
  },
  {
    id: "cci",
    label: "CCI",
    detect: /\bcci\b|commodity channel/,
    blurb: "le CCI mesure l’écart du prix par rapport à sa moyenne, pour sentir les extrêmes",
    oneLiner: "• CCI : écart du prix vs sa moyenne, pour repérer des extrêmes.",
    explain:
      "Le CCI regarde si le prix s’éloigne beaucoup de sa moyenne habituelle. Très haut ou très bas = le mouvement est “hors norme” par rapport au comportement récent. Encore une fois : rythme / extrême, pas prédiction.",
    calc: "En gros : on compare le prix typique à une moyenne, on divise par une mesure de dispersion, et on obtient un oscillateur qui peut sortir largement de −100 / +100.",
    followUp:
      "Plus simple : CCI = “est-ce que le prix est anormalement loin de sa zone habituelle ?”",
  },
  {
    id: "williams",
    label: "%R Williams",
    detect: /williams\s*%?\s*r|\b%r\b|williams percent/,
    blurb: "le %R Williams ressemble au Stochastique : il situe le prix dans sa fourchette récente",
    oneLiner: "• %R Williams : situe le prix dans sa fourchette récente (proche du Stochastique).",
    explain:
      "Le Williams %R, c’est un cousin du Stochastique : il place le prix dans sa fourchette récente. Proche de 0 = plutôt en haut de la fourchette. Proche de −100 = plutôt en bas.",
    calc: "En gros : (plus haut de la période − clôture) / (plus haut − plus bas), puis on met ça sur une échelle négative. Même famille d’idée que le Stochastique.",
    followUp:
      "Plus simple : même question que le Stochastique — “haut ou bas de la fourchette récente ?” — avec une échelle un peu différente.",
  },
  {
    id: "obv",
    label: "OBV",
    detect: /\bobv\b|on[- ]?balance volume/,
    blurb: "l’OBV cumule le volume selon que le prix monte ou baisse, pour lire la pression d’achat/vente",
    oneLiner: "• OBV : cumule le volume selon les hausses/baisses pour lire la pression.",
    explain:
      "L’OBV additionne le volume les jours de hausse et le soustrait les jours de baisse. L’idée : voir si le volume “confirme” le mouvement du prix. Utile comme confirmation, pas comme signal unique.",
    calc: "Très simple : prix en hausse → on ajoute le volume du jour. Prix en baisse → on l’enlève. On obtient une courbe cumulative.",
    followUp:
      "Plus simple : OBV = “est-ce que le volume suit le mouvement, ou est-ce que ça monte/baisse à vide ?”",
  },
  {
    id: "supertrend",
    label: "Supertrend",
    detect: /\bsupertrend\b|super trend/,
    blurb: "le Supertrend est une ligne de tendance basée sur l’ATR, souvent utilisée comme filtre de direction",
    oneLiner: "• Supertrend : ligne de tendance basée sur l’ATR (filtre de direction).",
    explain:
      "Le Supertrend dessine une ligne sous le prix en tendance haussière, et au-dessus en tendance baissière. Il s’appuie sur l’ATR (volatilité). C’est un filtre de direction simple, pas une garantie.",
    calc: "En gros : on part d’une moyenne / milieu de bougie, on ajoute ou retire un multiple de l’ATR, et on “colle” la ligne selon le sens de la tendance.",
    followUp:
      "Plus simple : Supertrend = une ligne qui te dit “plutôt au-dessus = biais haussier, plutôt en dessous = biais baissier”, en s’adaptant à la volatilité.",
  },
  {
    id: "parabolic-sar",
    label: "Parabolic SAR",
    detect: /parabolic|parabole sar|\bsar\b/,
    blurb: "le Parabolic SAR place des points sous/au-dessus du prix pour suivre une tendance et suggérer des retournements",
    oneLiner: "• Parabolic SAR : points sous/au-dessus du prix pour suivre une tendance.",
    explain:
      "Le Parabolic SAR place des points sous le prix (biais haussier) ou au-dessus (biais baissier). Quand les points passent de l’autre côté, ça signale un possible retournement. Très visuel, parfois nerveux en range.",
    calc: "En gros : le point “accélère” dans le sens de la tendance selon un facteur. Quand le prix croise le point, le SAR bascule de l’autre côté.",
    followUp:
      "Plus simple : des points sous le prix = ça “soutient” la hausse ; au-dessus = ça “plafonne” la baisse. Le bascule des points = possible changement de sens.",
  },
  {
    id: "fear-greed",
    label: "Fear & Greed",
    detect: /fear|greed|euphorie|(peur.*(cupid|euphor|calcul))/,
    blurb: "le Fear & Greed donne surtout une lecture d’ambiance (peur / euphorie), surtout utile en crypto",
    oneLiner: "• Fear & Greed : thermomètre d’ambiance (peur / euphorie), surtout utile en crypto.",
    explain:
      "Le Fear & Greed, c’est surtout un thermomètre d’ambiance : est-ce que le marché a plutôt peur, ou plutôt trop confiance ? Super utile en crypto pour sentir le climat, mais jamais à prendre seul.",
    calc: "Bonne question. En vrai, ce n’est pas “peur” et “euphorie” calculées magiquement. On mélange plusieurs signaux d’ambiance (momentum, volatilité, flux, sentiment…), puis on en fait un score. Bas = le marché a plutôt peur. Haut = il est plutôt euphorique. C’est un thermomètre composé, pas une vérité absolue.",
    followUp:
      "Plus simple : Fear & Greed, c’est un thermomètre d’ambiance. Bas = peur. Haut = euphorie. Utile pour sentir le climat, surtout en crypto, mais pas pour décider tout seul.",
  },
];

const TOPIC_BY_ID = Object.fromEntries(TOPIC_DEFS.map((t) => [t.id, t])) as Record<Topic, TopicDef>;
const TOPIC_LABELS = Object.fromEntries(TOPIC_DEFS.map((t) => [t.id, t.label])) as Record<Topic, string>;

const FILLER_WORDS = new Set([
  "ok", "donne", "moi", "me", "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux",
  "et", "ou", "entre", "vs", "versus", "lequel", "laquelle", "quel", "quelle", "quels", "quelles",
  "meilleur", "meilleure", "mieux", "plus", "pertinent", "utile", "performant", "choisir",
  "explique", "expliquer", "explication", "cest", "quoi", "comment", "marche", "fonctionne",
  "calcul", "calcule", "dis", "parle", "presente", "montre", "veux", "voudrais", "peux", "peut",
  "tu", "je", "on", "ca", "ce", "cet", "cette", "ces", "son", "sa", "ses", "ton", "ta", "tes",
  "indicateur", "indicateurs", "technique", "techniques", "aussi", "puis", "ensuite", "apres",
  "avant", "avec", "sans", "pour", "dans", "sur", "par", "pas", "plus", "tres", "bien", "juste",
  "simple", "simplement", "version", "mieux", "avis", "penses", "selon", "recommande", "preferer",
  "preferes", "svp", "stp", "please", "merci", "bonjour", "salut", "hey", "hello",
]);

function detectAllTopicsInText(text: string): Topic[] {
  const q = normalizeFr(text);
  const found: { topic: Topic; index: number }[] = [];

  for (const def of TOPIC_DEFS) {
    const m = q.match(def.detect);
    if (m && m.index != null && !found.some((f) => f.topic === def.id)) {
      found.push({ topic: def.id, index: m.index });
    }
  }

  // "moyenne mobile" seule (sans alligator / exponentielle) → SMA
  if (!found.some((f) => f.topic === "sma" || f.topic === "alligator" || f.topic === "ema")) {
    const m = q.match(/moyenne mobile|moyenne glissante/);
    if (m && m.index != null) found.push({ topic: "sma", index: m.index });
  }

  return found.sort((a, b) => a.index - b.index).map((f) => f.topic);
}

function detectTopicInText(text: string): Topic | null {
  return detectAllTopicsInText(text)[0] ?? null;
}

function stripKnownTopics(text: string): string {
  let q = normalizeFr(text);
  for (const def of TOPIC_DEFS) {
    q = q.replace(def.detect, " ");
  }
  q = q
    .replace(/moyenne mobile|moyenne glissante/g, " ")
    .replace(/[?!.,:;()/+\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return q;
}

function leftoverSignificantTokens(prompt: string): string[] {
  return stripKnownTopics(prompt)
    .split(/\s+/)
    .map((w) => w.trim().replace(/'/g, ""))
    .filter((w) => w.length >= 3 && !FILLER_WORDS.has(w) && !/^\d+$/.test(w));
}

/** Demande qui semble porter sur un indicateur hors bibliothèque locale. */
function hasUnknownIndicator(prompt: string): boolean {
  const known = detectAllTopicsInText(prompt);
  const leftovers = leftoverSignificantTokens(prompt);
  if (leftovers.length === 0) return false;

  // Sujets connus + reste non significatif → rester en local
  // (ex. "c'est quoi le supertrend" ne doit pas partir sur Gemini)
  if (known.length > 0 && leftovers.every((w) => w.length < 4)) return false;

  const q = normalizeFr(prompt);
  const looksLikeIndicatorAsk =
    isExplainRequest(prompt) ||
    isOpinionOrComparison(prompt) ||
    /\bindicateur\b/.test(q) ||
    leftovers.some((w) => /^[a-z][a-z0-9-]{2,}$/.test(w));

  return looksLikeIndicatorAsk;
}

function isExplainRequest(prompt: string): boolean {
  const q = normalizeFr(prompt);
  return (
    q.includes("explique") ||
    q.includes("c'est quoi") ||
    q.includes("cest quoi") ||
    q.includes("qu'est ce") ||
    q.includes("quest ce") ||
    q.includes("qu est ce") ||
    q.includes("a quoi sert") ||
    q.includes("ca sert a quoi") ||
    q.includes("dis moi") ||
    q.includes("dis-moi") ||
    q.includes("parle moi") ||
    q.includes("presente") ||
    q.includes("c est quoi")
  );
}

function stripTopicKeywords(text: string): string {
  return stripKnownTopics(text);
}

function isBareIndicatorFragment(text: string): boolean {
  const topics = detectAllTopicsInText(text);
  if (topics.length !== 1) return false;

  const stripped = stripTopicKeywords(text)
    .replace(/^(et|aussi|puis|ensuite|moi|ca|celui|celle|le|la|les|un|une)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return stripped.length === 0;
}

function isImplicitMultiExplain(prompt: string): boolean {
  const topics = detectAllTopicsInText(prompt);
  if (topics.length < 2) return false;
  if (isExplainRequest(prompt)) return true;

  const leftover = stripTopicKeywords(prompt)
    .replace(/^(explique|moi|dis|parle|presente|et|aussi|puis|ensuite)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return leftover.length <= 12;
}

function mergeTopicsInOrder(parts: string[]): Topic[] {
  const merged: Topic[] = [];
  for (const part of parts) {
    for (const topic of detectAllTopicsInText(part)) {
      if (!merged.includes(topic)) merged.push(topic);
    }
  }
  return merged;
}

function explainSeveralTopics(topics: Topic[]): string {
  const lines = topics.map((t) => TOPIC_BY_ID[t].oneLiner);
  return `OK, en version simple :\n${lines.join("\n")}\nSi tu veux, on peut zoomer sur l’un d’eux.`;
}

function lastTopicFromHistory(history: ChatHistoryItem[]): Topic | null {
  for (const m of [...history].reverse()) {
    const t = detectTopicInText(m.text);
    if (t) return t;
  }
  return null;
}

function knownIndicatorsList(): string {
  return "RSI, MACD, Bollinger, SMA, EMA, Alligator, Stochastique, ATR, ADX, Ichimoku, Fibonacci, VWAP, CCI, %R Williams, OBV, Supertrend, Parabolic SAR et Fear & Greed";
}

function isMetaQuestion(prompt: string): boolean {
  const q = normalizeFr(prompt);
  return (
    q.includes("quel indicateur") ||
    q.includes("quels indicateurs") ||
    q.includes("tu fonctionne") ||
    q.includes("tu fonctionnes") ||
    q.includes("avec quel") ||
    q.includes("tu connais quoi") ||
    q.includes("de quoi tu parles") ||
    q.includes("c'est quoi tes indicateurs")
  );
}

function wantsOtherIndicators(prompt: string): boolean {
  const q = normalizeFr(prompt);
  return (
    q.includes("quoi d'autre") ||
    q.includes("quoi d autre") ||
    q.includes("autre indicateur") ||
    q.includes("autres indicateur") ||
    q.includes("tu proposes") ||
    q.includes("tu me proposes") ||
    q.includes("propose moi") ||
    q.includes("proposes moi") ||
    q.includes("autre chose") ||
    q.includes("et ensuite") ||
    q.includes("et apres") ||
    q.includes("d'autres") ||
    q.includes("d autres")
  );
}

function isOpinionOrComparison(prompt: string): boolean {
  const q = normalizeFr(prompt);
  return (
    q.includes("plus pertinent") ||
    q.includes("plus utile") ||
    q.includes("plus performant") ||
    q.includes("meilleur") ||
    q.includes("mieux que") ||
    q.includes("vs") ||
    q.includes("versus") ||
    q.includes("par rapport") ||
    q.includes("tu penses") ||
    q.includes("ton avis") ||
    q.includes("selon toi") ||
    q.includes("lequel choisir") ||
    q.includes("lequel est") ||
    q.includes("c'est mieux") ||
    q.includes("cest mieux") ||
    q.includes("mieux le") ||
    q.includes("mieux ou") ||
    q.includes("ou mieux") ||
    (q.includes("mieux") && (q.includes(" ou ") || detectAllTopicsInText(prompt).length > 0)) ||
    q.includes("preferer") ||
    q.includes("recommande")
  );
}

function refuseOpinionThenExplain(prompt: string, history: ChatHistoryItem[]): string {
  const mentioned = detectAllTopicsInText(prompt);
  const previous = lastTopicFromHistory(history);
  const topics =
    mentioned.length > 0 ? mentioned : previous ? [previous] : ([] as Topic[]);

  const disclaimer =
    "Je ne donne pas mon avis sur quel indicateur est “le meilleur” ou le plus performant : je ne suis pas un conseiller en investissement.";

  if (topics.length >= 2) {
    const parts = topics.map((t) => TOPIC_BY_ID[t].blurb);
    return `${disclaimer} En revanche, je peux te dire à quoi chacun sert : ${parts.join(" ; ")}. Ce sont des angles différents, pas un classement.`;
  }

  if (topics.length === 1) {
    const only = topics[0]!;
    return `${disclaimer} Ce que je peux te dire : ${TOPIC_BY_ID[only].blurb}. Si tu veux, je te l’explique plus simplement.`;
  }

  return `${disclaimer} Je peux t’expliquer plein d’indicateurs (${knownIndicatorsList()}), sans te dire lequel “marcherait mieux”. Et si tu cites un indicateur que je n’ai pas en local, je peux quand même te l’expliquer.`;
}

function isFollowUp(prompt: string): boolean {
  const q = normalizeFr(prompt);
  if (wantsOtherIndicators(prompt) || isMetaQuestion(prompt) || isOpinionOrComparison(prompt)) {
    return false;
  }
  return (
    q.includes("c'est a dire") ||
    q.includes("cest a dire") ||
    q.includes("ca veut dire") ||
    q.includes("explique moi mieux") ||
    q.includes("explique mieux") ||
    q.includes("tu peux simplif") ||
    q.includes("simplifie") ||
    q.includes("je ne comprend") ||
    q.includes("j'comprend") ||
    q.includes("j comprend") ||
    q.includes("zone normale") ||
    q.includes("comment c'est calcul") ||
    q.includes("comment ca marche") ||
    q.includes("comment ca fonctionne") ||
    q.includes("il se calcul") ||
    q.includes("il se calcule") ||
    q.includes("elle se calcul") ||
    q.includes("elle se calcule") ||
    q.includes("ca se calcul") ||
    q.includes("ca se calcule") ||
    q.includes("comment on calcul") ||
    q.includes("comment on calcule") ||
    q.includes("comment le calcul") ||
    q.includes("comment le calcule") ||
    q.includes("et ca") ||
    q.includes("et bollinger") ||
    q.startsWith("et ") ||
    q.includes("sur quelle base") ||
    q.includes("plus simple") ||
    q.includes("peur") ||
    q.includes("euphorie") ||
    /^(et )?(il|elle|ca)\b/.test(q) ||
    /\bcalcul/.test(q) ||
    /\bmais\b/.test(q)
  );
}

function wantsCalculation(prompt: string): boolean {
  const q = normalizeFr(prompt);
  return (
    q.includes("calcul") ||
    q.includes("base") ||
    q.includes("comment ca marche") ||
    q.includes("comment ca fonctionne") ||
    q.includes("comment on fait") ||
    q.includes("peur") ||
    q.includes("euphorie")
  );
}

function resolveTopic(prompt: string, history: ChatHistoryItem[]): Topic | null {
  if (wantsOtherIndicators(prompt) || isMetaQuestion(prompt) || isOpinionOrComparison(prompt)) {
    return null;
  }
  const current = detectTopicInText(prompt);
  if (current) return current;
  if (isBareIndicatorFragment(prompt)) return detectAllTopicsInText(prompt)[0] ?? null;
  if (isFollowUp(prompt)) return lastTopicFromHistory(history);
  return null;
}

function suggestOtherIndicators(current: Topic | null): string {
  const pool = TOPIC_DEFS.filter((t) => t.id !== current).slice(0, 5);
  const names = pool.map((t) => t.label);
  const list = names.slice(0, -1).join(", ");
  const last = names[names.length - 1];
  return `À côté de ça, tu peux aussi regarder ${list}, ou ${last} — et plein d’autres. Dis-moi lequel t’intéresse, même un que je n’ai pas listé : je peux te l’expliquer.`;
}

function topicContextBlock(topic: Topic | null, prompt: string): string {
  const topics = topic
    ? [topic]
    : detectAllTopicsInText(prompt);
  if (topics.length === 0) {
    return "Aucun sujet local détecté : réponds quand même à la question posée (tu peux expliquer n’importe quel indicateur).";
  }
  const blocks = topics.map((id) => {
    const d = TOPIC_BY_ID[id];
    return `### ${d.label}
À quoi ça sert (rappel) : ${d.blurb}
Calcul (rappel) : ${d.calc}
Intro simple (rappel) : ${d.explain}`;
  });
  return `Fiches locales (aide-mémoire — adapte-toi à LA question, ne recopie pas tel quel) :\n${blocks.join("\n\n")}`;
}

function recentAssistantSnippets(history: ChatHistoryItem[]): string {
  return history
    .filter((m) => m.role === "assistant")
    .slice(-3)
    .map((m) => m.text.slice(0, 220).replace(/\s+/g, " "))
    .join(" || ");
}

async function explainWithGemini(
  prompt: string,
  history: ChatHistoryItem[],
  topic: Topic | null,
): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("no-gemini");

  const genAI = new GoogleGenerativeAI(key);
  const topicHint = topic
    ? `Sujet courant probable : ${TOPIC_BY_ID[topic]?.label ?? topic}. Priorise ce sujet sauf si l’utilisateur en change clairement.`
    : "Aucun sujet unique détecté : suis la question telle quelle.";

  const system = `Tu es Ordium, un pote pédagogue ultra conversationnel.
Tu parles comme en vrai : naturel, vivant, précis — pas une fiche Wikipedia, pas un robot.

${topicHint}

MISSION :
- Comprendre EXACTEMENT la question (calcul, intuition, comparaison pédagogique, exemple chiffré, “plus simple”, etc.).
- Y répondre directement, point par point si besoin.
- Si la question est précise (« comment le RSI est-il calculé ? », « c’est quoi la zone 30 ? »), donne une réponse précise — pas un blabla générique.
- Tu peux expliquer N’IMPORTE QUEL indicateur technique, même hors bibliothèque.

INTERDICTIONS :
- JAMAIS de conseil en investissement, de “meilleure stratégie”, de “tu devrais acheter/vendre”.
- JAMAIS recommander un actif, un timing, ou un setup “idéal”.
- Si on te demande quel indicateur est “le meilleur / plus pertinent / plus performant” : refuse l’avis, puis explique simplement à quoi sert chaque indicateur cité (sans classement).
- Ne répète PAS une réponse déjà donnée dans l’historique : apporte un angle nouveau, un exemple, ou un détail manquant.

STYLE :
- Tutoiement, oral, clair. 4 à 12 phrases selon la précision demandée.
- Jargon seulement si tu l’expliques juste après.
- “MSA” = probablement “SMA”. “Moyenne mobile alligator” = Alligator de Williams.
- Tu peux finir par une courte question ouverte (“tu veux un mini exemple chiffré ?”) — une seule, pas à chaque message si l’historique en a déjà une.`;

  const transcript = history
    .slice(-12)
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Ordium"}: ${m.text}`)
    .join("\n");
  const alreadySaid = recentAssistantSnippets(history);

  let lastErr: unknown;
  for (const modelId of geminiModelCandidates()) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: system,
        generationConfig: { temperature: 0.55, maxOutputTokens: 900 },
      });
      const result = await model.generateContent(
        [
          topicContextBlock(topic, prompt),
          transcript ? `\nHistorique récent :\n${transcript}` : "",
          alreadySaid
            ? `\nÀ ne pas reformuler à l’identique (déjà dit) : ${alreadySaid}`
            : "",
          `\nQuestion actuelle (réponds à celle-ci en priorité) :\n${prompt}`,
          "\nRéponds naturellement, en collant à la question :",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      const text = result.response.text().trim();
      if (text) return text;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Gemini indisponible.");
}

function splitPromptIntoQuestions(prompt: string): string[] {
  const trimmed = prompt.trim();
  if (!trimmed) return [];

  const byQuestionMark = trimmed
    .split(/\?+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (byQuestionMark.length > 1) {
    const trailingAreBare = byQuestionMark.slice(1).every(
      (part) =>
        isBareIndicatorFragment(part) ||
        (detectAllTopicsInText(part).length > 0 && !isFollowUp(part) && !wantsCalculation(part)),
    );
    const firstIsExplain = isExplainRequest(byQuestionMark[0]!) || isImplicitMultiExplain(trimmed);

    if (firstIsExplain && trailingAreBare) {
      return [trimmed.replace(/\?+/g, " ").replace(/\s+/g, " ").trim()];
    }

    return byQuestionMark;
  }

  const byLine = trimmed
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (byLine.length > 1) {
    const allBareOrExplain = byLine.every(
      (part) =>
        isBareIndicatorFragment(part) ||
        isExplainRequest(part) ||
        detectAllTopicsInText(part).length > 0,
    );
    if (allBareOrExplain && mergeTopicsInOrder(byLine).length >= 2) {
      return [byLine.join(" ")];
    }
    return byLine;
  }

  const byConnector = trimmed
    .split(/\s+(?:et|puis|aussi|ensuite)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (
    byConnector.length > 1 &&
    byConnector.filter((p) => detectAllTopicsInText(p).length > 0).length >= 2
  ) {
    const allSimple = byConnector.every(
      (part) =>
        isBareIndicatorFragment(part) ||
        isExplainRequest(part) ||
        detectAllTopicsInText(part).length > 0,
    );
    if (allSimple && !byConnector.some((part) => wantsCalculation(part) || isFollowUp(part))) {
      return [byConnector.join(" ")];
    }
    return byConnector;
  }

  return [trimmed];
}

function formatQuestionLabel(question: string): string {
  const topics = detectAllTopicsInText(question);
  if (topics.length === 1) return TOPIC_LABELS[topics[0]!];
  if (topics.length >= 2) return topics.map((t) => TOPIC_LABELS[t]).join(" + ");

  const cleaned = question.replace(/\?+$/, "").trim();
  if (cleaned.length <= 40) return cleaned;
  return cleaned.slice(0, 37) + "…";
}

function answerOneQuestion(prompt: string, history: ChatHistoryItem[]): string {
  const q = normalizeFr(prompt);
  if (isInvestmentAdviceRequest(prompt)) return INVESTMENT_ADVICE_REFUSAL;
  const lastTopic = lastTopicFromHistory(history);
  const mentionedTopics = detectAllTopicsInText(prompt);

  if (isOpinionOrComparison(prompt)) {
    return refuseOpinionThenExplain(prompt, history);
  }

  if (mentionedTopics.length >= 2) {
    return explainSeveralTopics(mentionedTopics);
  }

  if (wantsOtherIndicators(prompt)) {
    return suggestOtherIndicators(lastTopic);
  }

  if (isMetaQuestion(prompt)) {
    return `Je peux t’expliquer surtout : ${knownIndicatorsList()}. Et si tu cites un autre indicateur, je peux aussi te l’expliquer simplement. Dis-moi lequel tu veux.`;
  }

  const topic = resolveTopic(prompt, history);
  if (!topic) {
    return `Je peux t’expliquer ${knownIndicatorsList()} — et d’autres si tu les nommes. Dis-moi juste lequel tu veux.`;
  }

  const def = TOPIC_BY_ID[topic];

  if (topic === "bollinger" && (q.includes("zone normale") || q.includes("c'est a dire") || q.includes("cest a dire"))) {
    return "Oui. “Zone normale”, pour moi, ça veut juste dire : l’endroit où le prix a l’habitude de bouger en ce moment. Imagine un couloir. Tant que le prix marche dedans, rien d’extraordinaire. S’il colle trop le plafond ou le sol du couloir, ça veut dire qu’il sort de son comportement récent habituel.";
  }

  if (topic === "sma" && q.includes("msa")) {
    return "Tu voulais sûrement dire SMA. Une SMA, c’est une moyenne mobile simple : on fait la moyenne des derniers prix pour lisser le graphique. Ça aide à voir la tendance générale, sans regarder chaque petit à-coup.";
  }

  if (wantsCalculation(prompt)) return def.calc;
  if (isFollowUp(prompt)) return def.followUp;
  return def.explain;
}

function fallbackExplain(prompt: string, history: ChatHistoryItem[]): string {
  const questions = splitPromptIntoQuestions(prompt);

  if (questions.length <= 1) {
    return answerOneQuestion(prompt, history);
  }

  const mergedTopics = mergeTopicsInOrder(questions);
  const allSimpleExplain =
    mergedTopics.length >= 2 &&
    questions.every(
      (part) =>
        isBareIndicatorFragment(part) ||
        isExplainRequest(part) ||
        (detectAllTopicsInText(part).length > 0 && !wantsCalculation(part) && !isFollowUp(part)),
    );

  if (allSimpleExplain) {
    return explainSeveralTopics(mergedTopics);
  }

  return questions
    .map((question, index) => {
      const answer = answerOneQuestion(question, history);
      const label = formatQuestionLabel(question);
      return `${index + 1}) ${label}\n${answer}`;
    })
    .join("\n\n");
}

/** Questions assez riches pour mériter une réponse conversationnelle (Gemini). */
function isPreciseOrConversationalAsk(prompt: string): boolean {
  const q = normalizeFr(prompt);
  if (wantsCalculation(prompt) || isFollowUp(prompt) || isExplainRequest(prompt)) return true;
  if (hasUnknownIndicator(prompt)) return true;
  if (/\b(comment|pourquoi|exemple|chiffre|formule|periode|periode|seuil|zone|niveau)\b/.test(q)) {
    return true;
  }
  // Phrase un peu développée (pas juste « RSI »)
  return q.split(/\s+/).filter(Boolean).length >= 4;
}

export async function learnRoutes(app: FastifyInstance) {
  app.post<{
    Body: { prompt?: string; history?: ChatHistoryItem[] };
  }>("/api/learn/explain", async (req, reply) => {
    try {
      const prompt = req.body?.prompt?.trim() ?? "";
      if (!prompt) {
        return reply.code(400).send({ error: "Question manquante." });
      }
      if (isInvestmentAdviceRequest(prompt)) {
        return { reply: INVESTMENT_ADVICE_REFUSAL, source: "fallback" as const };
      }
      const history = Array.isArray(req.body?.history) ? req.body.history : [];
      const topic = resolveTopic(prompt, history);

      // Avis / “meilleur indicateur” : refus local stable (pas de Gemini qui pourrait glisser).
      if (isOpinionOrComparison(prompt)) {
        return { reply: refuseOpinionThenExplain(prompt, history), source: "fallback" as const };
      }

      // Défaut produit : Gemini conversationnel (questions précises, calculs, relances…).
      // Fallback lexical uniquement si Gemini indisponible, ou pour un fragment ultra-court (« RSI »).
      const useLocalOnly =
        !isPreciseOrConversationalAsk(prompt) &&
        (isBareIndicatorFragment(prompt) ||
          isMetaQuestion(prompt) ||
          wantsOtherIndicators(prompt));

      if (!useLocalOnly) {
        try {
          const response = await explainWithGemini(prompt, history, topic);
          return { reply: response, source: "gemini" as const };
        } catch {
          return { reply: fallbackExplain(prompt, history), source: "fallback" as const };
        }
      }

      return { reply: fallbackExplain(prompt, history), source: "fallback" as const };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
