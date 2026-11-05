/**
 * Politique mot de passe côté client (alignée dashboard Supabase).
 * Min. 10 car., 1 majuscule, 1 minuscule, 1 chiffre, 1 symbole.
 */

export type PasswordRuleId =
  | "minLength"
  | "upper"
  | "lower"
  | "digit"
  | "symbol";

export type PasswordRule = {
  id: PasswordRuleId;
  label: string;
  test: (password: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "minLength",
    label: "Au moins 10 caractères",
    test: (p) => p.length >= 10,
  },
  {
    id: "upper",
    label: "Une majuscule",
    test: (p) => /[A-ZÀ-Ý]/.test(p),
  },
  {
    id: "lower",
    label: "Une minuscule",
    test: (p) => /[a-zà-ÿ]/.test(p),
  },
  {
    id: "digit",
    label: "Un chiffre",
    test: (p) => /\d/.test(p),
  },
  {
    id: "symbol",
    label: "Un symbole (!@#$…)",
    test: (p) => /[^A-Za-zÀ-ÿ0-9\s]/.test(p),
  },
];

export type PasswordValidation = {
  ok: boolean;
  errors: string[];
  checks: Record<PasswordRuleId, boolean>;
};

export function validatePassword(password: string): PasswordValidation {
  const checks = {} as Record<PasswordRuleId, boolean>;
  const errors: string[] = [];
  for (const rule of PASSWORD_RULES) {
    const pass = rule.test(password);
    checks[rule.id] = pass;
    if (!pass) errors.push(rule.label);
  }
  return { ok: errors.length === 0, errors, checks };
}
