import "server-only";
import type postgres from "postgres";
import { db } from "@/db/client";
import { consumeCode } from "@/db/codes";
import { sha256Hex } from "@/lib/crypto";

// A check-in matches the meeting it falls in. Members who arrive up to an
// hour early still count toward that meeting. Not in the spec; adjust here.
const EARLY_ARRIVAL = "1 hour";

const BADGE_FLAG = "badge";
// Not in the spec. Long enough to step away from the camera, short enough
// that nobody signs in and wants to leave within it.
const BADGE_REPEAT_IGNORE = "1 minute";

export type ScannedMember = {
  first_name: string;
  last_name: string;
  photo_url: string | null;
};

export type ScanResult =
  | { ok: true; action: "check_in"; member: ScannedMember; checkInAt: Date }
  | {
      ok: true;
      action: "check_out";
      member: ScannedMember;
      checkInAt: Date;
      checkOutAt: Date;
    }
  | { ok: false; reason: "invalid" | "invalid_badge" | "inactive" | "repeat" };

// The kiosk scanned a QR. Whether this is a check-in or a check-out depends
// only on whether the member has an open session (Design.md §5a step 6).
// One transaction: the code is consumed only if the session write succeeds.
export async function scanQr(token: string): Promise<ScanResult> {
  return db().begin(async (tx) => {
    const code = await consumeCode(tx, "qr", token);
    if (!code?.member_id) return { ok: false, reason: "invalid" } as const;
    return toggleSession(tx, code.member_id, { ipStatus: code.ip_status, flags: [] });
  });
}

// The kiosk scanned a printed badge (Design.md §5d). Unlike a one-time QR,
// the same badge keeps working, so a badge held in front of the camera
// would sign in and straight back out. Ignore it for a minute after the
// member's last scan. Every badge check-in is flagged for review: nothing
// shows the person holding the card is its owner.
export async function scanBadge(token: string): Promise<ScanResult> {
  return db().begin(async (tx) => {
    const [member] = await tx<{ id: string }[]>`
      select id from members where token_hash = ${sha256Hex(token)}
    `;
    if (!member) return { ok: false, reason: "invalid_badge" } as const;
    return toggleSession(tx, member.id, { ipStatus: null, flags: [BADGE_FLAG], ignoreRepeat: true });
  });
}

async function toggleSession(
  tx: postgres.TransactionSql,
  memberId: string,
  opts: { ipStatus: string | null; flags: string[]; ignoreRepeat?: boolean },
): Promise<ScanResult> {
  // Locking the member row serializes two scans for the same person, so
  // they can't both see "no open session" and both check in.
  const [member] = await tx<(ScannedMember & { active: boolean })[]>`
    select first_name, last_name, photo_url, active
    from members where id = ${memberId}
    for update
  `;
  if (!member.active) return { ok: false, reason: "inactive" } as const;
  const scanned = {
    first_name: member.first_name,
    last_name: member.last_name,
    photo_url: member.photo_url,
  };

  if (opts.ignoreRepeat) {
    const [recent] = await tx`
      select 1 from sessions
      where member_id = ${memberId}
        and greatest(check_in_at, check_out_at) > now() - ${BADGE_REPEAT_IGNORE}::interval
    `;
    if (recent) return { ok: false, reason: "repeat" } as const;
  }

  // The only UPDATE sessions ever gets from a tap (CLAUDE.md invariant #2).
  const [closed] = await tx<{ check_in_at: Date; check_out_at: Date }[]>`
    update sessions
    set check_out_at = now(), closed_by = 'tap'
    where member_id = ${memberId} and check_out_at is null
    returning check_in_at, check_out_at
  `;
  if (closed) {
    return {
      ok: true,
      action: "check_out",
      member: scanned,
      checkInAt: closed.check_in_at,
      checkOutAt: closed.check_out_at,
    } as const;
  }

  const [opened] = await tx<{ check_in_at: Date }[]>`
    insert into sessions (member_id, meeting_id, check_in_at, source, ip_status, flags)
    values (
      ${memberId},
      (
        select id from meetings
        where now() >= starts_at - ${EARLY_ARRIVAL}::interval and now() < ends_at
        order by starts_at
        limit 1
      ),
      now(),
      'qr',
      ${opts.ipStatus},
      ${opts.flags}
    )
    returning check_in_at
  `;
  return { ok: true, action: "check_in", member: scanned, checkInAt: opened.check_in_at } as const;
}

// ---------------------------------------------------------------------------
// Closing sessions without a tap. These, and the tap above, are the only
// UPDATEs sessions ever gets: check_out_at and closed_by, and only on open
// sessions (CLAUDE.md invariant #2).
// ---------------------------------------------------------------------------

export type OpenSession = {
  member_id: string;
  first_name: string;
  last_name: string;
  check_in_at: Date;
};

export async function listOpenSessions(): Promise<OpenSession[]> {
  return db()<OpenSession[]>`
    select s.member_id, m.first_name, m.last_name, s.check_in_at
    from sessions s
    join members m on m.id = s.member_id
    where s.check_out_at is null
    order by m.last_name, m.first_name
  `;
}

// Leadership's end-of-day sign-out (/sign-out-all in Discord, or the button
// on /admin), and the per-person version. Credits time up to now, the same
// as if each member had tapped out themselves. Returns who was signed out.
export async function signOutAll(): Promise<{ first_name: string; last_name: string }[]> {
  return db()<{ first_name: string; last_name: string }[]>`
    with closed as (
      update sessions
      set check_out_at = now(), closed_by = 'admin'
      where check_out_at is null
      returning member_id
    )
    select m.first_name, m.last_name
    from closed c
    join members m on m.id = c.member_id
    order by m.last_name, m.first_name
  `;
}

export async function signOutMember(memberId: string): Promise<void> {
  await db()`
    update sessions
    set check_out_at = now(), closed_by = 'admin'
    where member_id = ${memberId} and check_out_at is null
  `;
}
