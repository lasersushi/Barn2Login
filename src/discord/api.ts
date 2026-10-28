import "server-only";
import { requireEnv } from "@/lib/env";

const API = "https://discord.com/api/v10";

export type GuildMember = {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
};

// What the server shows: the server nickname, else the account's display
// name, else the username.
export function discordDisplayName(nick: string | null | undefined, user: DiscordUser): string {
  return nick || user.global_name || user.username;
}

type DiscordUser = { id: string; username: string; global_name?: string | null; bot?: boolean };

const PAGE_SIZE = 1000; // Discord's maximum per request

// Everyone in the team server; the roster is synced from this.
// Requires "Server Members Intent" on the Bot tab of the Developer Portal.
export async function fetchGuildMembers(): Promise<GuildMember[]> {
  const all: { nick: string | null; roles: string[]; user: DiscordUser }[] = [];
  // Pages are ordered by user ID; "after" continues from the last one seen.
  let after = "0";
  for (;;) {
    const res = await fetch(
      `${API}/guilds/${requireEnv("DISCORD_GUILD_ID")}/members?limit=${PAGE_SIZE}&after=${after}`,
      { headers: { Authorization: `Bot ${requireEnv("DISCORD_BOT_TOKEN")}` }, cache: "no-store" },
    );
    if (!res.ok) {
      throw new Error(`Discord returned ${res.status} listing server members.`);
    }
    const page = (await res.json()) as typeof all;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1].user.id;
  }
  return all
    .filter((m) => !m.user.bot)
    .map((m) => ({
      id: m.user.id,
      username: m.user.username,
      displayName: discordDisplayName(m.nick, m.user),
      roles: m.roles,
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
// Sending messages as the bot. No gateway needed: these are plain REST calls.
// ---------------------------------------------------------------------------

// Discord's error code for "this person doesn't accept DMs from server
// members" (or has blocked the bot). That's their setting, not a failure.
const CANNOT_DM = 50007;

// Nothing the bot sends should ping anyone, even if a nickname is "@everyone".
const NO_PINGS = { parse: [] };

// POST as the bot, waiting out one rate limit if Discord asks.
async function botPost(path: string, body: object): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bot ${requireEnv("DISCORD_BOT_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.status !== 429 || attempt > 0) return res;
    const { retry_after } = (await res.json()) as { retry_after: number };
    await new Promise((resolve) => setTimeout(resolve, retry_after * 1000));
  }
}

async function errorCode(res: Response): Promise<number | undefined> {
  return ((await res.json().catch(() => ({}))) as { code?: number }).code;
}

// DMs someone from the bot. Returns false if they don't accept DMs; any
// other problem throws.
export async function sendDirectMessage(discordId: string, content: string): Promise<boolean> {
  const channelRes = await botPost("/users/@me/channels", { recipient_id: discordId });
  if (!channelRes.ok) {
    if ((await errorCode(channelRes)) === CANNOT_DM) return false;
    throw new Error(`Discord returned ${channelRes.status} opening a DM.`);
  }
  const { id } = (await channelRes.json()) as { id: string };

  const messageRes = await botPost(`/channels/${id}/messages`, { content, allowed_mentions: NO_PINGS });
  if (messageRes.ok) return true;
  if ((await errorCode(messageRes)) === CANNOT_DM) return false;
  throw new Error(`Discord returned ${messageRes.status} sending a DM.`);
}

// Posts in a server channel. The bot needs "Send Messages" there.
export async function postChannelMessage(channelId: string, content: string): Promise<void> {
  const res = await botPost(`/channels/${encodeURIComponent(channelId)}/messages`, {
    content,
    allowed_mentions: NO_PINGS,
  });
  if (!res.ok) throw new Error(`Discord returned ${res.status} posting to channel ${channelId}.`);
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
