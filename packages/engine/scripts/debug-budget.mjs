import { createRequire } from "module";
// use tsx via dynamic - actually run with vitest inline

const samples = [
  "150 chaque semaine du 1 au 7 sur BTC et ETH",
  "ok sans conseil : 200/mois le 5 sur googl",
  "300 par mois le 10 sur BTC ETH SOL",
];

for (const s of samples) {
  const t = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['']/g, "'");
  console.log("\n===", s);
  console.log("withPeriod", t.match(/(\d+(?:[.,]\d+)?)\s*(?:par|\/|chaque)\s*(?:mois|semaine)/));
  console.log("amountSur", t.match(/(\d+(?:[.,]\d+)?)\s+sur\s+(?:du\s+|de\s+|la\s+|le\s+|l['']\s*)?[a-z0-9.]{2,}/));
  console.log("withCur", t.match(/(\d+(?:[.,]\d+)?)\s*(eur|euros|usd|dollars?)/));
}
