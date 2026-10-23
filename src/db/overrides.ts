import "server-only";
import { db } from "@/db/client";

// Mentor override (Design.md §5c): the only path that works with a dead phone,
// no Discord account, or the kiosk/network down. Sessions are only ever
// inserted here, never edited. Each one records the mentor in created_by and
// carries an admin_override flag so it shows up for review (§9).

const OVERRIDE_FLAG = "admin_override";

export type OverrideResult = { ok: true } | { ok: false; reason: OverrideError };
export type OverrideError =
  | "inactive"
  | "already_signed_in"
  | "end_before_start"
  | "in_future"
  | "overlap";

// "Sign in now" for someone who can't scan. They sign out the normal way.
export async function overrideSignIn(input: {
  memberId: string;
  mentorId: string;
  note: string | null;
}): Promise<OverrideResult> {
  return db().begin(async (tx) => {
    // Locking the member row serializes this against a simultaneous scan.
    const [member] = await tx<{ active: boolean }[]>`
      select active from members where id = ${input.memberId} for update
    `;
    if (!member?.active) return { ok: false, reason: "inactive" } as const;

    const [open] = await tx`
      select 1 from sessions where member_id = ${input.memberId} and check_out_at is null
    `;
    if (open) return { ok: false, reason: "already_signed_in" } as const;

    await tx`
      insert into sessions (member_id, check_in_at, source, created_by, flags, note)
      values (${input.memberId}, now(), 'admin', ${input.mentorId}, ${[OVERRIDE_FLAG]}, ${input.note})
    `;
    return { ok: true } as const;
  });
}

// "Record a past session" for when nobody could scan. The mentor types a
// Pacific date and times; Postgres converts them to UTC (CLAUDE.md invariant #3).
export async function overrideRecordSession(input: {
  memberId: string;
  mentorId: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
  note: string | null;
}): Promise<OverrideResult> {
  return db().begin(async (tx) => {
    const [member] = await tx<{ active: boolean }[]>`
      select active from members where id = ${input.memberId} for update
    `;
    if (!member?.active) return { ok: false, reason: "inactive" } as const;

    const [times] = await tx<{ check_in_at: Date; check_out_at: Date; in_future: boolean }[]>`
      select
        check_in_at,
        check_out_at,
        check_out_at > now() as in_future
      from (
        select
          (${input.date}::date + ${input.start}::time) at time zone 'America/Los_Angeles' as check_in_at,
          (${input.date}::date + ${input.end}::time) at time zone 'America/Los_Angeles' as check_out_at
      ) t
    `;
    if (times.check_out_at <= times.check_in_at) return { ok: false, reason: "end_before_start" } as const;
    if (times.in_future) return { ok: false, reason: "in_future" } as const;

    // Overlapping an existing session would count the same time twice.
    // An open session counts as running until now.
    const [overlap] = await tx`
      select 1 from sessions
      where member_id = ${input.memberId}
        and check_in_at < ${times.check_out_at}
        and coalesce(check_out_at, now()) > ${times.check_in_at}
    `;
    if (overlap) return { ok: false, reason: "overlap" } as const;

    await tx`
      insert into sessions (member_id, check_in_at, check_out_at, source, closed_by, created_by, flags, note)
      values (
        ${input.memberId}, ${times.check_in_at}, ${times.check_out_at},
        'admin', 'admin', ${input.mentorId}, ${[OVERRIDE_FLAG]}, ${input.note}
      )
    `;
    return { ok: true } as const;
  });
}
