/**
 * Config Supabase côté app.
 * Clés : NEXT_PUBLIC_SUPABASE_URL + PUBLISHABLE_KEY (ou ANON_KEY legacy).
 */

export type SupabaseConfig = {
  url: string;
  key: string;
  configured: boolean;
};

export function getSupabaseConfig(): SupabaseConfig {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  ).trim();
  return {
    url,
    key,
    configured: Boolean(url && key),
  };
}
