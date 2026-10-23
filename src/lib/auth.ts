import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fetchMemberRoles } from "@/discord/api";
import { hmac, safeEqual } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";

const ADMIN_COOKIE = "b2_admin";
const KIOSK_COOKIE = "b2_kiosk";
const ADMIN_MAX_AGE_S = 7 * 24 * 60 * 60;
const KIOSK_MAX_AGE_S = 365 * 24 * 60 * 60;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// A signed cookie is "<base64url json>.<hmac>". Anyone can read the payload,
// but nobody without SESSION_SECRET can produce a valid signature for it.
export function seal(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function unseal<T>(value: string | undefined): T | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  if (!safeEqual(value.slice(dot + 1), hmac(body))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Admin: anyone with the ADMIN_ROLE_ID role in the team server. Mentors sign
// in to /admin with Discord, and the role is re-checked on every request, so
// taking the role away in Discord revokes access immediately.
// ---------------------------------------------------------------------------

// For slash commands: Discord includes the member's roles in the payload.
export function hasAdminRole(roles: string[] | undefined): boolean {
  return roles?.includes(requireEnv("ADMIN_ROLE_ID")) ?? false;
}

// For the website: login only gives us a user ID, so ask Discord for roles.
export async function isAdmin(discordId: string): Promise<boolean> {
  return hasAdminRole(await fetchMemberRoles(discordId));
}

type AdminSession = { discordId: string; exp: number };

export async function setAdminSession(discordId: string) {
  const session: AdminSession = { discordId, exp: Date.now() + ADMIN_MAX_AGE_S * 1000 };
  (await cookies()).set(ADMIN_COOKIE, seal(session), { ...cookieOptions, maxAge: ADMIN_MAX_AGE_S });
}

export async function clearAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function getAdmin(): Promise<{ discordId: string } | null> {
  const session = unseal<AdminSession>((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!session || session.exp < Date.now() || !(await isAdmin(session.discordId))) {
    return null;
  }
  return { discordId: session.discordId };
}

// Call at the top of every admin page and every admin Server Action.
// Server Actions are reachable by direct POST, so the page check alone
// does not protect them.
export async function requireAdmin(): Promise<{ discordId: string }> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

// ---------------------------------------------------------------------------
// Kiosk: the iPad proves it is the kiosk with a cookie set once by entering
// KIOSK_SECRET. The cookie holds an HMAC of the secret, never the secret, and
// changing either KIOSK_SECRET or SESSION_SECRET logs the kiosk out.
// ---------------------------------------------------------------------------

function kioskCookieValue(): string {
  return hmac(`kiosk:${requireEnv("KIOSK_SECRET")}`);
}

export function checkKioskSecret(input: string): boolean {
  return safeEqual(input, requireEnv("KIOSK_SECRET"));
}

export async function setKioskSession() {
  (await cookies()).set(KIOSK_COOKIE, kioskCookieValue(), { ...cookieOptions, maxAge: KIOSK_MAX_AGE_S });
}

export async function isKioskPage(): Promise<boolean> {
  const value = (await cookies()).get(KIOSK_COOKIE)?.value;
  return value !== undefined && safeEqual(value, kioskCookieValue());
}

// Route handlers get the plain Request so this also works under tests.
export function isKioskRequest(req: Request): boolean {
  const value = readCookie(req.headers.get("cookie"), KIOSK_COOKIE);
  return value !== undefined && safeEqual(value, kioskCookieValue());
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
