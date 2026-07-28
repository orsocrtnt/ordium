/**
 * Catalogue des stratégies du canvas Ordium, mappées aux réglages du formulaire v0.
 * Source de vérité pour le prompt NL et les chips UI.
 */

export type StrategyStatus = "ready" | "approx" | "later";

/** Champs du formulaire Smart DCA (miroir EditorState, sans allocation). */
export interface StrategyFormPatch {
  budgetAmount?: number;
  currency?: string;
  period?: "weekly" | "monthly";
  windowFrom?: number;
  windowTo?: number;
  tranches?: number;
  distribution?: "equal" | "random";
  regimeEnabled?: boolean;
  bullMult?: number;
  bearMult?: number;
  neutralMult?: number;
  regimeBandPct?: number;
  regimeSmaPeriod?: number;
  regimeReferenceAsset?: string;
  dipEnabled?: boolean;
  dipPct?: number;
  rsiEnabled?: boolean;
  rsiValue?: number;
  athEnabled?: boolean;
  athLookback?: number;
  reserveEnabled?: boolean;
  reservePct?: number;
  feePct?: number;
  ddTiersEnabled?: boolean;
  ddTiers?: { gtePct: number; factor: number }[];
  riseTiersEnabled?: boolean;
  riseTiers?: { gtePct: number; factor: number }[];
  tierLookback?: number;
  volEnabled?: boolean;
  volPeriod?: number;
  volMaxPct?: number;
  volMode?: "veto" | "scale";
  volScaleFactor?: number;
  extraBuysEnabled?: boolean;
  extraBuys?: {
    trigger: "rsi_below" | "dip";
    value: number;
    pctOfBudget: number;
    cooldownDays: number;
  }[];
}

export interface StrategyPreset {
  id: string;
  name: string;
  family: string;
  status: StrategyStatus;
  summary: string;
  keywords: string[];
  /** Patch appliqué si ready / approx. */
  patch?: StrategyFormPatch;
  /** Notes d’écart pour approx. */
  approxNote?: string;
  /** Pourquoi later, et alternatives ready. */
  laterReason?: string;
  suggestIds?: string[];
}

