import { isIP } from "node:net";

// The member's public IP. On Vercel, x-forwarded-for is set by Vercel's edge
// and its first entry is the client. Returns null rather than guessing.
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim();
  return candidate && isIP(candidate) ? candidate : null;
}
