export function fmtMoney(value: number, currency: string, digits = 0): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
  }).format(value);
}

export function fmtNum(value: number, digits = 2): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value);
}

export function fmtPct(value: number, signed = true): string {
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} %`;
}

export function fmtMonth(date: string): string {
  const [y, m] = date.split("-");
  return `${m}/${y!.slice(2)}`;
}
