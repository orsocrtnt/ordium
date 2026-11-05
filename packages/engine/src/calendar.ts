import type { Strategy } from "./schema.js";

/** Une fenêtre d'investissement instanciée sur le calendrier (bornes incluses). */
export interface WindowSpec {
  key: string;
  start: string;
  end: string;
}

export function toUTC(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}

/** 1 = lundi … 7 = dimanche. */
export function isoWeekday(date: string): number {
  const wd = toUTC(date).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Week-end calendaire (marchés actions / ETF — pas de séance). */
export function isWeekend(date: string): boolean {
  const wd = toUTC(date).getUTCDay();
  return wd === 0 || wd === 6;
}

/** Premier jour ouvré (lun–ven) ≥ date. Si date est déjà ouvré, retourne date. */
export function nextWeekdayOnOrAfter(date: string): string {
  let d = date;
  for (let i = 0; i < 7; i++) {
    if (!isWeekend(d)) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** Repousse une date tombant un week-end au lundi (ou jour ouvré suivant). */
export function toBusinessDay(date: string): string {
  return isWeekend(date) ? nextWeekdayOnOrAfter(date) : date;
}

/** Nombre de jours du mois (month: 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function mkDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Instancie les fenêtres d'investissement de la stratégie sur [from, to].
 * Seules les fenêtres entièrement incluses dans l'intervalle sont retenues
 * (pas de période partielle qui fausserait le backtest).
 */
export function resolveWindows(strategy: Strategy, from: string, to: string): WindowSpec[] {
  const { period } = strategy.budget;
  const w = strategy.window;
  const out: WindowSpec[] = [];

  if (period === "weekly") {
    let monday = addDays(from, 1 - isoWeekday(from));
    while (monday <= to) {
      const f = w.type === "day_of_week" ? w.from : 1;
      const t = w.type === "day_of_week" ? w.to : 7;
      const start = addDays(monday, f - 1);
      const end = addDays(monday, t - 1);
      if (start >= from && end <= to) out.push({ key: `S-${monday}`, start, end });
      monday = addDays(monday, 7);
    }
    return out;
  }

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  for (let y = fromYear; y <= toYear; y++) {
    if (period === "yearly" && w.type === "full_period") {
      const start = mkDate(y, 1, 1);
      const end = mkDate(y, 12, 31);
      if (start >= from && end <= to) out.push({ key: `A-${y}`, start, end });
      continue;
    }
    const months =
      period === "monthly"
        ? Array.from({ length: 12 }, (_, i) => i + 1)
        : [w.type === "day_of_month" ? (w.month ?? 1) : 1];
    for (const m of months) {
      const dim = daysInMonth(y, m);
      const f = w.type === "day_of_month" ? Math.min(w.from, dim) : 1;
      const t = w.type === "day_of_month" ? Math.min(w.to, dim) : dim;
      const start = mkDate(y, m, f);
      const end = mkDate(y, m, t);
      const key = period === "yearly" ? `A-${y}` : `M-${y}-${String(m).padStart(2, "0")}`;
      if (start >= from && end <= to) out.push({ key, start, end });
    }
  }
  return out;
}
