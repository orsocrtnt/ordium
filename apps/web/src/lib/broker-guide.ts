/**
 * Brokers MVP — uniquement ceux connectables via API.
 * On ne recommande jamais un broker non branché (ex. Trade Republic, Degiro).
 */

export type ConnectableBrokerId =
  | "coinbase"
  | "kraken"
  | "binance"
  | "trading212"
  | "alpaca"
  | "ibkr";

export type Knowledge = "none" | "basics" | "comfortable" | "advanced";
export type AssetInterest = "crypto" | "stocks" | "etf" | "mixed";
/** Capital de départ (montant total pour commencer). */
export type InitialBudget = "under_500" | "500_2k" | "2k_10k" | "over_10k";
/** Versement mensuel envisagé. */
export type MonthlyBudget = "none" | "under_100" | "100_300" | "300_1k" | "over_1k";
export type Horizon = "short" | "medium" | "long";
export type Risk = "low" | "medium" | "high";
/** Zone / économie privilégiée. */
export type EconomyFocus = "europe" | "us" | "emerging" | "global" | "no_preference";

export type QuizAnswers = {
  knowledge: Knowledge | null;
  interests: AssetInterest[];
  initialBudget: InitialBudget | null;
  monthlyBudget: MonthlyBudget | null;
  economy: EconomyFocus[];
  horizon: Horizon | null;
  risk: Risk | null;
};

export type BrokerProfile = {
  id: ConnectableBrokerId;
  name: string;
  tagline: string;
  assets: string;
  kind: "crypto" | "securities";
  bestFor: string;
  caveats?: string;
  paper?: boolean;
  /** Page officielle pour créer un compte (redirection). */
  openAccountUrl: string;
  /** Page officielle de connexion. */
  loginUrl: string;
};

/** Catalogue — brokers qu’on peut orienter + brancher plus tard (OAuth / API). */
export const MVP_BROKERS: BrokerProfile[] = [
  {
    id: "trading212",
    name: "Trading 212",
    tagline: "Actions & ETF (UE) + compte demo",
    assets: "Actions, ETF",
    kind: "securities",
    paper: true,
    bestFor: "Débuter en bourse européenne, tests en demo.",
    openAccountUrl: "https://www.trading212.com/",
    loginUrl: "https://www.trading212.com/login",
  },
  {
    id: "alpaca",
    name: "Alpaca",
    tagline: "Actions US, paper trading",
    assets: "Actions, ETF (US)",
    kind: "securities",
    paper: true,
    bestFor: "Marché US et tests API (paper).",
    caveats: "Orientation États-Unis.",
    openAccountUrl: "https://app.alpaca.markets/signup",
    loginUrl: "https://app.alpaca.markets/login",
  },
  {
    id: "ibkr",
    name: "Interactive Brokers",
    tagline: "Multi-marchés",
    assets: "Actions, ETF, options…",
    kind: "securities",
    bestFor: "Profils avancés, exposition internationale.",
    openAccountUrl: "https://www.interactivebrokers.com/en/accounting/open-an-account.php",
    loginUrl: "https://www.interactivebrokers.com/sso/Login",
  },
  {
    id: "coinbase",
    name: "Coinbase",
    tagline: "Crypto, interface simple",
    assets: "Cryptomonnaies",
    kind: "crypto",
    bestFor: "Premiers pas en crypto.",
    caveats: "Frais parfois plus élevés que les exchanges avancés.",
    openAccountUrl: "https://www.coinbase.com/signup",
    loginUrl: "https://login.coinbase.com/",
  },
  {
    id: "kraken",
    name: "Kraken",
    tagline: "Crypto, bon équilibre",
    assets: "Cryptomonnaies",
    kind: "crypto",
    bestFor: "Crypto avec un peu plus de contrôle.",
    openAccountUrl: "https://www.kraken.com/sign-up",
    loginUrl: "https://www.kraken.com/sign-in",
  },
  {
    id: "binance",
    name: "Binance",
    tagline: "Crypto, large catalogue",
    assets: "Cryptomonnaies",
    kind: "crypto",
    bestFor: "Utilisateurs à l’aise, offre large.",
    caveats: "Disponibilité selon le pays.",
    openAccountUrl: "https://accounts.binance.com/register",
    loginUrl: "https://accounts.binance.com/login",
  },
];

export function brokerById(id: ConnectableBrokerId): BrokerProfile {
  return MVP_BROKERS.find((b) => b.id === id)!;
}

export function isConnectableBrokerId(id: string): id is ConnectableBrokerId {
  return MVP_BROKERS.some((b) => b.id === id);
}