/** Page blanche : DCA classique sans timing / régime / indicateurs. */
export function classicOff(): StrategyFormPatch {
  return {
    regimeEnabled: false,
    dipEnabled: false,
    rsiEnabled: false,
    athEnabled: false,
    reserveEnabled: false,
    ddTiersEnabled: false,
    riseTiersEnabled: false,
    volEnabled: false,
    extraBuysEnabled: false,
    tranches: 1,
    distribution: "equal",
  };
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  /* —— ready (v0 moteur) —— */
  {
    id: "dca-classique",
    name: "DCA classique",
    family: "DCA & accumulation",
    status: "ready",
    summary: "Montant fixe à intervalle fixe, sans timing ni régime.",
    keywords: ["dca", "classique", "simple", "fixe", "régulier", "basique"],
    patch: classicOff(),
  },
  {
    id: "smart-dca",
    name: "Smart DCA (fenêtre + timing)",
    family: "DCA & accumulation",
    status: "ready",
    summary: "DCA dans une fenêtre, avec dip, RSI bas, éviter les sommets, fallback fin de fenêtre.",
    keywords: ["smart", "intelligent", "timing", "optimisé", "fenêtre"],
    patch: {
      regimeEnabled: true,
      bullMult: 0.7,
      bearMult: 1.5,
      dipEnabled: true,
      dipPct: 3,
      rsiEnabled: true,
      rsiValue: 40,
      athEnabled: true,
      athLookback: 90,
      reserveEnabled: true,
      reservePct: 10,
      tranches: 3,
      distribution: "equal",
    },
  },
  {
    id: "dca-tendance",
    name: "DCA pondéré par la tendance",
    family: "DCA & accumulation",
    status: "ready",
    summary: "Moins en marché haussier (SMA200), plus en baissier.",
    keywords: ["tendance", "régime", "sma", "haussier", "baissier", "bull", "bear"],
    patch: {
      regimeEnabled: true,
      bullMult: 0.7,
      bearMult: 1.5,
    },
  },
  {
    id: "dca-fractionne",
    name: "DCA fractionné / aléatoire",
    family: "DCA & accumulation",
    status: "ready",
    summary: "Divise chaque budget en plusieurs achats dans la fenêtre.",
    keywords: ["fractionné", "tranches", "plusieurs achats", "aléatoire", "étalé"],
    patch: {
      tranches: 5,
      distribution: "equal",
    },
  },
  {
    id: "cash-reserve-fixe",
    name: "Réserve de liquidités fixe",
    family: "Gestion du cash",
    status: "ready",
    summary: "Conserve toujours un % minimum de cash.",
    keywords: ["réserve", "cash", "liquidités", "garde", "filet"],
    patch: {
      reserveEnabled: true,
      reservePct: 15,
    },
  },
  {
    id: "timing-fenetre",
    name: "Fenêtre d’investissement + fallback",
    family: "Timing d’exécution",
    status: "ready",
    summary: "Achats dans une fenêtre (ex. jours 1–7) ; le reste en fin de fenêtre.",
    keywords: ["fenêtre", "jours", "période", "fallback", "fin de mois"],
    patch: {
      period: "monthly",
      windowFrom: 1,
      windowTo: 7,
    },
  },
  {
    id: "timing-retracement",
    name: "Acheter les baisses (dip)",
    family: "Timing d’exécution",
    status: "ready",
    summary: "Déclenche un achat si le prix baisse d’un % dans la fenêtre.",
    keywords: ["dip", "baisse", "retracement", "correction", "soldes", "krach"],
    patch: {
      dipEnabled: true,
      dipPct: 3,
    },
  },
  {
    id: "timing-eviter-sommets",
    name: "Éviter les nouveaux sommets (ATH)",
    family: "Timing d’exécution",
    status: "ready",
    summary: "Ne pas acheter le jour d’un nouveau plus haut sur N jours.",
    keywords: ["ath", "sommet", "plus haut", "éviter", "fomo"],
    patch: {
      athEnabled: true,
      athLookback: 90,
    },
  },
  {
    id: "tech-rsi",
    name: "RSI faible",
    family: "Signaux techniques",
    status: "ready",
    summary: "Achète quand le RSI passe sous un seuil.",
    keywords: ["rsi", "survente", "indicateur", "technique"],
    patch: {
      rsiEnabled: true,
      rsiValue: 35,
    },
  },
  {
    id: "dca-drawdown",
    name: "DCA pondéré par le drawdown",
    family: "DCA & accumulation",
    status: "ready",
    summary: "Multiplie le budget par paliers de baisse depuis l’ATH (−5/−10/−20 %).",
    keywords: ["drawdown", "krach", "peur", "multiplier", "paliers"],
    patch: {
      ddTiersEnabled: true,
      ddTiers: [
        { gtePct: 5, factor: 1.1 },
        { gtePct: 10, factor: 1.25 },
        { gtePct: 20, factor: 1.5 },
      ],
      riseTiersEnabled: true,
      riseTiers: [
        { gtePct: 15, factor: 0.85 },
        { gtePct: 30, factor: 0.6 },
      ],
      tierLookback: 365,
      regimeEnabled: false,
    },
  },
  {
    id: "dca-volatilite",
    name: "DCA pondéré par la volatilité",
    family: "DCA & accumulation",
    status: "ready",
    summary: "Bloque (ou réduit) les achats si la volatilité réalisée dépasse un seuil.",
    keywords: ["volatilité", "atr", "vol", "volatility"],
    patch: {
      volEnabled: true,
      volPeriod: 30,
      volMaxPct: 80,
      volMode: "veto",
    },
  },
  {
    id: "extra-buys",
    name: "Achats exceptionnels répétés",
    family: "Timing & déclencheurs",
    status: "ready",
    summary: "Achats hors DCA si RSI bas ou plongeon, avec cooldown.",
    keywords: ["exceptionnel", "bonus", "extra", "supplémentaire", "cooldown"],
    patch: {
      extraBuysEnabled: true,
      extraBuys: [
        { trigger: "rsi_below", value: 30, pctOfBudget: 25, cooldownDays: 30 },
        { trigger: "dip", value: 5, pctOfBudget: 25, cooldownDays: 30 },
      ],
    },
  },

  /* —— approx —— */
  {
    id: "dca-reserve",
    name: "DCA avec réserve opportuniste",
    family: "DCA & accumulation",
    status: "approx",
    summary: "Approximation : réserve de cash fixe (le déploiement par paliers de correction arrive en v1).",
    keywords: ["réserve opportuniste", "munitions", "poudre"],
    patch: {
      reserveEnabled: true,
      reservePct: 20,
    },
    approxNote:
      "v0 garde une réserve fixe ; le déploiement automatique aux paliers −10/−20 % n’est pas encore disponible.",
    suggestIds: ["cash-reserve-fixe", "timing-retracement", "dca-drawdown"],
  },
  {
    id: "lump-sum-echelonne",
    name: "Entrée échelonnée",
    family: "DCA & accumulation",
    status: "approx",
    summary: "Approximation : plusieurs tranches dans la fenêtre (pas un lump sum calendaire dédié).",
    keywords: ["lump sum", "échelonné", "entrée progressive"],
    patch: {
      tranches: 4,
      distribution: "equal",
    },
    approxNote: "Utilise le fractionnement du budget périodique, pas un plan d’entrée one-shot.",
    suggestIds: ["dca-fractionne"],
  },

  /* —— later (catalogue complet canvas) —— */
  {
    id: "value-averaging",
    name: "Value Averaging",
    family: "DCA & accumulation",
    status: "later",
    summary: "Investir la différence entre une trajectoire cible et la valeur réelle.",
    keywords: ["value averaging", "cible", "valeur cible"],
    laterReason: "Nécessite le moteur de blocs v1 (plan value_averaging).",
    suggestIds: ["dca-tendance", "timing-retracement"],
  },
  {
    id: "dca-fear-greed",
    name: "DCA selon Fear & Greed",
    family: "DCA & accumulation",
    status: "later",
    summary: "Multiplier le budget selon l’indice de sentiment.",
    keywords: ["fear", "greed", "sentiment", "peur", "avidité"],
    laterReason: "Donnée externe (v2). En attendant, le régime baissier est le plus proche.",
    suggestIds: ["dca-tendance", "timing-retracement"],
  },
  {
    id: "dca-saisonnier",
    name: "DCA saisonnier",
    family: "DCA & accumulation",
    status: "later",
    summary: "Pondérer selon le calendrier (mois, jours).",
    keywords: ["saisonnier", "calendrier", "sell in may"],
    laterReason: "Modificateur calendaire : v1.",
    suggestIds: ["timing-fenetre"],
  },
  {
    id: "dca-perf-passee",
    name: "DCA selon la performance passée",
    family: "DCA & accumulation",
    status: "later",
    summary: "Sur-pondérer l’actif le plus faible ou le plus fort récemment.",
    keywords: ["momentum", "mean reversion", "performance relative"],
    laterReason: "Redistribution dynamique de l’allocation : v1.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "alloc-fixe",
    name: "Allocation fixe + rebal",
    family: "Allocation & rééquilibrage",
    status: "later",
    summary: "Poids cibles et rééquilibrage périodique.",
    keywords: ["rééquilibrage", "allocation", "poids"],
    laterReason: "Rééquilibrage automatique : v1. Les poids du portefeuille importé sont déjà utilisés.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "rebal-bandes",
    name: "Rééquilibrage par bandes",
    family: "Allocation & rééquilibrage",
    status: "later",
    summary: "Rebalancer quand un poids sort d’une bande ±x %.",
    keywords: ["bandes", "5/25", "threshold"],
    laterReason: "v1.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "rebal-flux",
    name: "Rééquilibrage par cashflow",
    family: "Allocation & rééquilibrage",
    status: "later",
    summary: "Diriger les nouveaux versements vers les sous-pondérés.",
    keywords: ["cashflow", "flux"],
    laterReason: "v1.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "alloc-vol-inverse",
    name: "Allocation inverse volatilité",
    family: "Allocation & rééquilibrage",
    status: "later",
    summary: "Poids inversement proportionnels à la vol.",
    keywords: ["vol inverse", "risk parity"],
    laterReason: "v1 / v3.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "alloc-market-cap",
    name: "Allocation market cap",
    family: "Allocation & rééquilibrage",
    status: "later",
    summary: "Poids selon capitalisation.",
    keywords: ["market cap", "capitalisation"],
    laterReason: "Données de marché étendues : v2.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "core-satellite",
    name: "Core-Satellite",
    family: "Allocation & rééquilibrage",
    status: "later",
    summary: "Noyau passif + satellites tactiques.",
    keywords: ["core", "satellite"],
    laterReason: "Multi-plans : v1.",
    suggestIds: ["smart-dca"],
  },
  {
    id: "alloc-regime",
    name: "Allocation par régime",
    family: "Allocation & rééquilibrage",
    status: "later",
    summary: "Changer les poids selon bull/bear.",
    keywords: ["allocation régime"],
    laterReason: "v1. Le modificateur de budget par régime est déjà dispo.",
    suggestIds: ["dca-tendance"],
  },
  {
    id: "cash-echelle",
    name: "Échelle de corrections",
    family: "Gestion du cash",
    status: "later",
    summary: "Déployer la réserve par paliers de baisse.",
    keywords: ["échelle", "paliers", "déployer"],
    laterReason: "v1.",
    suggestIds: ["cash-reserve-fixe", "timing-retracement"],
  },
  {
    id: "cash-refill",
    name: "Refill de réserve",
    family: "Gestion du cash",
    status: "later",
    summary: "Reconstituer la réserve après déploiement.",
    keywords: ["refill", "reconstitution"],
    laterReason: "v1.",
    suggestIds: ["cash-reserve-fixe"],
  },
  {
    id: "cash-exposition-max",
    name: "Plafonds d’exposition",
    family: "Gestion du cash",
    status: "later",
    summary: "Limites max par actif / classe.",
    keywords: ["plafond", "exposition", "limite"],
    laterReason: "v1.",
    suggestIds: ["cash-reserve-fixe"],
  },
  {
    id: "cash-valorisation",
    name: "Cash selon valorisation",
    family: "Gestion du cash",
    status: "later",
    summary: "Plus de cash si marchés chers (CAPE, etc.).",
    keywords: ["valorisation", "cape", "cher"],
    laterReason: "Données fondamentales : v2.",
    suggestIds: ["dca-tendance", "cash-reserve-fixe"],
  },
  {
    id: "timing-cassure",
    name: "Breakout / cassure",
    family: "Timing d’exécution",
    status: "later",
    summary: "Acheter sur cassure de résistance.",
    keywords: ["breakout", "cassure", "résistance"],
    laterReason: "v1.",
    suggestIds: ["timing-retracement"],
  },
  {
    id: "timing-statistique",
    name: "Meilleur créneau statistique",
    family: "Timing d’exécution",
    status: "later",
    summary: "Choisir l’heure/jour historiquement favorable.",
    keywords: ["créneau", "statistique", "heure"],
    laterReason: "Données intra-journalières : v2.",
    suggestIds: ["timing-fenetre"],
  },
  {
    id: "timing-laddering",
    name: "Laddering d’ordres",
    family: "Timing d’exécution",
    status: "later",
    summary: "Ordres limites échelonnés sous le prix.",
    keywords: ["ladder", "limites", "ordres"],
    laterReason: "Ordres limites : v2.",
    suggestIds: ["dca-fractionne", "timing-retracement"],
  },
  {
    id: "tech-croisements",
    name: "Golden / death cross",
    family: "Signaux techniques",
    status: "later",
    summary: "Croisement de moyennes mobiles.",
    keywords: ["golden cross", "death cross", "moyenne mobile"],
    laterReason: "v1. Le régime SMA200 est le plus proche.",
    suggestIds: ["dca-tendance"],
  },
  {
    id: "tech-macd",
    name: "MACD",
    family: "Signaux techniques",
    status: "later",
    summary: "Signaux MACD.",
    keywords: ["macd"],
    laterReason: "v1.",
    suggestIds: ["tech-rsi"],
  },
  {
    id: "tech-bollinger",
    name: "Bandes de Bollinger",
    family: "Signaux techniques",
    status: "later",
    summary: "Achats près de la bande basse.",
    keywords: ["bollinger"],
    laterReason: "v1.",
    suggestIds: ["tech-rsi", "timing-retracement"],
  },
  {
    id: "tech-atr",
    name: "ATR / stops dynamiques",
    family: "Signaux techniques",
    status: "later",
    summary: "Dimensionnement / stops basés sur ATR.",
    keywords: ["atr"],
    laterReason: "v1.",
    suggestIds: ["dca-tendance"],
  },
  {
    id: "tech-supertrend",
    name: "Supertrend",
    family: "Signaux techniques",
    status: "later",
    summary: "Suivi de tendance Supertrend.",
    keywords: ["supertrend"],
    laterReason: "v1.",
    suggestIds: ["dca-tendance"],
  },
  {
    id: "tech-generique",
    name: "Indicateur générique",
    family: "Signaux techniques",
    status: "later",
    summary: "Branchez n’importe quel indicateur.",
    keywords: ["indicateur générique"],
    laterReason: "v1.",
    suggestIds: ["tech-rsi"],
  },
  {
    id: "tech-confluence",
    name: "Confluence multi-signaux",
    family: "Signaux techniques",
    status: "later",
    summary: "Exiger plusieurs signaux ensemble.",
    keywords: ["confluence", "multi"],
    laterReason: "v1. Smart DCA combine déjà dip + RSI + ATH.",
    suggestIds: ["smart-dca"],
  },
  {
    id: "macro-valorisation",
    name: "Valorisation macro",
    family: "Fondamental & macro",
    status: "later",
    summary: "Régler l’exposition selon CAPE / PER.",
    keywords: ["macro", "per", "cape"],
    laterReason: "v2.",
    suggestIds: ["dca-tendance"],
  },
  {
    id: "macro-taux",
    name: "Taux / banques centrales",
    family: "Fondamental & macro",
    status: "later",
    summary: "Réagir aux décisions de taux.",
    keywords: ["taux", "fed", "bce"],
    laterReason: "v2.",
    suggestIds: ["dca-tendance"],
  },
  {
    id: "macro-crypto-cycles",
    name: "Cycles crypto",
    family: "Fondamental & macro",
    status: "later",
    summary: "Halving, cycles multi-années.",
    keywords: ["halving", "cycle crypto"],
    laterReason: "v2.",
    suggestIds: ["smart-dca"],
  },
  {
    id: "macro-earnings",
    name: "Earnings",
    family: "Fondamental & macro",
    status: "later",
    summary: "Éviter / jouer les publications de résultats.",
    keywords: ["earnings", "résultats"],
    laterReason: "v2.",
    suggestIds: ["timing-fenetre"],
  },
  {
    id: "risque-stop",
    name: "Stop / trailing",
    family: "Gestion du risque",
    status: "later",
    summary: "Couper les pertes automatiquement.",
    keywords: ["stop", "trailing", "vente"],
    laterReason: "Ventes automatiques : v2.",
    suggestIds: ["cash-reserve-fixe"],
  },
  {
    id: "risque-take-profit",
    name: "Take-profit",
    family: "Gestion du risque",
    status: "later",
    summary: "Prendre des bénéfices à un seuil.",
    keywords: ["take profit", "bénéfice"],
    laterReason: "v2.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "risque-drawdown-max",
    name: "Frein drawdown max",
    family: "Gestion du risque",
    status: "later",
    summary: "Suspendre les achats si DD > X %.",
    keywords: ["drawdown max", "frein"],
    laterReason: "v1.",
    suggestIds: ["cash-reserve-fixe", "dca-tendance"],
  },
  {
    id: "risque-vol-target",
    name: "Volatility targeting",
    family: "Gestion du risque",
    status: "later",
    summary: "Cibler une vol de portefeuille.",
    keywords: ["vol targeting", "vol cible"],
    laterReason: "v3.",
    suggestIds: ["dca-tendance"],
  },
  {
    id: "risque-sizing",
    name: "Position sizing",
    family: "Gestion du risque",
    status: "later",
    summary: "Taille de position selon risque.",
    keywords: ["sizing", "kelly"],
    laterReason: "v3.",
    suggestIds: ["dca-fractionne"],
  },
  {
    id: "risque-circuit-breaker",
    name: "Circuit breakers",
    family: "Gestion du risque",
    status: "later",
    summary: "Couper tout en cas de crash extrême.",
    keywords: ["circuit breaker", "urgence"],
    laterReason: "v1.",
    suggestIds: ["cash-reserve-fixe"],
  },
  {
    id: "quant-risk-parity",
    name: "Risk parity",
    family: "Quantitatives avancées",
    status: "later",
    summary: "Égaliser la contribution au risque.",
    keywords: ["risk parity"],
    laterReason: "v3.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "quant-kelly",
    name: "Kelly",
    family: "Quantitatives avancées",
    status: "later",
    summary: "Fraction de Kelly.",
    keywords: ["kelly"],
    laterReason: "v3.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "quant-cppi",
    name: "CPPI",
    family: "Quantitatives avancées",
    status: "later",
    summary: "Constant proportion portfolio insurance.",
    keywords: ["cppi"],
    laterReason: "v3.",
    suggestIds: ["cash-reserve-fixe"],
  },
  {
    id: "quant-dual-momentum",
    name: "Dual momentum",
    family: "Quantitatives avancées",
    status: "later",
    summary: "Momentum absolu + relatif.",
    keywords: ["dual momentum"],
    laterReason: "v3.",
    suggestIds: ["dca-tendance"],
  },
  {
    id: "quant-mean-reversion",
    name: "Mean reversion",
    family: "Quantitatives avancées",
    status: "later",
    summary: "Parier sur le retour à la moyenne.",
    keywords: ["mean reversion"],
    laterReason: "v3.",
    suggestIds: ["timing-retracement", "tech-rsi"],
  },
  {
    id: "quant-factor",
    name: "Facteurs (value/quality…)",
    family: "Quantitatives avancées",
    status: "later",
    summary: "Tilt factoriel.",
    keywords: ["factor", "value", "quality"],
    laterReason: "v1/v3.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "quant-black-litterman",
    name: "Black-Litterman",
    family: "Quantitatives avancées",
    status: "later",
    summary: "Allocation bayésienne avec vues.",
    keywords: ["black litterman"],
    laterReason: "v3.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "fisc-harvesting",
    name: "Tax-loss harvesting",
    family: "Fiscalité & multi-comptes",
    status: "later",
    summary: "Réaliser des pertes fiscales.",
    keywords: ["tax loss", "fiscal"],
    laterReason: "v3.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "fisc-enveloppes",
    name: "Routage par enveloppes",
    family: "Fiscalité & multi-comptes",
    status: "later",
    summary: "PEA / CTO / crypto selon l’actif.",
    keywords: ["pea", "cto", "enveloppe"],
    laterReason: "v3.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "multi-consolide",
    name: "Multi-comptes consolidé",
    family: "Fiscalité & multi-comptes",
    status: "later",
    summary: "Vue et règles sur plusieurs comptes.",
    keywords: ["multi comptes"],
    laterReason: "v3.",
    suggestIds: ["dca-classique"],
  },
  {
    id: "multi-sweep",
    name: "Cash sweep",
    family: "Fiscalité & multi-comptes",
    status: "later",
    summary: "Balayer le cash vers un compte rémunération.",
    keywords: ["sweep", "cash sweep"],
    laterReason: "v3.",
    suggestIds: ["cash-reserve-fixe"],
  },
];

