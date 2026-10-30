import "server-only";
import { db } from "@/db/client";
import { consumeCode } from "@/db/codes";
import { randomToken, sha256Hex } from "@/lib/crypto";

// The permanent QR members keep on their phone (Design.md §5a). Like a
// printed badge, it holds a long-lived member token in full and
// members.qr_token_hash holds only its sha256 (CLAUDE.md invariant #5).
// It has its own column so a member's phone QR and badge never replace
// each other.

// Marks a phone QR so the kiosk can tell it apart from a badge.
export const PHONE_QR_PREFIX = "b2qr:";

export type PhoneQrResult = { ok: true; qrText: string; firstName: string } | { ok: false };

// The member tapped the one-time link from /my-qr. Each redemption makes a
// new token and replaces the hash, so the member's previous QR stops
// working: /my-qr reset:True is how a lost or leaked QR gets turned off.
// The token can't be shown again later, since only its hash is kept.
export async function redeemForPhoneQr(redeemToken: string): Promise<PhoneQrResult> {
  return db().begin(async (tx) => {
    const redeem = await consumeCode(tx, "redeem", redeemToken);
    if (!redeem?.member_id) return { ok: false } as const;

    const token = randomToken();
    const [member] = await tx<{ first_name: string }[]>`
      update members set qr_token_hash = ${sha256Hex(token)}
      where id = ${redeem.member_id} and active
      returning first_name
    `;
    if (!member) return { ok: false } as const;
    return { ok: true, qrText: PHONE_QR_PREFIX + token, firstName: member.first_name } as const;
  });
}
