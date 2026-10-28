import "server-only";
import type postgres from "postgres";
import { db } from "@/db/client";
import { randomToken, sha256Hex } from "@/lib/crypto";

// Not in the spec. Long enough to walk from Discord to the link, short
// enough that an old link sitting in Discord is useless.
export const REDEEM_TTL_MIN = 10;

type Kind = "redeem" | "qr" | "backup";

// Code helpers run either standalone or inside a transaction.
type Db = postgres.Sql | postgres.TransactionSql;

// Marks a code used and returns its row, or null if it's unknown, expired,
// or already used. A single UPDATE, so two simultaneous redemptions of the
// same code can't both succeed.
export async function consumeCode(db: Db, kind: Kind, token: string) {
  const [row] = await db<{ member_id: string | null }[]>`
    update pending_codes
    set used_at = now()
    where code_hash = ${sha256Hex(token)}
      and kind = ${kind}
      and used_at is null
      and expires_at > now()
    returning member_id
  `;
  return row ?? null;
}

async function issueCode(
  db: Db,
  input: { kind: Kind; memberId: string; ttlMin: number },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const [row] = await db<{ expires_at: Date }[]>`
    insert into pending_codes (member_id, kind, code_hash, expires_at)
    values (
      ${input.memberId},
      ${input.kind},
      ${sha256Hex(token)},
      now() + make_interval(mins => ${input.ttlMin})
    )
    returning expires_at
  `;
  return { token, expiresAt: row.expires_at };
}

// /my-qr: the one-time link the bot sends. Tapping it gets the member their
// permanent phone QR (src/db/phone-qr.ts).
export async function issueRedeemCode(memberId: string) {
  return issueCode(db(), { kind: "redeem", memberId, ttlMin: REDEEM_TTL_MIN });
}
