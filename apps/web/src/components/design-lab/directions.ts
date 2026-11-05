export type LabDirectionId = "current" | "rail" | "bento" | "signal" | "line";

export type LabScreenId = "login" | "start" | "strategy" | "execution";

export type LabDirection = {
  id: LabDirectionId;
  name: string;
  skill: string;
  summary: string;
  fonts: string;
  colors: string;
  motion: string;
};

export type LabScreen = {
  id: LabScreenId;
  name: string;
};

/** Current reste la référence. Les autres explorent surtout structure / densité. */
export const DIRECTIONS: LabDirection[] = [
  {
    id: "current",
    name: "Current",
    skill: "Baseline produit",
    summary: "Vert forêt, DM Sans, cartes claires — référence actuelle sur tout le parcours.",
    fonts: "DM Sans",
    colors: "#0b6e4f · #f7f7f5",
    motion: "Léger",
  },
  {
    id: "rail",
    name: "Progress Rail",
    skill: "Funnel 3-step · progress UX",
    summary: "Même ADN couleur. Rail vertical d’étapes + barre de progression — parcours plus guidé.",
    fonts: "DM Sans",
    colors: "#0b6e4f · #f7f7f5",
    motion: "Step highlight",
  },
  {
    id: "bento",
    name: "Bento Desk",
    skill: "Soft UI · Portfolio Grid",
    summary: "Grille bento pour hub + builder. Archivo / Space Grotesk, ombres soft, modules.",
    fonts: "Archivo + Space Grotesk",
    colors: "#0b6e4f · #fafafa",
    motion: "Stagger grid",
  },
  {
    id: "signal",
    name: "Signal Board",
    skill: "Financial Dashboard · dense",
    summary: "Densité desk : KPIs, statut paper/live, tables compactes. IBM Plex, rythme 8px.",
    fonts: "IBM Plex Sans",
    colors: "#0b6e4f · #f4f4f2",
    motion: "KPI fade",
  },
  {
    id: "line",
    name: "Editorial Line",
    skill: "Newsletter / content-first",
    summary: "Lecture d’abord : typo display, filets, une colonne. Accent forêt Ordium (pas de pink).",
    fonts: "Newsreader + Public Sans",
    colors: "#0b6e4f · #fafaf8",
    motion: "Reveal 12px",
  },
];

export const SCREENS: LabScreen[] = [
  { id: "login", name: "Login" },
  { id: "start", name: "Parcours" },
  { id: "strategy", name: "Stratégie" },
  { id: "execution", name: "Exécution" },
];

export const START_STEPS = [
  {
    n: 1,
    title: "Vos positions",
    body: "CSV, Excel, PDF ou saisie. Aucune clé API requise.",
    cta: "Importer ou saisir",
    done: true,
  },
  {
    n: 2,
    title: "Définir une stratégie",
    body: "Règles claires : RSI, dips, Fear & Greed… Backtest avant d’automatiser.",
    cta: "Ouvrir le builder",
    done: false,
  },
  {
    n: 3,
    title: "Connecter & automatiser",
    body: "Clé API broker, paper d’abord, live ensuite.",
    cta: "Connecter un broker",
    done: false,
  },
];
