#!/usr/bin/env node
/**
 * 10 conversations variées → POST /api/strategy/interpret
 * Objectif : maximiser la surface de bugs (humain flou / contradictoire / SMS).
 */
const API = process.env.ORDIUM_API ?? "http://127.0.0.1:4000";
const FIRST_BUY = "2023-06-15";
const PRICE = { inPerM: 0.1, outPerM: 0.4 };
const SYS_TOKENS = 6500;

/** @type {{ id: string, title: string, goal: string, turns: string[] }[]} */
const CONVS = [
  {
    id: "C01",
    title: "Fear DCA + négation split + ajoute + RSI",
    goal: "Bugs: pas chacun, ajoute Amazon, RSI→budget, first buy",
    turns: [
      "salut",
      "200 tt les 5 du mois sur btc eth sol si fear sous 35 on double",
      "répartis pas chacun",
      "ajoute amazon",
      "garde le mix",
      "rsi pour amazon",
      "rsi sous 30 on double",
      "depuis mon premier achat",
      "on simule ?",
    ],
  },
  {
    id: "C02",
    title: "Flip flop total ↔ chacun",
    goal: "Bugs: split change d’avis, budget ×n mal appliqué",
    turns: [
      "150 chaque semaine du 1 au 7 sur BTC et ETH",
      "c’est au total",
      "non wait 150 chacun",
      "finalement total encore",
      "01/01/2024",
    ],
  },
  {
    id: "C03",
    title: "Mets aussi Google sans « ajoute »",
    goal: "Bugs: sticky 1 ticker / engine union vs ignore",
    turns: [
      "300 par mois le 10 sur BTC ETH SOL",
      "au total",
      "mets aussi Google",
      "et apple",
      "15/03/2023",
    ],
  },
  {
    id: "C04",
    title: "Actions only puis F&G collé",
    goal: "Bugs: equity_only vs F&G sticky / filtre cryptos",
    turns: [
      "200 tt les 1 du mois sur btc eth et amazon fear sous 40 on double",
      "répartis",
      "actions only",
      "non crypto only en fait",
      "depuis 2022",
    ],
  },
  {
    id: "C05",
    title: "F&G puis RSI coexistence",
    goal: "Bugs: F&G wipe RSI, seuils inventés",
    turns: [
      "dca 100€/mois le 1 sur BTC si fear bas on double",
      "total",
      "ajoute aussi le rsi sous 30 on double si rsi haut moitié",
      "2023-06-01",
    ],
  },
  {
    id: "C06",
    title: "Conseil + date année seule + SMS",
    goal: "Bugs: conseil interdit, année≠budget, SMS abrégé",
    turns: [
      "donne moi la meilleure strat sur google",
      "ok sans conseil : 200/mois le 5 sur googl",
      "tt les mois",
      "depuis 2024",
      "c bon ?",
    ],
  },
  {
    id: "C07",
    title: "Portefeuille oui puis custom",
    goal: "Bugs: assetsChoice portfolio → custom, wipe",
    turns: [
      "je veux un dca mensuel 250 le 1",
      "oui garde mon portefeuille",
      "attends non plutot que BTC ETH",
      "fear < 35 que si on achete",
      "01/06/2023",
    ],
  },
  {
    id: "C08",
    title: "Trimestriel + multi-intent même message",
    goal: "Bugs: cadence non supportée, multi-intent avalé",
    turns: [
      "tous les 3 mois 500 sur btc eth",
      "bon mensuel alors 500 le 15",
      "au total + fear double sous 35 + ajoute SOL",
      "mix ok",
      "premier achat",
    ],
  },
  {
    id: "C09",
    title: "Correction fenêtre / seuil fear",
    goal: "Bugs: sticky fear 35→40, fenêtre écrasée",
    turns: [
      "200 mensuel du 1 au 7 sur BTC fear 35 on achete que si",
      "passe la fenêtre au 10 du mois",
      "fear à 40 pas 35",
      "total",
      "15/01/2024",
    ],
  },
  {
    id: "C10",
    title: "Restart mid-flight + rebuild",
    goal: "Bugs: clearDraft, résidus, re-ask",
    turns: [
      "400 tt les semaines sur eth sol",
      "chacun",
      "oublie tout recommence",
      "100 le 1 du mois sur BTC only fear double sous 30",
      "total",
      "depuis mon premier achat",
    ],
  },
];

