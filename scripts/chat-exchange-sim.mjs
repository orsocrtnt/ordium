#!/usr/bin/env node
/**
 * Simulation d’échanges humains messagers → POST /api/strategy/interpret
 * Compte rendu : draft, source (gemini/lexical), incohérences, coût estimé.
 */
const API = process.env.ORDIUM_API ?? "http://127.0.0.1:4000";

/** Prix indicatifs Gemini Flash (USD / 1M tokens) — approx mars 2025–2026. */
const PRICE = { inPerM: 0.1, outPerM: 0.4 };
/** System prompt ~6.5k tokens (catalogue inclus) — estimation. */
const SYS_TOKENS = 6500;

const FIRST_BUY = "2023-06-15";

const TURNS = [
  { user: "salut ça va ?" },
  {
    user:
      "bon je voudrais mettre genre 200 tt les 5 du mois sur btc eth et sol et si le fear est sous 35 on double le budget",
  },
  { user: "euh c’est répartis hein pas chacun" },
  { user: "attends non en fait 200 chacun plutôt" },
  { user: "ajoute amazon aussi" },
  { user: "hmm je sais pas trop… garde le mix quoi" },
  { user: "ok je veux que pour amazon on mette le rsi" },
  { user: "rsi sous 30 on double sinon normal" },
  { user: "depuis mon premier achat" },
  {
    user: "finalement retire les cryptos je veux que les actions… non attends garde tout en fait",
  },
  { user: "c’est bon on peut simuler ?" },
];

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function assets(draft) {
  return (draft?.allocation ?? []).map((a) => a.asset).sort();
}

function pickAwaiting(unanswered, draft) {
  const u = (unanswered?.[0] ?? "").toLowerCase();
  if (/montant|budget|€|euro/.test(u)) return "budget";
  if (/fréquence|semaine|mois/.test(u)) return "frequency";
  if (/fenêtre|jours|du mois/.test(u)) return "window";
  if (/portefeuille|actifs|ticker/.test(u)) return "assets";
  if (/total|par actif|chacun|répart/.test(u)) return "budgetSplit";
  if (/mix|crypto|actions only|fear & greed/.test(u)) return "assetClassMix";
  if (/date|début|backtest|15\/03/.test(u)) return "startDate";
  // fallback from draft holes
  if (!draft?.budgetAmount) return "budget";
  if (!draft?.period) return "frequency";
  if (draft?.windowFrom == null) return "window";
  if (!(draft?.allocation?.length || draft?.assetsChoice === "portfolio")) return "assets";
  return null;
}

