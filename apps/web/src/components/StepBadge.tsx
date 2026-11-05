/** Pastille d’étape : neutre tant que non validée, verte une fois faite. */

export function StepBadge({
  n,
  done,
  size = "md",
}: {
  n: number;
  done: boolean;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-7 w-7 text-[10px]" : "h-8 w-8 text-xs";
  if (done) {
    return (
      <span
        className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-emerald-600 font-semibold text-white`}
        aria-label={`Étape ${n} terminée`}
      >
        ✓
      </span>
    );
  }
  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg)] font-semibold text-[var(--muted)]`}
      aria-label={`Étape ${n}`}
    >
      {n}
    </span>
  );
}

export function stepCardClass(done: boolean): string {
  return done
    ? "rounded-3xl border border-emerald-200 bg-emerald-50/80 p-5 sm:p-6"
    : "rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 sm:p-6";
}