export function getPreset(id: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find((p) => p.id === id);
}

export function readyPresets(): StrategyPreset[] {
  return STRATEGY_PRESETS.filter((p) => p.status === "ready");
}

export function catalogForPrompt(): string {
  return STRATEGY_PRESETS.map(
    (p) =>
      `- ${p.id} [${p.status}] ${p.name} (${p.family}): ${p.summary}` +
      (p.laterReason ? ` | later: ${p.laterReason}` : "") +
      (p.approxNote ? ` | approx: ${p.approxNote}` : ""),
  ).join("\n");
}

const NUM_LIMITS: Record<string, { min: number; max: number }> = {
  budgetAmount: { min: 10, max: 1_000_000 },
  windowFrom: { min: 1, max: 31 },
  windowTo: { min: 1, max: 31 },
  tranches: { min: 1, max: 30 },
  bullMult: { min: 0, max: 5 },
  bearMult: { min: 0, max: 5 },
  neutralMult: { min: 0, max: 5 },
  regimeBandPct: { min: 0, max: 30 },
  regimeSmaPeriod: { min: 5, max: 500 },
  dipPct: { min: 0.5, max: 50 },
  rsiValue: { min: 1, max: 99 },
  athLookback: { min: 5, max: 400 },
  reservePct: { min: 0, max: 90 },
  feePct: { min: 0, max: 2 },
  tierLookback: { min: 30, max: 1000 },
  volPeriod: { min: 5, max: 120 },
  volMaxPct: { min: 5, max: 500 },
  volScaleFactor: { min: 0, max: 5 },
};

