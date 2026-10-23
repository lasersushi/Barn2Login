import "server-only";
import { requireEnv } from "@/lib/env";

const API = "https://discord.com/api/v10";

export type GuildMember = {
  id: string;
  username: string;
  displayName: string;
};

// Everyone in the team server, for the roster's link dropdown.
// Requires "Server Members Intent" on the Bot tab of the Developer Portal.
export async function fetchGuildMembers(): Promise<GuildMember[]> {
  const res = await fetch(`${API}/guilds/${requireEnv("DISCORD_GUILD_ID")}/members?limit=1000`, {
    headers: { Authorization: `Bot ${requireEnv("DISCORD_BOT_TOKEN")}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Discord returned ${res.status} listing server members.`);
  }
  const members = (await res.json()) as {
    nick: string | null;
    user: { id: string; username: string; global_name: string | null; bot?: boolean };
  }[];
  return members
    .filter((m) => !m.user.bot)
    .map((m) => ({
      id: m.user.id,
      username: m.user.username,
      displayName: m.nick ?? m.user.global_name ?? m.user.username,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// The role IDs a user has in the team server, or [] if they aren't in it.
// Fetching one member doesn't need Server Members Intent; listing them does.
export async function fetchMemberRoles(discordId: string): Promise<string[]> {
  const res = await fetch(
    `${API}/guilds/${requireEnv("DISCORD_GUILD_ID")}/members/${encodeURIComponent(discordId)}`,
    { headers: { Authorization: `Bot ${requireEnv("DISCORD_BOT_TOKEN")}` }, cache: "no-store" },
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Discord returned ${res.status} looking up a member's roles.`);
  const member = (await res.json()) as { roles: string[] };
  return member.roles;
}

// ---------------------------------------------------------------------------
// OAuth2 for mentor login. Scope "identify" only: we need the user's ID.
// ---------------------------------------------------------------------------

export function oauthRedirectUri(): string {
  return `${requireEnv("APP_BASE_URL")}/api/auth/discord/callback`;
}

export function oauthAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("DISCORD_APPLICATION_ID"),
    response_type: "code",
    redirect_uri: oauthRedirectUri(),
    scope: "identify",
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

// Trades the one-time code from Discord's redirect for the user's Discord ID.
export async function discordIdFromOAuthCode(code: string): Promise<string> {
  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("DISCORD_APPLICATION_ID"),
      client_secret: requireEnv("DISCORD_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code,
      redirect_uri: oauthRedirectUri(),
    }),
  });
  if (!tokenRes.ok) throw new Error(`Discord token exchange failed: ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) throw new Error(`Discord user lookup failed: ${userRes.status}`);
  const user = (await userRes.json()) as { id: string };
  return user.id;
}
