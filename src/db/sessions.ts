import "server-only";
import { db } from "@/db/client";
import { consumeCode } from "@/db/codes";

// A check-in matches the meeting it falls in. Members who arrive up to an
// hour early still count toward that meeting. Not in the spec; adjust here.
const EARLY_ARRIVAL = "1 hour";

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
  | { ok: false; reason: "invalid" | "inactive" };

// The kiosk scanned a QR. Whether this is a check-in or a check-out depends
// only on whether the member has an open session (Design.md §5a step 6).
// One transaction: the code is consumed only if the session write succeeds.
export async function scanQr(token: string): Promise<ScanResult> {
  return db().begin(async (tx) => {
    const code = await consumeCode(tx, "qr", token);
    if (!code?.member_id) return { ok: false, reason: "invalid" } as const;

    // Locking the member row serializes two scans for the same person, so
    // they can't both see "no open session" and both check in.
    const [member] = await tx<(ScannedMember & { active: boolean })[]>`
      select first_name, last_name, photo_url, active
      from members where id = ${code.member_id}
      for update
    `;
    if (!member.active) return { ok: false, reason: "inactive" } as const;
    const scanned = {
      first_name: member.first_name,
      last_name: member.last_name,
      photo_url: member.photo_url,
    };

    // The only UPDATE sessions ever gets from a tap (CLAUDE.md invariant #2).
    const [closed] = await tx<{ check_in_at: Date; check_out_at: Date }[]>`
      update sessions
      set check_out_at = now(), closed_by = 'tap'
      where member_id = ${code.member_id} and check_out_at is null
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
      insert into sessions (member_id, meeting_id, check_in_at, source, ip_status)
      values (
        ${code.member_id},
        (
          select id from meetings
          where now() >= starts_at - ${EARLY_ARRIVAL}::interval and now() < ends_at
          order by starts_at
          limit 1
        ),
        now(),
        'qr',
        ${code.ip_status}
      )
      returning check_in_at
    `;
    return { ok: true, action: "check_in", member: scanned, checkInAt: opened.check_in_at } as const;
  });
}