function assets(d) {
  return (d?.allocation ?? []).map((a) => a.asset).sort();
}

function estimateTokens(t) {
  return Math.ceil((t?.length ?? 0) / 3.5);
}

function pickAwaiting(unanswered, draft) {
  const u = (unanswered?.[0] ?? "").toLowerCase();
  if (/montant|budget|€|euro/.test(u)) return "budget";
  if (/fréquence|semaine|mois/.test(u)) return "frequency";
  if (/fenêtre|jours|du mois/.test(u)) return "window";
  if (/portefeuille|actifs|ticker|sur quels/.test(u)) return "assets";
  if (/total|par actif|chacun|répart/.test(u)) return "budgetSplit";
  if (/mix|crypto|actions only|fear & greed|garder le mix/.test(u)) return "assetClassMix";
  if (/date|début|backtest|15\/03/.test(u)) return "startDate";
  if (!draft?.budgetAmount) return "budget";
  if (!draft?.period) return "frequency";
  if (draft?.windowFrom == null) return "window";
  return null;
}

function draftSummary(d) {
  return {
    budget: d.budgetAmount ?? null,
    period: d.period ?? null,
    window:
      d.windowFrom != null ? `${d.windowFrom}→${d.windowTo ?? d.windowFrom}` : null,
    split: d.budgetSplit ?? null,
    assets: assets(d),
    assetsChoice: d.assetsChoice ?? null,
    fgScale: !!d.fearGreedScaleEnabled,
    fgGate: !!d.fearGreedEnabled,
    fgVal: d.fearGreedValue ?? d.fearGreedLowLte ?? null,
    rsiScale: !!d.rsiScaleEnabled,
    rsiGate: !!d.rsiEnabled,
    rsiVal: d.rsiValue ?? d.rsiLowLte ?? null,
    classPolicy: d.assetClassPolicy ?? null,
    from: d.from ?? null,
    horizon: d.horizon ?? null,
    requireSignal: !!d.requireSignal,
  };
}

