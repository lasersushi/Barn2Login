import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { oauthAuthorizeUrl } from "@/discord/api";
import { randomToken } from "@/lib/crypto";

// Starts mentor login. The random state is stored in a short-lived cookie and
// checked on the way back, so another site can't complete a login for you.
export async function GET() {
  const state = randomToken();
  (await cookies()).set("b2_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/discord",
    maxAge: 10 * 60,
  });
  redirect(oauthAuthorizeUrl(state));
}
