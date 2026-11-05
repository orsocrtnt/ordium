import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_BROKER_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_TOKEN_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  appOrigin,
  exchangeCode,
  fetchHoldingsWithOAuth,
  getOAuthClient,
  savePortfolioViaApi,
  type OAuthBroker,
} from "@/lib/oauth-server";
import { userScopeFromEmail } from "@/lib/userScope";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ broker: string }> },
) {
  const { broker: raw } = await ctx.params;
  const broker = raw.toLowerCase() as OAuthBroker;
  const origin = appOrigin(req);
  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/dashboard?oauth=error&msg=${encodeURIComponent(msg)}`);

  if (broker !== "coinbase" && broker !== "alpaca") {
    return fail("Broker OAuth inconnu.");
  }

  const err = req.nextUrl.searchParams.get("error");
  if (err) return fail(`Autorisation refusée (${err})`);

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return fail("Callback OAuth incomplet.");

  const savedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const savedBroker = req.cookies.get(OAUTH_BROKER_COOKIE)?.value;
  const verifier = req.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  if (!savedState || state !== savedState) return fail("State OAuth invalide (CSRF).");
  if (savedBroker && savedBroker !== broker) return fail("Broker OAuth incohérent.");
  if (!verifier) return fail("PKCE verifier manquant — relancez la connexion.");

  const client = getOAuthClient(broker);
  if (!client) return fail("Secrets OAuth manquants côté serveur.");

  const redirectUri = `${origin}/api/oauth/${broker}/callback`;

  try {
    const tokens = await exchangeCode({
      broker,
      code,
      redirectUri,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      codeVerifier: verifier,
    });

    let userKey: string | undefined;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) userKey = userScopeFromEmail(data.user.email);
    } catch {
      // ignore — sync sans scope si pas de session
    }

    let importOk = false;
    let importWarning = "";
    try {
      const { holdings, warnings } = await fetchHoldingsWithOAuth(
        broker,
        tokens.access_token,
      );
      if (holdings.length > 0) {
        await savePortfolioViaApi({ broker, holdings, warnings, userKey });
        importOk = true;
      } else {
        importWarning = "Compte lié, aucune position trouvée pour l’instant.";
      }
    } catch (e) {
      importWarning = `Compte autorisé, sync positions : ${(e as Error).message}`;
    }

    const q = new URLSearchParams({
      oauth: "ok",
      broker,
      ...(importOk ? { imported: "1" } : {}),
      ...(importWarning ? { msg: importWarning } : {}),
    });
    const res = NextResponse.redirect(`${origin}/dashboard?${q.toString()}`);
    res.cookies.set(
      OAUTH_TOKEN_COOKIE,
      JSON.stringify({
        broker,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        at: Date.now(),
      }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: origin.startsWith("https"),
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      },
    );
    res.cookies.delete(OAUTH_STATE_COOKIE);
    res.cookies.delete(OAUTH_BROKER_COOKIE);
    res.cookies.delete(OAUTH_VERIFIER_COOKIE);
    return res;
  } catch (e) {
    return fail((e as Error).message);
  }
}