/** Détection bugs sur un tour (prev → next). */
function detectBugs(user, prev, next, reply, source, ms) {
  const bugs = [];
  const u = user.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const r = (reply ?? "").toLowerCase();

  // A — négation « pas chacun »
  if (/reparti/.test(u) && /pas\s+chacun/.test(u) && next.budgetSplit === "per_asset") {
    bugs.push({
      id: "A_NEGATION_SPLIT",
      sev: "CRITIQUE",
      msg: "« répartis pas chacun » → per_asset",
    });
  }

  // B — ajoute X perdu
  const addM = u.match(/\b(?:ajoute|rajoute|ajouter)\s+(\w+)/);
  if (addM && prev.allocation?.length >= 1) {
    const name = addM[1];
    const map = {
      amazon: "AMZN",
      amzn: "AMZN",
      google: "GOOGL",
      apple: "AAPL",
      aapl: "AAPL",
      sol: "SOL",
      btc: "BTC",
      eth: "ETH",
    };
    const sym = map[name] ?? name.toUpperCase();
    if (!assets(next).includes(sym) && assets(next).length <= assets(prev).length) {
      bugs.push({
        id: "B_ADD_LOST",
        sev: "CRITIQUE",
        msg: `« ajoute ${name} » non reflété (${assets(prev)} → ${assets(next)})`,
      });
    }
  }

  // C — RSI pour X sans activer
  if (/\brsi\b/.test(u) && /\b(pour|sur)\b/.test(u) && !/sous\s*\d|<\s*\d/.test(u)) {
    if (!next.rsiEnabled && !next.rsiScaleEnabled) {
      bugs.push({
        id: "C_RSI_MENTION_NO_ENABLE",
        sev: "MOYENNE",
        msg: "RSI mentionné pour un actif mais non activé",
      });
    }
    if (assets(prev).length > 1 && assets(next).length === 1) {
      bugs.push({
        id: "C_RSI_WIPE_ALLOC",
        sev: "CRITIQUE",
        msg: "Phrase RSI a réduit l’allocation à 1 ticker",
      });
    }
  }

  // D — seuil RSI → budget
  if (/\brsi\b/.test(u) && (next.budgetAmount === 30 || next.budgetAmount === 40)) {
    if (prev.budgetAmount && prev.budgetAmount !== next.budgetAmount) {
      bugs.push({
        id: "D_RSI_AS_BUDGET",
        sev: "CRITIQUE",
        msg: `Budget ${prev.budgetAmount} → ${next.budgetAmount} (seuil RSI?)`,
      });
    }
  }

  // E — first buy
  if (/premier\s+achat|first\s+buy|depuis\s+le\s+debut/.test(u)) {
    if (next.from !== FIRST_BUY) {
      bugs.push({
        id: "E_FIRST_BUY",
        sev: "HAUTE",
        msg: `first buy → from=${next.from ?? "∅"} (attendu ${FIRST_BUY})`,
      });
    }
  }

  // F — année seule comme budget
  if (/depuis\s+20\d{2}\b/.test(u) && !/\d{1,2}[./-]/.test(u)) {
    const y = u.match(/20\d{2}/)?.[0];
    if (y && next.budgetAmount === Number(y)) {
      bugs.push({
        id: "F_YEAR_AS_BUDGET",
        sev: "CRITIQUE",
        msg: `Année ${y} devenue budget`,
      });
    }
  }

  // G — F&G wipe RSI
  if (/\brsi\b/.test(u) && /double|sous|moitie|moitié/.test(u) && prev.fearGreedScaleEnabled) {
    if (
      next.fearGreedScaleEnabled &&
      !next.rsiScaleEnabled &&
      !next.rsiEnabled &&
      (prev.rsiScaleEnabled || /rsi/.test(u))
    ) {
      bugs.push({
        id: "G_FG_WIPE_RSI",
        sev: "CRITIQUE",
        msg: "F&G actif a éteint / empêché RSI",
      });
    }
  }
  // RSI demandé avec F&G : si après tour F&G on et RSI off alors que phrase RSI scale
  if (/\brsi\b/.test(u) && /sous\s*\d/.test(u) && next.fearGreedScaleEnabled && !next.rsiScaleEnabled) {
    bugs.push({
      id: "G_FG_WIPE_RSI",
      sev: "CRITIQUE",
      msg: "Après message RSI scale, F&G on et RSI off",
    });
  }

  // H — equity_only garde cryptos
  if (next.assetClassPolicy === "equity_only") {
    const { crypto } = partitionRough(next.allocation);
    if (crypto.length) {
      bugs.push({
        id: "H_EQUITY_KEEPS_CRYPTO",
        sev: "HAUTE",
        msg: `equity_only mais cryptos restent: ${crypto.join(",")}`,
      });
    }
    if (next.fearGreedScaleEnabled || next.fearGreedEnabled) {
      bugs.push({
        id: "H_EQUITY_KEEPS_FG",
        sev: "HAUTE",
        msg: "equity_only mais F&G encore on",
      });
    }
  }

  // I — crypto_only garde actions
  if (next.assetClassPolicy === "crypto_only") {
    const { equity } = partitionRough(next.allocation);
    if (equity.length) {
      bugs.push({
        id: "I_CRYPTO_KEEPS_EQUITY",
        sev: "HAUTE",
        msg: `crypto_only mais actions: ${equity.join(",")}`,
      });
    }
  }

  // J — conseil
  if (/meilleure|conseil|devrais/.test(u)) {
    if (/smart dca|excellente|recommand|idéal|ideale/.test(r)) {
      bugs.push({
        id: "J_GAVE_ADVICE",
        sev: "HAUTE",
        msg: "Reply ressemble à un conseil d’investissement",
      });
    }
  }

  // K — trimestriel accepté
  if (/trimestre|tous les 3 mois|semestriel/.test(u) && next.period && !/hebdo|semaine|mensuel|mois/.test(r)) {
    if (next.period === "monthly" && !/pas encore|pas dispo|hebdomadaire|mensuel/.test(r)) {
      bugs.push({
        id: "K_QUARTERLY_SILENT",
        sev: "MOYENNE",
        msg: "Cadence non supportée peut-être avalée sans le dire",
      });
    }
  }

  // L — mets aussi / et apple sans ajoute
  if (/\b(mets\s+aussi|et\s+apple|et\s+google)\b/.test(u) && prev.allocation?.length >= 2) {
    const want = /google|googl/.test(u)
      ? "GOOGL"
      : /apple|aapl/.test(u)
        ? "AAPL"
        : null;
    if (want && !assets(next).includes(want) && assets(next).join() === assets(prev).join()) {
      bugs.push({
        id: "L_METS_AUSSI_IGNORED",
        sev: "HAUTE",
        msg: `« mets aussi / et X » ignoré (voulu ${want})`,
      });
    }
  }

  // M — re-ask
  if (next.budgetAmount && /quel montant|quel budget/.test(r)) {
    bugs.push({ id: "M_REASK_BUDGET", sev: "MOYENNE", msg: "Repose budget déjà connu" });
  }
  if (next.from && /quelle date|date de debut|date de début/.test(r)) {
    bugs.push({ id: "M_REASK_DATE", sev: "MOYENNE", msg: "Repose date déjà connue" });
  }

  // N — simuler sans date
  if (/simul/.test(u) && !next.from && !/date|debut|début/.test(r)) {
    bugs.push({
      id: "N_SIM_NO_DATE",
      sev: "MOYENNE",
      msg: "Simuler demandé sans date, reply ne la force pas",
    });
  }

  // O — fear gate value sticky
  if (/fear\s*(a|à|=)\s*40|fear\s*40\b/.test(u)) {
    if (next.fearGreedValue != null && next.fearGreedValue !== 40) {
      bugs.push({
        id: "O_FEAR_STICKY_WRONG",
        sev: "HAUTE",
        msg: `Fear demandé 40, valeur=${next.fearGreedValue}`,
      });
    }
  }

  // P — fenêtre
  if (/fenetre|fenêtre|passe.*10|au 10/.test(u)) {
    if (next.windowFrom != null && next.windowFrom !== 10 && /10/.test(u)) {
      bugs.push({
        id: "P_WINDOW_NOT_UPDATED",
        sev: "HAUTE",
        msg: `Fenêtre non passée à 10 (reste ${next.windowFrom}→${next.windowTo})`,
      });
    }
  }

  // Q — restart pas clear
  if (/oublie\s+tout|recommence|repartir|a\s+zero|à\s+zéro|reset/.test(u)) {
    const keys = Object.keys(next).filter((k) => next[k] != null && next[k] !== false);
    if (next.budgetAmount || (next.allocation?.length ?? 0) > 0) {
      bugs.push({
        id: "Q_RESTART_DIRTY",
        sev: "HAUTE",
        msg: `Restart mais brouillon encore peuplé (${keys.slice(0, 8).join(",")})`,
      });
    }
  }

  // R — 200 chacun budget
  if (/\b(\d+)\s*chacun\b/.test(u) || /chacun plutôt|chacun plutot/.test(u)) {
    const n = next.allocation?.length ?? 0;
    const m = u.match(/\b(\d+)\s*chacun/);
    const unit = m ? Number(m[1]) : 200;
    if (n >= 2 && next.budgetAmount != null && Math.abs(next.budgetAmount - unit * n) > 1) {
      // only if split is per_asset or just said chacun
      if (next.budgetSplit === "per_asset" || /chacun/.test(u)) {
        bugs.push({
          id: "R_CHACUN_BUDGET",
          sev: "HAUTE",
          msg: `chacun ${unit}×${n} attendu ~${unit * n}, got ${next.budgetAmount}`,
        });
      }
    }
  }

  // S — contradiction garde tout vs equity
  if (/garde\s+tout|garde\s+le\s+mix/.test(u) && /retire|actions\s+only|crypto\s+only/.test(u)) {
    if (next.assetClassPolicy === "equity_only" && /garde\s+tout/.test(u)) {
      bugs.push({
        id: "S_CONTRADICTION_LAST_WINS",
        sev: "MOYENNE",
        msg: "Message contradictoire: dernière intention « garde tout » non respectée",
      });
    }
  }

  // T — gemini slow labeled lexical
  if (source === "lexical" && ms > 2000) {
    bugs.push({
      id: "T_SLOW_LABELED_LEXICAL",
      sev: "BASSE",
      msg: `Tour ${ms}ms marqué lexical (Gemini probable, label trompeur)`,
    });
  }

  // U — fear scale invente high
  if (/fear/.test(u) && /double|sous/.test(u) && !/80|moitie|moitié|haut/.test(u)) {
    if (next.fearGreedScaleEnabled && next.fearGreedHighGte === 80) {
      bugs.push({
        id: "U_FG_INVENT_HIGH",
        sev: "MOYENNE",
        msg: "Fear scale: seuil haut 80 inventé (non dit)",
      });
    }
  }

  return bugs;
}

