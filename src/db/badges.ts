import "server-only";
import { db } from "@/db/client";
import { randomToken, sha256Hex } from "@/lib/crypto";

// Printed badges for members without a phone (Design.md §5d). A badge is the
// long-lived member token: the QR holds it in full, members.token_hash holds
// only its sha256 (CLAUDE.md invariant #5). One badge per member; making a
// new one replaces the hash, so a lost badge stops working.

// Marks a badge QR so the kiosk can tell it apart from a one-time QR.
export const BADGE_PREFIX = "b2badge:";

export type BadgeHolder = { id: string; first_name: string; last_name: string };

// Returns the text to encode in the QR, or null if the member is inactive.
// This is the only time the token exists in readable form: print it now.
export async function issueBadge(
  memberId: string,
): Promise<{ qrText: string; firstName: string; lastName: string } | null> {
  const token = randomToken();
  const [member] = await db()<{ first_name: string; last_name: string }[]>`
    update members set token_hash = ${sha256Hex(token)}
    where id = ${memberId} and active
    returning first_name, last_name
  `;
  if (!member) return null;
  return { qrText: BADGE_PREFIX + token, firstName: member.first_name, lastName: member.last_name };
}

export async function revokeBadge(memberId: string): Promise<void> {
  await db()`update members set token_hash = null where id = ${memberId}`;
}

export async function listBadgeHolders(): Promise<BadgeHolder[]> {
  return db()<BadgeHolder[]>`
    select id, first_name, last_name from members
    where token_hash is not null
    order by last_name, first_name
  `;
}