function findIssues(turn, prev, next, reply, source) {
  const issues = [];
  const u = turn.user.toLowerCase();

  // 1. ajoute Amazon → wipe
  if (/ajoute\s+amazon/.test(u) && prev.allocation?.length >= 2) {
    const a = assets(next);
    if (a.length === 1 && a[0] === "AMZN") {
      issues.push({
        sev: "CRITIQUE",
        msg: "« ajoute Amazon » a remplacé le panier par AMZN seul",
      });
    } else if (!a.includes("AMZN")) {
      issues.push({ sev: "HAUTE", msg: "Amazon non ajouté malgré « ajoute Amazon »" });
    } else if (a.length < (prev.allocation?.length ?? 0) + 1) {
      issues.push({
        sev: "HAUTE",
        msg: `Allocation réduite après ajoute (${assets(prev)} → ${a})`,
      });
    }
  }

  // 2. RSI pour amazon → wipe ou pas de RSI
  if (/rsi/.test(u) && /amazon|amzn/.test(u) && !/sous\s*\d|<\s*\d/.test(u)) {
    if (assets(next).length === 1 && assets(next)[0] === "AMZN" && assets(prev).length > 1) {
      issues.push({ sev: "CRITIQUE", msg: "« RSI pour Amazon » a wipe l’allocation" });
    }
    if (!next.rsiEnabled && !next.rsiScaleEnabled) {
      issues.push({
        sev: "MOYENNE",
        msg: "Intent RSI pour Amazon : RSI non activé (pas de seuil)",
      });
    }
  }

  // 3. RSI scale + F&G → RSI wipe
  if (/rsi/.test(u) && /sous|double/.test(u) && prev.fearGreedScaleEnabled) {
    if (next.fearGreedScaleEnabled && !next.rsiScaleEnabled && !next.rsiEnabled) {
      issues.push({
        sev: "CRITIQUE",
        msg: "F&G actif → RSI demandé mais RSI éteint après le tour",
      });
    }
  }

  // 4. budget = seuil RSI
  if (/rsi/.test(u) && next.budgetAmount === 30 && prev.budgetAmount && prev.budgetAmount !== 30) {
    issues.push({
      sev: "CRITIQUE",
      msg: `Budget écrasé par seuil RSI (${prev.budgetAmount} → 30)`,
    });
  }

  // 5. first buy
  if (/premier\s+achat/.test(u) && next.from !== FIRST_BUY) {
    issues.push({
      sev: "HAUTE",
      msg: `« depuis mon premier achat » → from=${next.from ?? "∅"} (attendu ${FIRST_BUY})`,
    });
  }

  // 6. flip flop mix / retire cryptos puis garde tout
  if (/garde\s+tout|garde\s+le\s+mix/.test(u) && /retire\s+les\s+cryptos|actions/.test(u)) {
    // message contradictoire : dernière intention = garde tout
    if (next.assetClassPolicy === "equity_only" && /garde\s+tout/.test(u)) {
      issues.push({
        sev: "MOYENNE",
        msg: "Message contradictoire : policy equity_only alors que « garde tout » en fin",
      });
    }
  }

  // 7. reply re-ask already answered
  const r = (reply ?? "").toLowerCase();
  if (next.budgetAmount && /quel montant|quel budget/.test(r)) {
    issues.push({ sev: "MOYENNE", msg: "Reply repose une question budget déjà connu" });
  }
  if (next.budgetSplit && /total|par actif|chacun/.test(r) && /c.?est|montant/.test(r)) {
    if (/total ou|par actif \?|répartis entre/.test(r)) {
      issues.push({ sev: "MOYENNE", msg: "Reply repose budgetSplit déjà tranché" });
    }
  }
  if (next.period && next.windowFrom != null && /quelle fréquence|quelle fenêtre/.test(r)) {
    issues.push({ sev: "MOYENNE", msg: "Reply repose fréquence/fenêtre déjà connus" });
  }

  // 8. 200 chacun → budget 600
  if (/200\s+chacun|chacun plutôt/.test(u)) {
    const n = next.allocation?.length ?? 0;
    if (n >= 2 && next.budgetAmount != null && next.budgetAmount < 200 * n * 0.9) {
      issues.push({
        sev: "HAUTE",
        msg: `« 200 chacun » mais budgetAmount=${next.budgetAmount} (attendu ~${200 * n})`,
      });
    }
  }

  // 9. conseil / validate without start date
  if (/simuler/.test(u) && !next.from) {
    if (!/date|début|quand/.test(r)) {
      issues.push({
        sev: "MOYENNE",
        msg: "Demande de simuler sans date de début, reply ne la demande pas clairement",
      });
    }
  }

  if (source === "lexical" && turn.user.split(" ").length > 8) {
    issues.push({
      sev: "BASSE",
      msg: "Tour long passé en lexical (Gemini court-circuité ou indispo)",
    });
  }

  return issues;
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

function draftSummary(d) {
  return {
    budget: d.budgetAmount,
    currency: d.currency,
    period: d.period,
    window: d.windowFrom != null ? `${d.windowFrom}→${d.windowTo}` : null,
    split: d.budgetSplit,
    assets: assets(d),
    fgScale: d.fearGreedScaleEnabled ?? false,
    fgGate: d.fearGreedEnabled ?? false,
    rsiScale: d.rsiScaleEnabled ?? false,
    rsiGate: d.rsiEnabled ?? false,
    classPolicy: d.assetClassPolicy ?? null,
    from: d.from ?? null,
    horizon: d.horizon ?? null,
  };
}

async function main() {
  const history = [];
  let draft = {};
  let awaitingField = null;
  const log = [];
  let geminiCalls = 0;
  let lexicalCalls = 0;
  let estIn = 0;
  let estOut = 0;
  const allIssues = [];

  console.log(`API: ${API}\n`);

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    const t0 = Date.now();
    let data;
    try {
      data = await interpret({
        prompt: turn.user,
        history,
        draft,
        awaitingField,
        portfolioCurrency: "EUR",
        firstTransactionDate: FIRST_BUY,
      });
    } catch (err) {
      console.error(`Tour ${i + 1} ERREUR:`, err.message);
      log.push({ n: i + 1, user: turn.user, error: err.message });
      break;
    }
    const ms = Date.now() - t0;
    const prev = { ...draft };
    draft = { ...draft, ...(data.patch ?? {}) };
    const reply = data.reply ?? "";
    const source = data.source ?? "?";
    if (source === "gemini") geminiCalls++;
    else lexicalCalls++;

    const payloadEst =
      SYS_TOKENS +
      estimateTokens(JSON.stringify(draft)) +
      estimateTokens(history.map((h) => h.text).join(" ")) +
      estimateTokens(turn.user) +
      200;
    const outEst = estimateTokens(reply) + 180;
    if (source === "gemini") {
      estIn += payloadEst;
      estOut += outEst;
    }

    const issues = findIssues(turn, prev, draft, reply, source);
    for (const iss of issues) allIssues.push({ turn: i + 1, ...iss });

    awaitingField = pickAwaiting(data.unanswered, draft);

    history.push({ role: "user", text: turn.user });
    history.push({ role: "assistant", text: reply });

    const entry = {
      n: i + 1,
      ms,
      source,
      user: turn.user,
      reply: reply.slice(0, 280),
      unanswered: data.unanswered?.slice(0, 2) ?? [],
      awaitingField,
      draft: draftSummary(draft),
      issues,
    };
    log.push(entry);

    console.log(`── Tour ${i + 1} [${source}] ${ms}ms ──`);
    console.log(`USER: ${turn.user}`);
    console.log(`ORDIUM: ${reply}`);
    console.log(`DRAFT:`, JSON.stringify(draftSummary(draft)));
    if (issues.length) {
      for (const iss of issues) console.log(`  ⚠ ${iss.sev}: ${iss.msg}`);
    }
    console.log("");
  }

  const costUsd = (estIn / 1e6) * PRICE.inPerM + (estOut / 1e6) * PRICE.outPerM;

  const report = {
    meta: {
      turns: log.length,
      geminiCalls,
      lexicalCalls,
      estInputTokens: estIn,
      estOutputTokens: estOut,
      estCostUsd: Number(costUsd.toFixed(5)),
      priceNote: `Estimation @ $${PRICE.inPerM}/M in + $${PRICE.outPerM}/M out (Flash approx). Tokens non renvoyés par l’API actuelle.`,
      firstTransactionDateSent: FIRST_BUY,
    },
    issues: allIssues,
    bySeverity: {
      CRITIQUE: allIssues.filter((x) => x.sev === "CRITIQUE").length,
      HAUTE: allIssues.filter((x) => x.sev === "HAUTE").length,
      MOYENNE: allIssues.filter((x) => x.sev === "MOYENNE").length,
      BASSE: allIssues.filter((x) => x.sev === "BASSE").length,
    },
    finalDraft: draftSummary(draft),
    turns: log,
  };

  const outPath = new URL("../tmp-chat-sim-report.json", import.meta.url);
  const { writeFileSync, mkdirSync } = await import("fs");
  try {
    mkdirSync(new URL("..", outPath), { recursive: true });
  } catch {}
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("════════ COMPTE RENDU ════════");
  console.log(JSON.stringify(report.meta, null, 2));
  console.log("Incohérences:", report.bySeverity);
  for (const iss of allIssues) {
    console.log(`  T${iss.turn} [${iss.sev}] ${iss.msg}`);
  }
  console.log("Draft final:", JSON.stringify(report.finalDraft, null, 2));
  console.log(`\nRapport JSON: ${outPath.pathname}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