function partitionRough(allocation) {
  const CRYPTO = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX"]);
  const crypto = [];
  const equity = [];
  for (const a of allocation ?? []) {
    const s = a.asset.toUpperCase();
    if (CRYPTO.has(s)) crypto.push(s);
    else equity.push(s);
  }
  return { crypto, equity };
}

async function interpret(body) {
  const res = await fetch(`${API}/api/strategy/interpret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

async function runConv(conv) {
  const history = [];
  let draft = {};
  let awaitingField = null;
  const turns = [];
  const bugs = [];
  let geminiLabeled = 0;
  let lexicalLabeled = 0;
  let slowLexical = 0;
  let estIn = 0;
  let estOut = 0;

  for (let i = 0; i < conv.turns.length; i++) {
    const user = conv.turns[i];
    const t0 = Date.now();
    let data;
    try {
      data = await interpret({
        prompt: user,
        history,
        draft,
        awaitingField,
        portfolioCurrency: "EUR",
        firstTransactionDate: FIRST_BUY,
      });
    } catch (err) {
      turns.push({ n: i + 1, user, error: err.message });
      bugs.push({
        turn: i + 1,
        id: "Z_API_ERROR",
        sev: "CRITIQUE",
        msg: err.message,
      });
      break;
    }
    const ms = Date.now() - t0;
    const prev = { ...draft };
    draft = { ...draft, ...(data.patch ?? {}) };
    // Sur restart, patch peut être {}
    if (data.clearDraft) draft = { ...(data.patch ?? {}) };

    const reply = data.reply ?? "";
    const source = data.source ?? "?";
    if (source === "gemini") geminiLabeled++;
    else {
      lexicalLabeled++;
      if (ms > 2000) {
        slowLexical++;
        estIn += SYS_TOKENS + estimateTokens(user) + 500;
        estOut += estimateTokens(reply) + 150;
      }
    }
    if (source === "gemini") {
      estIn += SYS_TOKENS + estimateTokens(user) + 500;
      estOut += estimateTokens(reply) + 150;
    }

    const found = detectBugs(user, prev, draft, reply, source, ms);
    for (const b of found) bugs.push({ turn: i + 1, ...b });

    awaitingField = pickAwaiting(data.unanswered, draft);
    history.push({ role: "user", text: user });
    history.push({ role: "assistant", text: reply });

    turns.push({
      n: i + 1,
      ms,
      source,
      user,
      reply: reply.slice(0, 320),
      unanswered: (data.unanswered ?? []).slice(0, 2),
      awaitingField,
      draft: draftSummary(draft),
      bugs: found,
    });
  }

  const costUsd = (estIn / 1e6) * PRICE.inPerM + (estOut / 1e6) * PRICE.outPerM;

  return {
    id: conv.id,
    title: conv.title,
    goal: conv.goal,
    turns,
    bugs,
    bySev: {
      CRITIQUE: bugs.filter((b) => b.sev === "CRITIQUE").length,
      HAUTE: bugs.filter((b) => b.sev === "HAUTE").length,
      MOYENNE: bugs.filter((b) => b.sev === "MOYENNE").length,
      BASSE: bugs.filter((b) => b.sev === "BASSE").length,
    },
    finalDraft: draftSummary(draft),
    meta: {
      geminiLabeled,
      lexicalLabeled,
      slowLexicalLikelyGemini: slowLexical,
      estCostUsd: Number(costUsd.toFixed(5)),
    },
  };
}

async function main() {
  console.log(`API ${API} — ${CONVS.length} conversations\n`);
  const results = [];
  for (const conv of CONVS) {
    console.log(`\n████ ${conv.id} — ${conv.title}`);
    console.log(`    (${conv.goal})`);
    const r = await runConv(conv);
    results.push(r);
    for (const t of r.turns) {
      console.log(`  T${t.n} [${t.source}/${t.ms}ms] U: ${t.user}`);
      if (t.error) console.log(`       ERR ${t.error}`);
      else console.log(`       O: ${(t.reply ?? "").slice(0, 140)}`);
      for (const b of t.bugs ?? []) console.log(`       ⚠ ${b.sev} ${b.id}: ${b.msg}`);
    }
    console.log(
      `  → bugs ${JSON.stringify(r.bySev)} | final ${JSON.stringify(r.finalDraft)}`,
    );
  }

  // Agrégat
  const allBugs = results.flatMap((r) =>
    r.bugs.map((b) => ({ conv: r.id, ...b })),
  );
  const byId = {};
  for (const b of allBugs) {
    byId[b.id] = byId[b.id] ?? { id: b.id, sev: b.sev, count: 0, convs: new Set() };
    byId[b.id].count++;
    byId[b.id].convs.add(b.conv);
  }
  const catalog = Object.values(byId)
    .map((x) => ({
      id: x.id,
      sev: x.sev,
      count: x.count,
      convs: [...x.convs],
    }))
    .sort((a, b) => b.count - a.count);

  const totalCost = results.reduce((s, r) => s + r.meta.estCostUsd, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    firstTransactionDateSent: FIRST_BUY,
    conversations: results.length,
    totalTurns: results.reduce((s, r) => s + r.turns.length, 0),
    totalBugs: allBugs.length,
    bySeverity: {
      CRITIQUE: allBugs.filter((b) => b.sev === "CRITIQUE").length,
      HAUTE: allBugs.filter((b) => b.sev === "HAUTE").length,
      MOYENNE: allBugs.filter((b) => b.sev === "MOYENNE").length,
      BASSE: allBugs.filter((b) => b.sev === "BASSE").length,
    },
    bugCatalog: catalog,
    estCostUsdTotal: Number(totalCost.toFixed(4)),
    results,
  };

  const { writeFileSync } = await import("fs");
  const out = new URL("../tmp-chat-sim-10.json", import.meta.url);
  writeFileSync(out, JSON.stringify(report, null, 2));

  console.log("\n\n════════ SYNTHÈSE 10 CONV ════════");
  console.log(`Tours: ${report.totalTurns} | Bugs détectés: ${report.totalBugs}`);
  console.log("Sévérité:", report.bySeverity);
  console.log(`Coût estimé (Gemini lent/label): ~$${report.estCostUsdTotal}`);
  console.log("\nCatalogue bugs (fréquence):");
  for (const c of catalog) {
    console.log(`  ${c.count}× [${c.sev}] ${c.id} — convs ${c.convs.join(",")}`);
  }
  console.log(`\nJSON: ${out.pathname}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
