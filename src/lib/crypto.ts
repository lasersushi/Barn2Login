import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/env";

// 32 random bytes, URL-safe. Used for redeem links and QR codes.
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

// Tokens are stored only as their sha256 (CLAUDE.md invariant #5).
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Keyed with SESSION_SECRET. Used to sign cookies so they can't be forged.
export function hmac(value: string): string {
  return createHmac("sha256", requireEnv("SESSION_SECRET")).update(value).digest("base64url");
}

// Compares secrets without leaking how many leading characters matched.
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
