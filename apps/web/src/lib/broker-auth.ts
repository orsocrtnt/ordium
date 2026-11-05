import type { ConnectableBrokerId } from "./broker-guide";

export type BrokerAuthMode = "oauth" | "api_key";

export type TutorialStep = {
  title: string;
  body: string;
  /** Lien utile pour cette étape (ouvre dans un nouvel onglet). */
  linkUrl?: string;
  linkLabel?: string;
};

export type BrokerAuthProfile = {
  id: ConnectableBrokerId;
  preferred: BrokerAuthMode;
  oauthSupported: boolean;
  keyHint: string;
  secretHint: string;
  hasEnvironment?: boolean;
  /** Libellés exacts Paper / Live tels qu’affichés côté broker. */
  paperLabel?: string;
  liveLabel?: string;
  tutorial: TutorialStep[];
};

/**
 * Tutoriels alignés sur les libellés officiels des interfaces / docs brokers
 * (souvent en anglais). Sources : CDP docs, Alpaca docs, Binance FAQ,
 * Kraken Support, Trading 212 Help Centre, IBKR Guides / Campus.
 */
export const BROKER_AUTH: Record<ConnectableBrokerId, BrokerAuthProfile> = {
  coinbase: {
    id: "coinbase",
    preferred: "api_key",
    oauthSupported: false,
    keyHint: "organizations/{org_id}/apiKeys/{key_id}",
    secretHint: "-----BEGIN EC PRIVATE KEY----- … -----END EC PRIVATE KEY-----",
    tutorial: [
      {
        title: "Ouvrir Coinbase Developer Platform",
        body: "Allez sur le portail CDP (pas seulement l’app Coinbase grand public). Connectez-vous avec le compte Coinbase qui détient vos actifs.",
        linkUrl: "https://portal.cdp.coinbase.com/",
        linkLabel: "portal.cdp.coinbase.com",
      },
      {
        title: "Choisir le projet",
        body: "En haut de la page, dans le menu déroulant de projet, sélectionnez le projet à utiliser (ou créez-en un si besoin).",
      },
      {
        title: "Onglet API Keys → Secret API Keys",
        body: "Ouvrez l’onglet « API Keys », puis l’onglet / section « Secret API Keys » (pas « Client API Keys »). Ordium a besoin d’une Secret API Key serveur.",
        linkUrl: "https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication",
        linkLabel: "Doc officielle : API Key Authentication",
      },
      {
        title: "Create API key",
        body: "Cliquez sur le bouton « Create API key ». Saisissez un « API key nickname » (ex. Ordium).",
      },
      {
        title: "API restrictions et Advanced Settings",
        body: "Développez « API restrictions » et « Advanced Settings ». Vous pouvez laisser l’« IP allowlist » vide pour tester (recommandé de le remplir plus tard).",
      },
      {
        title: "Signature algorithm = ECDSA (obligatoire)",
        body: "Changez l’algorithme de signature en « ECDSA ». Ne choisissez pas « Ed25519 » : Ordium signe en ES256 (ECDSA) et Ed25519 échouera. Les docs Coinbase App le précisent explicitement.",
      },
      {
        title: "Permissions lecture",
        body: "Dans les restrictions de permissions / portfolio, limitez-vous à la lecture (view / read). N’activez pas trade ni transfer / withdraw pour une simple sync de portefeuille.",
      },
      {
        title: "Create API key → copier les valeurs",
        body: "Cliquez à nouveau sur « Create API key ». Dans la fenêtre modale, copiez : (1) le nom / ID de clé au format « organizations/{org_id}/apiKeys/{key_id} » ; (2) la clé privée PEM. Bouton optionnel « Download API key » si vous préférez un fichier.",
      },
      {
        title: "Coller dans Ordium",
        body: "Premier champ = nom de clé « organizations/…/apiKeys/… ». Second champ = bloc PEM complet (lignes BEGIN / END comprises). Puis « Connecter ».",
      },
    ],
  },
  alpaca: {
    id: "alpaca",
    preferred: "api_key",
    oauthSupported: false,
    keyHint: "API Key (APCA-API-KEY-ID)",
    secretHint: "Secret Key (APCA-API-SECRET-KEY)",
    hasEnvironment: true,
    paperLabel: "Paper Trading",
    liveLabel: "Live Trading",
    tutorial: [
      {
        title: "Se connecter au dashboard Alpaca",
        body: "Connectez-vous sur app.alpaca.markets. Les clés Paper et Live sont différentes : génerez-les dans le bon environnement.",
        linkUrl: "https://app.alpaca.markets/",
        linkLabel: "app.alpaca.markets",
      },
      {
        title: "Sélectionner Paper Trading (recommandé pour commencer)",
        body: "En haut à gauche, sélecteur de compte → « Paper Trading ». Pour l’argent réel plus tard : compte Live. Ordium Exécution utilise la même paire de clés pour sync + ordres.",
        linkUrl: "https://app.alpaca.markets/paper/dashboard/overview",
        linkLabel: "Dashboard Paper Trading",
      },
      {
        title: "Section API Keys → Generate New Keys",
        body: "Panneau « API Keys » (sidebar / Home) → « Generate New Keys ». Alpaca affiche API Key + Secret Key. La Secret Key n’est montrée qu’une fois.",
        linkUrl: "https://docs.alpaca.markets/docs/getting-started-with-alpaca-market-data",
        linkLabel: "Doc : Generate API Keys",
      },
      {
        title: "Permissions trading",
        body: "Les clés Trading API Alpaca permettent lecture des positions et placement d’ordres (POST /v2/orders). Pas besoin d’un second type de clé pour le MVP Ordium.",
      },
      {
        title: "Sorties de fonds (ACH / wire)",
        body: "Les retraits cash se font via le dashboard « Banking » / funding Alpaca — pas via un withdraw crypto. Dans Ordium → Exécution → Retraits, le bouton ouvre le parcours dashboard.",
        linkUrl: "https://app.alpaca.markets/brokerage/banking",
        linkLabel: "Alpaca Banking (live)",
      },
      {
        title: "Coller dans Ordium",
        body: "1) Sync portefeuille : coller Key + Secret ici (environnement Paper/Live identique). 2) Exécution : page Exécution → « Activer l’exécution » avec la même paire pour ordres et DCA.",
      },
    ],
  },
  binance: {
    id: "binance",
    preferred: "api_key",
    oauthSupported: false,
    keyHint: "API Key",
    secretHint: "Secret Key",
    tutorial: [
      {
        title: "Prérequis compte (FAQ Binance)",
        body: "2FA activé, identité vérifiée (KYC), dépôt Spot Wallet pour activer le compte.",
        linkUrl: "https://www.binance.com/en/support/faq/detail/360002502072",
        linkLabel: "FAQ : How to Create API Keys",
      },
      {
        title: "Profil → Account → API Management → Create API",
        body: "Icône profil → « Account » → « API Management » → « Create API ».",
        linkUrl: "https://www.binance.com/en/my/settings/api-management",
        linkLabel: "API Management",
      },
      {
        title: "System-generated + label",
        body: "Type « System-generated » (HMAC) → label « Ordium » → validation 2FA / passkeys. Vous obtenez « API Key » + « Secret Key ».",
      },
      {
        title: "IP access restrictions (obligatoire pour trader / retirer)",
        body: "Choisissez « Restrict access to trusted IPs only (Recommended) » et ajoutez l’IP publique du serveur Ordium (ou votre IP fixe en local). Sans restriction IP, Binance limite souvent la clé à « Enable Reading » seule.",
      },
      {
        title: "API Restrictions — sync seule",
        body: "Pour importer le portefeuille uniquement : cochez « Enable Reading ».",
      },
      {
        title: "API Restrictions — exécution (ordres)",
        body: "Pour qu’Ordium place des ordres Spot : cochez aussi « Enable Spot & Margin Trading ». Ne cochez pas Futures si inutile.",
      },
      {
        title: "API Restrictions — retraits",
        body: "Pour les retraits crypto via Ordium : cochez « Enable Withdrawals » (IP restrict obligatoire). Ajoutez ensuite chaque adresse dans l’allowlist Ordium (format coin:network:address) avant tout withdraw.",
      },
      {
        title: "Testnet (paper Ordium)",
        body: "L’environnement « Paper / testnet » Ordium pointe vers testnet.binance.vision — créez des clés testnet séparées pour les essais d’ordres sans fonds réels.",
        linkUrl: "https://testnet.binance.vision/",
        linkLabel: "Binance Spot Testnet",
      },
      {
        title: "Coller dans Ordium",
        body: "Sync : coller ici. Exécution : page Exécution → activer Binance (paper=testnet ou live) avec la clé adaptée, puis ticket / DCA / retraits.",
      },
    ],
  },
  kraken: {
    id: "kraken",
    preferred: "api_key",
    oauthSupported: false,
    keyHint: "API key",
    secretHint: "Private key",
    tutorial: [
      {
        title: "Se connecter via Kraken Pro",
        body: "Connectez-vous à votre compte via Kraken Pro (parcours décrit par le support Kraken pour les clés Spot API).",
        linkUrl: "https://pro.kraken.com/",
        linkLabel: "pro.kraken.com",
      },
      {
        title: "Profile → Settings → API",
        body: "Cliquez l’icône profil (en haut à droite) → « Settings » → onglet « API ». Puis cliquez « Create API key ».",
        linkUrl: "https://www.kraken.com/u/security/api",
        linkLabel: "Settings → API",
      },
      {
        title: "Key Description",
        body: "Remplissez « Key Description » (nom unique de la clé), par ex. Ordium. Le défaut ressemble à « api-key-1605316109249 » — vous pouvez le remplacer.",
        linkUrl: "https://support.kraken.com/articles/360000919966-How-to-create-an-API-key",
        linkLabel: "Support Kraken : How to create a spot API key",
      },
      {
        title: "Key Permissions — lecture seule",
        body: "Sous Funds : cochez uniquement « Query Funds ». Sous Orders & Trades : cochez « Query Open Orders & Trades » et « Query Closed Orders & Trades ». Ne cochez pas « Deposit Funds », « Withdraw Funds », « Modify Orders », ni « Cancel/Close Orders ».",
      },
      {
        title: "Other (optionnel)",
        body: "Vous pouvez cocher « Query Ledger Entries » si proposé. Laissez « Nonce Window », IP whitelisting et Key Expiration aux valeurs par défaut sauf besoin avancé.",
      },
      {
        title: "Generate key",
        body: "Cliquez sur « Generate key ». Kraken affiche l’« API key », la « Private key », et éventuellement un QR code.",
      },
      {
        title: "Sauvegarder API key + Private key",
        body: "Le support Kraken insiste : traitez API key / Private key comme un mot de passe. La Private key n’est plus re-affichable ensuite — copiez-la immédiatement.",
      },
      {
        title: "Coller dans Ordium",
        body: "Premier champ = API key. Second champ = Private key. Puis « Connecter ». (Certains outils appellent la Private key « API secret » — c’est la même valeur.)",
      },
    ],
  },
  trading212: {
    id: "trading212",
    preferred: "api_key",
    oauthSupported: false,
    keyHint: "API Key",
    secretHint: "API Secret Key",
    hasEnvironment: true,
    paperLabel: "Paper Trading (Demo)",
    liveLabel: "Live Trading",
    tutorial: [
      {
        title: "Compte compatible (Invest / Stocks ISA)",
        body: "La Public API Trading 212 n’est visible que pour « General Invest Account » et « Stock & Shares ISA Account ». Pas CFD seul, pas SIPP pour l’instant (Help Centre).",
        linkUrl: "https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key",
        linkLabel: "Help Centre : Trading 212 API key",
      },
      {
        title: "Accepter le risk warning",
        body: "Avant la première génération, Trading 212 exige d’accepter un « mandatory risk warning » sur l’usage d’applications tierces.",
      },
      {
        title: "Settings → API (Beta)",
        body: "Dans l’app ou le web : allez dans « Settings », puis ouvrez « API (Beta) » (parfois affiché « API (beta) »).",
        linkUrl: "https://docs.trading212.com/api",
        linkLabel: "Docs Public API",
      },
      {
        title: "Generate API key",
        body: "Appuyez sur « Generate API key ». Examinez les permissions proposées (ex. account data, history, orders, portfolio).",
      },
      {
        title: "Formulaire New API Key",
        body: "Remplissez « New API Key » : donnez un name à la clé. Pour Ordium (sync portefeuille), privilégiez les permissions de lecture (account data / history / portfolio) et évitez « orders » tant que vous n’automatisez pas les ordres.",
      },
      {
        title: "IP access restrictions",
        body: "Choisissez « Unrestricted (less secure) » pour tester facilement, ou « Restrict access to trusted IPs (recommended) » avec vos IPs / CIDR.",
      },
      {
        title: "API Key + API Secret Key",
        body: "Après soumission, Trading 212 affiche « API Key » et « API Secret Key ». L’API Secret Key n’est montrée qu’une fois — copiez-la immédiatement.",
      },
      {
        title: "Demo vs Live (environnements API)",
        body: "Les docs distinguent Paper Trading (Demo) → https://demo.trading212.com et Live Trading → https://live.trading212.com. Les versions de clés peuvent différer entre real et demo. Dans Ordium, choisissez le même environnement que celui où la clé a été créée.",
      },
      {
        title: "Coller dans Ordium",
        body: "Premier champ = API Key. Second champ = API Secret Key. Sélectionnez Paper Trading (Demo) ou Live Trading, puis « Connecter ».",
      },
    ],
  },
  ibkr: {
    id: "ibkr",
    preferred: "api_key",
    oauthSupported: false,
    keyHint: "Current Token (Flex Web Service)",
    secretHint: "Query ID",
    tutorial: [
      {
        title: "Client Portal IBKR (pas seulement TWS)",
        body: "Connectez-vous au Client Portal web. Flex Web Service se configure ici, pas dans Trader Workstation seul.",
        linkUrl: "https://www.interactivebrokers.com/sso/Login",
        linkLabel: "Client Portal login",
      },
      {
        title: "Performance & Reports → Flex Queries",
        body: "Cliquez « Performance & Reports » puis « Flex Queries ». Variante menu : Menu (haut gauche) → « Reporting » → « Flex Queries ».",
        linkUrl: "https://www.ibkrguides.com/clientportal/performanceandstatements/activityflex.htm",
        linkLabel: "Guide IBKR : Create an Activity Flex Query",
      },
      {
        title: "Créer une Activity Flex Query",
        body: "Sur l’écran Flex Queries, cliquez l’icône « + » en haut à droite de la zone « Activity Flex Query ». Donnez un name à la query (ex. Ordium Open Positions).",
      },
      {
        title: "Section Open Positions",
        body: "Dans « Sections », sélectionnez « Open Positions ». Dans la pop-up des champs, cochez au minimum Symbol, Quantity, et si possible Mark Price / Position Value / Cost Basis Money (ou équivalents listés). Cliquez « Save » sur la section.",
      },
      {
        title: "Delivery Configuration — Format XML",
        body: "Dans « Delivery Configuration », choisissez Format « XML » (recommandé pour Ordium). Période : par ex. « Last Business Day » ou « Month to Date » selon vos besoins. Cliquez « Continue », puis « Create ».",
      },
      {
        title: "Récupérer le Query ID",
        body: "Sur la liste Flex Queries, cliquez l’icône « Info » à gauche de votre query. Dans le pop-over, notez le « Query ID » (nombre en haut). C’est le second champ Ordium.",
        linkUrl: "https://www.interactivebrokers.com/campus/ibkr-api-page/flex-web-service/",
        linkLabel: "IBKR Campus : Flex Web Service",
      },
      {
        title: "Flex Web Service Configuration",
        body: "Toujours sous Flex Queries : ouvrez « Flex Web Service Configuration » (souvent à droite, ou via l’icône engrenage). Chemin guide : Performance & Reports → Flex Queries → Flex Web Service Configuration.",
        linkUrl: "https://www.ibkrguides.com/clientportal/performanceandstatements/flex-web-service.htm",
        linkLabel: "Guide IBKR : Enable Flex Web Service",
      },
      {
        title: "Activer Flex Web Service Status",
        body: "Cochez / activez la case à côté de « Flex Web Service Status », puis « Save ». Un « Current Token » apparaît pour les requêtes Flex.",
      },
      {
        title: "Generate A New Token (si besoin)",
        body: "Vous pouvez cliquer « Generate A New Token » pour invalider l’ancien. Choisissez la durée d’expiration (6 h à 1 an selon options) et une IP optionnelle. Copiez le « Current Token » — premier champ Ordium.",
      },
      {
        title: "Coller dans Ordium",
        body: "Premier champ = Current Token. Second champ = Query ID. Puis « Connecter ». Ordium appelle SendRequest puis GetStatement (v=3). Erreurs fréquentes IBKR : « Token has expired » (1012), « Token is invalid » (1015), « Query is invalid » (1014).",
      },
    ],
  },
};

export function isOAuthConfigured(id: ConnectableBrokerId): boolean {
  if (id === "coinbase") {
    return Boolean(
      process.env.NEXT_PUBLIC_COINBASE_OAUTH_CLIENT_ID?.trim() ||
        process.env.COINBASE_OAUTH_CLIENT_ID?.trim(),
    );
  }
  if (id === "alpaca") {
    return Boolean(
      process.env.NEXT_PUBLIC_ALPACA_OAUTH_CLIENT_ID?.trim() ||
        process.env.ALPACA_OAUTH_CLIENT_ID?.trim(),
    );
  }
  return false;
}

export function isOAuthConfiguredClient(id: ConnectableBrokerId): boolean {
  if (typeof window === "undefined") return isOAuthConfigured(id);
  if (id === "coinbase") {
    return Boolean(process.env.NEXT_PUBLIC_COINBASE_OAUTH_CLIENT_ID?.trim());
  }
  if (id === "alpaca") {
    return Boolean(process.env.NEXT_PUBLIC_ALPACA_OAUTH_CLIENT_ID?.trim());
  }
  return false;
}

export function effectiveAuthMode(_id: ConnectableBrokerId): BrokerAuthMode {
  return "api_key";
}