export type Recommendation = {
  /** Un ou plusieurs brokers connectables (ex. crypto + actions). */
  recommended: BrokerProfile[];
  rationale: string[];
  nextSteps: string[];
};

function cryptoOnly(interests: AssetInterest[]): boolean {
  return interests.length === 1 && interests[0] === "crypto";
}

function securitiesOnly(interests: AssetInterest[]): boolean {
  return (
    interests.length > 0 &&
    !interests.includes("crypto") &&
    !interests.includes("mixed") &&
    interests.every((i) => i === "stocks" || i === "etf")
  );
}

function wantsBoth(interests: AssetInterest[]): boolean {
  if (interests.includes("mixed")) return true;
  const crypto = interests.includes("crypto");
  const sec = interests.includes("stocks") || interests.includes("etf");
  return crypto && sec;
}

function pickCrypto(answers: QuizAnswers): ConnectableBrokerId {
  const { knowledge, risk, initialBudget } = answers;
  if (knowledge === "none" || knowledge === "basics") return "coinbase";
  if (knowledge === "advanced" || risk === "high" || initialBudget === "over_10k") {
    return "binance";
  }
  return "kraken";
}

function pickSecuritiesList(answers: QuizAnswers): ConnectableBrokerId[] {
  const { knowledge, economy, initialBudget, risk } = answers;
  const advanced =
    knowledge === "advanced" || initialBudget === "over_10k" || risk === "high";
  const beginner = knowledge === "none" || knowledge === "basics";

  const zones = economy.includes("no_preference") ? (["no_preference"] as EconomyFocus[]) : economy;
  const ids: ConnectableBrokerId[] = [];

  if (zones.includes("no_preference") || zones.length === 0) {
    if (advanced) return ["ibkr"];
    if (beginner) return ["trading212"];
    return ["alpaca"];
  }

  if (zones.includes("europe")) {
    ids.push(advanced ? "ibkr" : "trading212");
  }
  if (zones.includes("us")) {
    ids.push(advanced ? "ibkr" : "alpaca");
  }
  if (zones.includes("emerging") || zones.includes("global")) {
    ids.push(beginner && !zones.includes("europe") && !zones.includes("us") ? "trading212" : "ibkr");
  }

  // Europe + US débutant → duo Trading 212 + Alpaca (sans doubler IBKR)
  if (zones.includes("europe") && zones.includes("us") && !advanced) {
    return uniqueIds(["trading212", "alpaca"]);
  }

  return uniqueIds(ids.length > 0 ? ids : ["trading212"]);
}

function uniqueIds(ids: ConnectableBrokerId[]): ConnectableBrokerId[] {
  return [...new Set(ids)];
}

/**
 * Recommandation pédagogique — uniquement des brokers connectables.
 * Peut en proposer plusieurs (ex. un crypto + un titres).
 */
