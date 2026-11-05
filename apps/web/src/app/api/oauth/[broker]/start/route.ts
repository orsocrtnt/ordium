import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_BROKER_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  appOrigin,
  buildAuthorizeUrl,
  getOAuthClient,
  makePkce,
  makeState,
  type OAuthBroker,
} from "@/lib/oauth-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ broker: string }> },
) {
  const { broker: raw } = await ctx.params;
  const broker = raw.toLowerCase() as OAuthBroker;
  if (broker !== "coinbase" && broker !== "alpaca") {
    return NextResponse.json({ error: "OAuth non supporté pour ce broker." }, { status: 400 });
  }

  const client = getOAuthClient(broker);
  if (!client) {
    return NextResponse.json(
      {
        error:
          broker === "coinbase"
            ? "Coinbase OAuth non configuré (COINBASE_OAUTH_CLIENT_ID + COINBASE_OAUTH_CLIENT_SECRET). Note : la création d’apps OAuth Coinbase est réservée aux partenaires approuvés — utilisez le guide clé API CDP en attendant."
            : "Alpaca OAuth non configuré (ALPACA_OAUTH_CLIENT_ID + ALPACA_OAUTH_CLIENT_SECRET).",
      },
      { status: 503 },
    );
  }

  const origin = appOrigin(req);
  const redirectUri = `${origin}/api/oauth/${broker}/callback`;
  const state = makeState();
  const { verifier, challenge } = makePkce();
  const authorize = buildAuthorizeUrl(
    broker,
    client.clientId,
    redirectUri,
    state,
    challenge,
  );

  const secure = origin.startsWith("https");
  const res = NextResponse.redirect(authorize);
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set(OAUTH_STATE_COOKIE, state, cookieOpts);
  res.cookies.set(OAUTH_BROKER_COOKIE, broker, cookieOpts);
  res.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, cookieOpts);
  return res;
}