function sanitizeTiers(raw: unknown): { gtePct: number; factor: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: { gtePct: number; factor: number }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const gtePct = Number(r.gtePct ?? r.gte_pct);
    const factor = Number(r.factor);
    if (!Number.isFinite(gtePct) || !Number.isFinite(factor)) continue;
    out.push({
      gtePct: Math.min(500, Math.max(0, gtePct)),
      factor: Math.min(5, Math.max(0, factor)),
    });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeExtraBuys(
  raw: unknown,
): StrategyFormPatch["extraBuys"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<StrategyFormPatch["extraBuys"]> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const trigger = r.trigger === "dip" ? "dip" : r.trigger === "rsi_below" ? "rsi_below" : null;
    if (!trigger) continue;
    const value = Number(r.value);
    const pctOfBudget = Number(r.pctOfBudget ?? r.pct_of_budget);
    const cooldownDays = Number(r.cooldownDays ?? r.cooldown_days ?? 30);
    if (!Number.isFinite(value) || !Number.isFinite(pctOfBudget)) continue;
    out.push({
      trigger,
      value: Math.min(99, Math.max(1, value)),
      pctOfBudget: Math.min(100, Math.max(1, pctOfBudget)),
      cooldownDays: Math.min(365, Math.max(1, cooldownDays || 30)),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Clamp + nettoyage d’un patch libre (LLM ou manuel). */
export function sanitizeFormPatch(raw: Record<string, unknown>): StrategyFormPatch {
  const out: StrategyFormPatch = {};
  const boolKeys = [
    "regimeEnabled",
    "dipEnabled",
    "rsiEnabled",
    "athEnabled",
    "reserveEnabled",
    "ddTiersEnabled",
    "riseTiersEnabled",
    "volEnabled",
    "extraBuysEnabled",
  ] as const;
  for (const k of boolKeys) {
    if (typeof raw[k] === "boolean") out[k] = raw[k];
  }
  if (raw.period === "weekly" || raw.period === "monthly") out.period = raw.period;
  if (raw.distribution === "equal" || raw.distribution === "random") {
    out.distribution = raw.distribution;
  }
  if (raw.volMode === "veto" || raw.volMode === "scale") out.volMode = raw.volMode;
  if (typeof raw.currency === "string" && raw.currency.trim()) {
    out.currency = raw.currency.trim().toUpperCase().slice(0, 3);
  }
  if (typeof raw.regimeReferenceAsset === "string") {
    out.regimeReferenceAsset = raw.regimeReferenceAsset.trim().toUpperCase();
  }
  for (const [key, lim] of Object.entries(NUM_LIMITS)) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      // Ne jamais laisser une année calendaire (2010–2039) pourrir comme budget.
      if (key === "budgetAmount" && Number.isInteger(v) && v >= 2010 && v <= 2039) {
        continue;
      }
      (out as Record<string, number>)[key] = Math.min(lim.max, Math.max(lim.min, v));
    }
  }
  if (out.windowFrom != null && out.windowTo != null && out.windowTo < out.windowFrom) {
    out.windowTo = out.windowFrom;
  }
  const dd = sanitizeTiers(raw.ddTiers);
  if (dd) out.ddTiers = dd;
  const rise = sanitizeTiers(raw.riseTiers);
  if (rise) out.riseTiers = rise;
  const extras = sanitizeExtraBuys(raw.extraBuys);
  if (extras) out.extraBuys = extras;
  return out;
}

export function mergePatches(...patches: StrategyFormPatch[]): StrategyFormPatch {
  return Object.assign({}, ...patches);
}

/** Applique une liste d’ids de presets (+ override LLM). */
export function buildPatchFromPresetIds(
  ids: string[],
  override?: StrategyFormPatch,
): {
  patch: StrategyFormPatch;
  matched: StrategyPreset[];
  unsupported: { id: string; reason: string }[];
  explanation: string[];
} {
  const matched: StrategyPreset[] = [];
  const unsupported: { id: string; reason: string }[] = [];
  const explanation: string[] = [];
  const patches: StrategyFormPatch[] = [];

  for (const id of ids) {
    const p = getPreset(id);
    if (!p) {
      unsupported.push({ id, reason: "Stratégie inconnue du catalogue." });
      continue;
    }
    if (p.status === "later") {
      unsupported.push({
        id,
        reason: p.laterReason ?? "Pas encore disponible dans le moteur v0.",
      });
      if (p.suggestIds?.length) {
        explanation.push(
          `« ${p.name} » n’est pas encore dispo — suggestion : ${p.suggestIds
            .map((s) => getPreset(s)?.name ?? s)
            .join(", ")}.`,
        );
      }
      continue;
    }
    matched.push(p);
    if (p.patch) patches.push(p.patch);
    explanation.push(
      p.status === "approx"
        ? `Approximé : ${p.name} — ${p.approxNote ?? p.summary}`
        : `Activé : ${p.name} — ${p.summary}`,
    );
  }

  let patch = mergePatches(...patches);
  if (override) patch = mergePatches(patch, sanitizeFormPatch(override as Record<string, unknown>));

  return { patch, matched, unsupported, explanation };
}

/** Matching lexical sans LLM. */
export function lexicalMatchPresetIds(prompt: string): string[] {
  const text = prompt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const scored: { id: string; score: number }[] = [];
  for (const p of STRATEGY_PRESETS) {
    let score = 0;
    for (const kw of p.keywords) {
      const k = kw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      if (text.includes(k)) score += k.length > 4 ? 2 : 1;
    }
    if (text.includes(p.id)) score += 3;
    if (score > 0) scored.push({ id: p.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const ids = scored.slice(0, 5).map((s) => s.id);
  // Si rien : smart-dca par défaut si le texte évoque une stratégie « complète »
  if (ids.length === 0 && /(strateg|investir|acheter|dca)/i.test(prompt)) {
    return ["smart-dca"];
  }
  return ids;
}

export function explainPatch(patch: StrategyFormPatch): string[] {
  const lines: string[] = [];
  if (patch.regimeEnabled === true) {
    lines.push(
      `Gestion du marché activée (SMA ${patch.regimeSmaPeriod ?? "…"} j, bande ±${patch.regimeBandPct ?? "…"} %, haussier ×${patch.bullMult ?? "…"}, neutre ×${patch.neutralMult ?? "…"}, baissier ×${patch.bearMult ?? "…"}).`,
    );
  }
  if (patch.regimeEnabled === false) lines.push("Gestion du marché désactivée.");
  if (patch.dipEnabled === true) {
    lines.push(`Acheter les baisses activé (seuil ${patch.dipPct ?? "…"} %).`);
  }
  if (patch.dipEnabled === false) lines.push("Acheter les baisses désactivé.");
  if (patch.rsiEnabled === true) {
    lines.push(`RSI activé (seuil ${patch.rsiValue ?? "…"}).`);
  }
  if (patch.rsiEnabled === false) lines.push("RSI désactivé.");
  if (patch.athEnabled === true) {
    lines.push(`Éviter les sommets activé (lookback ${patch.athLookback ?? "…"} j).`);
  }
  if (patch.athEnabled === false) lines.push("Éviter les sommets désactivé.");
  if (patch.reserveEnabled === true) {
    lines.push(`Réserve de liquidités activée (${patch.reservePct ?? "…"} %).`);
  }
  if (patch.reserveEnabled === false) lines.push("Réserve de liquidités désactivée.");
  if (patch.tranches != null) {
    lines.push(
      `Fractionnement : ${patch.tranches} achat(s), répartition ${patch.distribution ?? "equal"}.`,
    );
  }
  if (patch.windowFrom != null || patch.windowTo != null) {
    lines.push(
      `Fenêtre : jours ${patch.windowFrom ?? "…"} → ${patch.windowTo ?? "…"} (${patch.period ?? "monthly"}).`,
    );
  }
  if (patch.budgetAmount != null) {
    lines.push(`Budget périodique : ${patch.budgetAmount} ${patch.currency ?? ""}`.trim() + ".");
  }
  if (patch.ddTiersEnabled === true) {
    const tiers = (patch.ddTiers ?? [])
      .map((t) => `−${t.gtePct}% → ×${t.factor}`)
      .join(", ");
    lines.push(`Paliers de drawdown activés${tiers ? ` (${tiers})` : ""}.`);
  }
  if (patch.ddTiersEnabled === false) lines.push("Paliers de drawdown désactivés.");
  if (patch.riseTiersEnabled === true) {
    const tiers = (patch.riseTiers ?? [])
      .map((t) => `+${t.gtePct}% → ×${t.factor}`)
      .join(", ");
    lines.push(`Paliers de hausse activés${tiers ? ` (${tiers})` : ""}.`);
  }
  if (patch.riseTiersEnabled === false) lines.push("Paliers de hausse désactivés.");
  if (patch.volEnabled === true) {
    lines.push(
      `Volatilité activée : ${patch.volMode ?? "veto"} si ≥ ${patch.volMaxPct ?? "…"} % (${patch.volPeriod ?? 30} j).`,
    );
  }
  if (patch.volEnabled === false) lines.push("Filtre volatilité désactivé.");
  if (patch.extraBuysEnabled === true) {
    const n = patch.extraBuys?.length ?? 0;
    lines.push(`Achats exceptionnels activés (${n} règle${n > 1 ? "s" : ""}).`);
  }
  if (patch.extraBuysEnabled === false) lines.push("Achats exceptionnels désactivés.");
  return lines;
}