export function recommendBroker(answers: QuizAnswers): Recommendation | null {
  const { knowledge, interests, initialBudget, monthlyBudget, economy, horizon, risk } = answers;
  if (
    !knowledge ||
    interests.length === 0 ||
    !initialBudget ||
    !monthlyBudget ||
    economy.length === 0 ||
    !horizon ||
    !risk
  ) {
    return null;
  }

  const rationale: string[] = [];
  let ids: ConnectableBrokerId[] = [];

  if (wantsBoth(interests)) {
    const secs = pickSecuritiesList(answers);
    const cry = pickCrypto(answers);
    ids = uniqueIds([...secs, cry]);
    const secNames = secs.map((id) => `« ${brokerById(id).name} »`).join(" et ");
    rationale.push(
      `Vous voulez un peu de tout : ${secNames} pour les actions / ETF et « ${brokerById(cry).name} » pour la crypto — tous connectables dans Ordium.`,
    );
  } else if (cryptoOnly(interests)) {
    const cry = pickCrypto(answers);
    const alt = cry === "coinbase" ? "kraken" : cry === "binance" ? "kraken" : "coinbase";
    ids = uniqueIds([cry, alt]);
    rationale.push(
      `Orientation crypto : « ${brokerById(cry).name} » correspond le mieux à votre niveau et à votre profil de risque.`,
    );
    rationale.push(`En second choix connectable : « ${brokerById(alt).name} ».`);
  } else if (securitiesOnly(interests)) {
    ids = pickSecuritiesList(answers);
    const names = ids.map((id) => `« ${brokerById(id).name} »`).join(" et ");
    rationale.push(
      `Orientation actions / ETF : ${names} — parmi les brokers qu’Ordium peut synchroniser.`,
    );
  } else {
    ids = pickSecuritiesList(answers);
    rationale.push(
      `Suggestion connectable : ${ids.map((id) => `« ${brokerById(id).name} »`).join(" et ")}.`,
    );
  }

  // Économie (multi)
  const econLabels = economy
    .filter((e) => e !== "no_preference")
    .map((e) => QUIZ_LABELS.economy[e].toLowerCase());
  if (economy.includes("no_preference") || economy.length === 0) {
    // rien de spécial
  } else if (econLabels.length === 1) {
    const e = economy[0]!;
    if (e === "europe") {
      rationale.push(
        "Vous privilégiez l’économie européenne : on favorise les plateformes orientées UE (Trading 212 / IBKR).",
      );
    } else if (e === "us") {
      rationale.push(
        "Vous privilégiez l’économie américaine : Alpaca (ou IBKR) convient bien pour les titres US.",
      );
    } else if (e === "emerging") {
      rationale.push(
        "Intérêt pour les économies émergentes : un courtier multi-marchés comme Interactive Brokers offre plus de couverture.",
      );
    } else if (e === "global") {
      rationale.push(
        "Vision mondiale : un accès multi-marchés (IBKR) ou un duo UE + US reste le plus souple.",
      );
    }
  } else {
    rationale.push(
      `Vous cumulez plusieurs zones (${econLabels.join(", ")}) : on propose des courtiers connectables qui couvrent ces marchés.`,
    );
  }

  if (horizon === "short" && risk === "high") {
    rationale.push(
      "Horizon court et risque élevé : avancez progressivement, et ne mettez que ce que vous pouvez vous permettre de perdre.",
    );
  }
  if (initialBudget === "under_500") {
    rationale.push(
      "Capital de départ limité : privilégiez les frais bas et, pour tester, le paper/demo.",
    );
  }
  if (monthlyBudget === "none") {
    rationale.push("Sans versement mensuel : un apport initial unique suffit pour démarrer et connecter Ordium.");
  } else if (monthlyBudget === "under_100") {
    rationale.push(
      "Versement mensuel modeste : un DCA simple (ETF ou crypto major) reste réaliste.",
    );
  } else if (monthlyBudget === "over_1k") {
    rationale.push(
      "Capacité mensuelle élevée : un broker multi-marchés et une discipline de répartition deviennent plus utiles.",
    );
  }

  const recommended = uniqueIds(ids).map(brokerById);

  const nextSteps: string[] = [];
  if (recommended.length === 1) {
    const b = recommended[0]!;
    nextSteps.push(
      `Ouvrez un compte chez « ${b.name} » via le bouton ci-dessous (inscription / connexion sur leur site).`,
    );
  } else {
    nextSteps.push(
      `Choisissez parmi les suggestions (${recommended.map((b) => b.name).join(", ")}) — ou un autre broker de la liste.`,
    );
    nextSteps.push(
      "Un clic vous envoie sur leur site officiel pour créer le compte ou vous connecter (identifiants chez eux, pas dans Ordium).",
    );
  }
  nextSteps.push(
    "Une fois le compte créé, revenez ici et validez : Ordium mémorise votre choix pour automatiser la suite.",
  );

  return { recommended, rationale, nextSteps };
}

export const QUIZ_LABELS = {
  knowledge: {
    none: "Je débute vraiment",
    basics: "Je connais les bases",
    comfortable: "Je me débrouille",
    advanced: "Je suis à l’aise",
  } as Record<Knowledge, string>,
  interest: {
    crypto: "Cryptomonnaies",
    stocks: "Actions",
    etf: "ETF / fonds indiciels",
    mixed: "Un peu de tout",
  } as Record<AssetInterest, string>,
  initialBudget: {
    under_500: "Moins de 500 €",
    "500_2k": "500 € – 2 000 €",
    "2k_10k": "2 000 € – 10 000 €",
    over_10k: "Plus de 10 000 €",
  } as Record<InitialBudget, string>,
  monthlyBudget: {
    none: "Rien pour l’instant (apport unique)",
    under_100: "Moins de 100 € / mois",
    "100_300": "100 € – 300 € / mois",
    "300_1k": "300 € – 1 000 € / mois",
    over_1k: "Plus de 1 000 € / mois",
  } as Record<MonthlyBudget, string>,
  economy: {
    europe: "Économie européenne",
    us: "Économie américaine",
    emerging: "Économies émergentes",
    global: "Vision mondiale / diversifiée",
    no_preference: "Pas de préférence particulière",
  } as Record<EconomyFocus, string>,
  horizon: {
    short: "Moins d’un an",
    medium: "1 à 5 ans",
    long: "Plus de 5 ans",
  } as Record<Horizon, string>,
  risk: {
    low: "Faible — je préfère la stabilité",
    medium: "Modéré — un peu de variation OK",
    high: "Élevé — j’accepte de fortes variations",
  } as Record<Risk, string>,
};
