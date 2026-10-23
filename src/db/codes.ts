import "server-only";
import type postgres from "postgres";
import { db } from "@/db/client";
import { randomToken, sha256Hex } from "@/lib/crypto";

// The spec sets the QR TTL (Design.md §5a). The redeem link TTL is not in the
// spec; 10 minutes matches the QR so the whole flow has one number to explain.
export const REDEEM_TTL_MIN = 10;
export const QR_TTL_MIN = 10;

type Kind = "redeem" | "qr" | "backup";

// Code helpers run either standalone or inside a transaction.
type Db = postgres.Sql | postgres.TransactionSql;

// Marks a code used and returns its row, or null if it's unknown, expired,
// or already used. A single UPDATE, so two simultaneous redemptions of the
// same code can't both succeed.
export async function consumeCode(db: Db, kind: Kind, token: string) {
  const [row] = await db<{ member_id: string | null; ip_status: string | null }[]>`
    update pending_codes
    set used_at = now()
    where code_hash = ${sha256Hex(token)}
      and kind = ${kind}
      and used_at is null
      and expires_at > now()
    returning member_id, ip_status
  `;
  return row ?? null;
}

async function issueCode(
  db: Db,
  input: { kind: Kind; memberId: string; ttlMin: number; ipAddress?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const [row] = await db<{ expires_at: Date }[]>`
    insert into pending_codes (member_id, kind, code_hash, expires_at, ip_address)
    values (
      ${input.memberId},
      ${input.kind},
      ${sha256Hex(token)},
      now() + make_interval(mins => ${input.ttlMin}),
      ${input.ipAddress ?? null}
    )
    returning expires_at
  `;
  return { token, expiresAt: row.expires_at };
}

// Step 2 of /sign-in: the one-time link the bot sends.
export async function issueRedeemCode(memberId: string) {
  return issueCode(db(), { kind: "redeem", memberId, ttlMin: REDEEM_TTL_MIN });
}

export type RedeemResult =
  | { ok: true; token: string; expiresAt: Date; firstName: string }
  | { ok: false };

// Step 3–4 of /sign-in: the member taps the link, we see their real IP, and
// issue the QR they'll show the kiosk. ip_status stays null until IP
// enforcement is built (Design.md §12 step 10); the raw IP is logged now.
export async function redeemForQr(redeemToken: string, ipAddress: string | null): Promise<RedeemResult> {
  return db().begin(async (tx) => {
    const redeem = await consumeCode(tx, "redeem", redeemToken);
    if (!redeem?.member_id) return { ok: false } as const;

    const [member] = await tx<{ first_name: string; active: boolean }[]>`
      select first_name, active from members where id = ${redeem.member_id}
    `;
    if (!member?.active) return { ok: false } as const;

    const qr = await issueCode(tx, {
      kind: "qr",
      memberId: redeem.member_id,
      ttlMin: QR_TTL_MIN,
      ipAddress,
    });
    return { ok: true, token: qr.token, expiresAt: qr.expiresAt, firstName: member.first_name } as const;
  });
}
