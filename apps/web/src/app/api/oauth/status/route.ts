import { NextResponse } from "next/server";
import { isOAuthReadyServer } from "@/lib/oauth-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Indique quels brokers OAuth sont réellement configurés (secrets serveur). */
export async function GET() {
  return NextResponse.json({
    coinbase: {
      ready: isOAuthReadyServer("coinbase"),
      note: isOAuthReadyServer("coinbase")
        ? "OAuth prêt"
        : "Réservé aux partenaires Coinbase approuvés — utilisez le guide clé CDP, ou ajoutez COINBASE_OAUTH_CLIENT_ID/SECRET si vous avez une app.",
    },
    alpaca: {
      ready: isOAuthReadyServer("alpaca"),
      note: isOAuthReadyServer("alpaca")
        ? "OAuth prêt"
        : "Créez une OAuth App Alpaca et ajoutez ALPACA_OAUTH_CLIENT_ID + ALPACA_OAUTH_CLIENT_SECRET (+ NEXT_PUBLIC_ALPACA_OAUTH_CLIENT_ID).",
    },
    redirectUris: {
      coinbase: "{APP_URL}/api/oauth/coinbase/callback",
      alpaca: "{APP_URL}/api/oauth/alpaca/callback",
    },
  });
}
