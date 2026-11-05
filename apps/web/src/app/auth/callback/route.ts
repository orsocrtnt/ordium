import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * Callback après confirmation e-mail (PKCE) : échange le `code` contre une session cookie.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/start";
  const safeNext = next.startsWith("/") ? next : "/start";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirm`);
}
