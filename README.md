# Ordium

**Turn conviction into execution**

Ordium est une plateforme d'automatisation de stratégies d'investissement. Elle ne prédit pas les marchés et ne donne aucun conseil financier : elle garantit que l'utilisateur applique fidèlement les règles qu'il a lui-même définies — sans émotions, sans oublis, avec discipline.

> Ce dépôt est en **Phase 1** : moteur de règles universel + application web de backtest interactif.

## Principe fondateur

Une stratégie est un **document déclaratif** — la "recette" — interprété par un **moteur unique**. Deux formats coexistent :

- **v0** (formulaire Smart DCA) : `budget`, `window`, `allocation`, `timing_rules`…
- **v1** (moteur de blocs) : `plans` + `rules` (quand / si / alors) + `constraints`

Le formulaire v0 se **compile** automatiquement vers v1. C'est le document v1 que le moteur exécute — le même que produiront le futur éditeur no-code et la création en langage naturel.

## Structure du monorepo

```
packages/engine   Moteur : schéma v0 + règles v1 (plans/conditions/actions),
                  indicateurs, calendrier, backtest, linter. Code pur, testé.
packages/data     Market Data Engine : fournisseurs gratuits derrière une
                  interface unique, routage automatique avec fallback,
                  limites de débit, cache read-through. Voir plus bas.
packages/portfolio Import de portefeuille (CSV/Excel + clés API lecture seule),
                  valorisation, reconstruction de la série réelle pour
                  comparaison au backtest.
apps/api          API Fastify (port 4000) : backtest, actifs, portefeuille.
                  Processus séparé du front — calcule sans bloquer l'UI.
apps/web          Front Next.js (port 3000) : UI seule, appelle l'API.
apps/cli          CLI : téléchargement de données de marché + backtests.
data/candles      Cache local des bougies (regénérable, non versionné).
data/portfolios   Portefeuille importé (clés API jamais stockées).
```

## Démarrage rapide

Prérequis : Node >= 20 et pnpm (`corepack enable`).

```bash
pnpm install
pnpm test

# Front (:3000) + API (:4000) en parallèle
pnpm dev
# → UI  http://localhost:3000
# → API http://localhost:4000/health

# Ou séparément : pnpm dev:api  /  pnpm dev:web
# NEXT_PUBLIC_API_URL (défaut http://localhost:4000) pointe le front vers l'API.
# Télécharger l'historique — le fournisseur gratuit est choisi automatiquement
pnpm ordium fetch BTC --quote EUR --from 2018-01-01      # crypto (défaut)
pnpm ordium fetch SPY --type etf --from 2015-01-01       # ETF
pnpm ordium fetch AAPL --type stock                      # action
pnpm ordium fetch '^GSPC' --type index                   # indice
pnpm ordium fetch EUR/USD --type forex                   # forex

# Backtester une stratégie (les données manquantes sont téléchargées au besoin)
pnpm ordium backtest -s apps/cli/examples/dca-crypto.json --from 2022-01-01 --to 2026-06-30
pnpm ordium backtest -s apps/cli/examples/dca-etf.json --from 2018-01-01

# Lister les données en cache
pnpm ordium data
```

## Market Data Engine (`packages/data`)

Le moteur de stratégie ne connaît jamais les fournisseurs : il consomme
`getHistoricalPrices(symbol, assetType, timeframe, from, to)` et reçoit des
séries de bougies, point final. Derrière cette interface :

