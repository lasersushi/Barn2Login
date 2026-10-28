import "server-only";
import { db } from "@/db/client";

// Corrections to hours are new rows here, never edits to sessions (CLAUDE.md
// invariants #1 and #2). Each records the mentor and a reason, so any
// member's total can be explained row by row.

export type Adjustment = {
  id: string;
  member_name: string;
  delta_min: number;
  reason: string;
  mentor_name: string;
  created_at: Date;
};

export type RemoveHoursResult = { ok: true } | { ok: false; reason: "not_found" | "more_than_total" };

export async function removeHours(input: {
  memberId: string;
  minutes: number;
  reason: string;
  mentorId: string;
}): Promise<RemoveHoursResult> {
  return db().begin(async (tx) => {
    // Locking the member row serializes two mentors removing at once, so
    // they can't both pass the check below and take the total negative.
    const [member] = await tx<{ id: string }[]>`
      select id from members where id = ${input.memberId} for update
    `;
    if (!member) return { ok: false, reason: "not_found" } as const;

    const [hours] = await tx<{ total_minutes: number }[]>`
      select total_minutes from member_hours where member_id = ${input.memberId}
    `;
    if (input.minutes > Number(hours.total_minutes)) return { ok: false, reason: "more_than_total" } as const;

    await tx`
      insert into adjustments (member_id, delta_min, reason, created_by)
      values (${input.memberId}, ${-input.minutes}, ${input.reason}, ${input.mentorId})
    `;
    return { ok: true } as const;
  });
}

export async function listAdjustments(limit = 50): Promise<Adjustment[]> {
  return db()<Adjustment[]>`
    select
      a.id,
      trim(m.first_name || ' ' || m.last_name) as member_name,
      a.delta_min,
      a.reason,
      trim(c.first_name || ' ' || c.last_name) as mentor_name,
      a.created_at
    from adjustments a
    join members m on m.id = a.member_id
    join members c on c.id = a.created_by
    order by a.created_at desc
    limit ${limit}
  `;
}
