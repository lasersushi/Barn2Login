import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { discordIdFromOAuthCode } from "@/discord/api";
import { isAdmin, setAdminSession } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";

// Discord redirects here after the mentor approves the login.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  const jar = await cookies();
  const expected = jar.get("b2_oauth_state")?.value;
  jar.delete({ name: "b2_oauth_state", path: "/api/auth/discord" });

  if (!code || !state || !expected || !safeEqual(state, expected)) {
    return new Response("Login expired or was started somewhere else. Go back and try again.", {
      status: 400,
    });
  }

  const discordId = await discordIdFromOAuthCode(code);
  if (!(await isAdmin(discordId))) {
    return new Response("This Discord account doesn't have the leadership role in the team server.", {
      status: 403,
    });
  }

  await setAdminSession(discordId);
  redirect("/admin");
}