- **Adaptateurs** — un fichier par fournisseur, déclarant ses capacités
  (classes d'actifs, timeframes, licence, limites réelles) :

  | Fournisseur | Classes | Rôle |
  |---|---|---|
  | Binance | crypto | primaire (historique + live, sans clé) |
  | Coinbase | crypto | fallback |
  | Kraken | crypto | fallback récent |
  | **Alpaca** | actions, ETF **US** | primaire actions — `ALPACA_API_KEY` + `ALPACA_API_SECRET` (plan Basic gratuit, feed IEX) |
  | Polygon | actions, ETF US | optionnel — `POLYGON_API_KEY` |
  | Yahoo Finance | actions/ETF EU, indices… | secours sans clé (MC.PA, IWDA.AS…) |

  Interactive Brokers n'est pas branché au MVP (Gateway TWS). Les connecteurs
  **portefeuille** Binance/Coinbase/Kraken existent déjà (import positions).

  Ajouter un fournisseur = un adaptateur de plus, zéro changement au moteur.
- **Routeur** — sélectionne les fournisseurs capables par priorité, bascule
  automatiquement sur le suivant en cas de panne (circuit breaker : 3 échecs
  → cooldown 15 min), de quota épuisé ou de symbole inconnu.
- **Limiteur de débit** — fenêtres glissantes à toutes les granularités
  (seconde → mois) : les fenêtres courtes font attendre, les quotas longs
  font basculer de fournisseur.
- **Cache read-through** — store local d'abord, fetch du delta manquant
  ensuite, fusion et sauvegarde. Un backtest sur des données déjà en cache
  ne coûte aucun appel API.

## Import de portefeuille (`packages/portfolio`)

Dans l'app web, le panneau **Mon portefeuille** permet d'importer votre
portefeuille réel, de le voir recréé (valeur, répartition, coût moyen),
puis de le comparer au backtest :

1. **Fichier** — CSV / Excel (parseur Ordium), **PDF ou screenshot**
   (Gemini Flash, clé `GEMINI_API_KEY` dans `apps/api/.env`). Revue des
   lignes avant validation. Exemple CSV :
   `apps/cli/examples/portfolio-sample.csv`.
2. **Clé API lecture seule** — Binance, Kraken ou Coinbase. Les clés
   servent le temps d'un appel puis sont oubliées ; seul le portefeuille
   normalisé est stocké dans `data/portfolios/`.
3. **Comparaison** — avec un historique de transactions, le graphique du
   backtest affiche une 3ᵉ courbe « Mon portefeuille » à côté de la
   stratégie testée et du DCA classique. Sans dates d'achat (positions
   seules), la valorisation et le bouton « Utiliser comme répartition »
   restent disponibles.

### Clé Gemini (extraction PDF / screenshot)

```bash
cp apps/api/env.example apps/api/.env
# Éditez apps/api/.env et collez :
# GEMINI_API_KEY=votre_clé
```

Obtenir une clé gratuite : https://aistudio.google.com/apikey  
La clé reste **uniquement côté API** (`apps/api/.env`) — jamais dans le front.
Redémarrez `pnpm dev` après l'avoir ajoutée. Vérifiez avec
`curl http://localhost:4000/health` → `"gemini": true`.

## Anatomie d'une stratégie

Voir `apps/cli/examples/`. Les blocs disponibles en v0 :

| Bloc | Rôle |
|---|---|
| `budget` | Montant et période (hebdomadaire, mensuelle, annuelle) |
| `window` | Fenêtre d'investissement (ex. du 1er au 7 du mois, ou lundi-mercredi) |
| `allocation` | Répartition entre actifs (les poids somment à 1) |
| `splitting` | Fractionnement du budget en N tranches, égales ou aléatoires (seedé, reproductible) |
| `regime_adjustment` | Multiplicateur de budget selon la tendance (prix vs SMA200 : haussier / neutre / baissier) |
| `timing_rules` | Déclencheurs (`dip_trigger`, `rsi_below`) et vetos (`avoid_ath`) |
| `cash_rules` | Réserve minimale de liquidités |

**Règle produit non négociable** : le DCA est toujours honoré. Les règles de timing optimisent le *quand*, jamais le *si* — toute tranche non déclenchée est exécutée avant la fin de la fenêtre (fallback). Chaque achat est rattaché à la règle qui l'a déclenché.

## Garanties du backtest

- **Anti-lookahead** : le moteur ne voit jamais une bougie future.
- **Frais inclus** (défaut 0,1 %) : la comparaison avec le DCA classique n'est pas flatteuse artificiellement.
- **Déterminisme** : même stratégie + mêmes données = même résultat, y compris le fractionnement "aléatoire" (générateur seedé).
- **Comparaison honnête** : chaque backtest est systématiquement comparé au même budget en DCA fixe sans règles.

Limitations v0 : bougies journalières, exécution au cours de clôture, pas de conversion de change entre devises de cotation.

## Feuille de route

- **Phase 0** — moteur Smart DCA, schéma, backtest, CLI, données historiques.
- **Phase 1 (ici)** — app web + moteur de règles v1 (compilation, évaluation, linter).
- **Phase 2** — paper trading : la stratégie tourne en réel avec de l'argent fictif, notifications.
- **Phase 3** — exécution réelle crypto via clés API *trade-only* (non-custodial), garde-fous, kill switch.
- **Phase 4** — exécution actions/ETF via un premier courtier, score d'adhérence, facturation.
- **Phase 5+** — éditeur visuel no-code, langage naturel, rééquilibrage, multi-brokers.

## Avertissement

Ordium n'est pas un conseiller en investissement. Le logiciel exécute exclusivement des règles définies par l'utilisateur. Les performances passées (backtests) ne préjugent pas des performances futures.
