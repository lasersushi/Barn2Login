import "server-only";
import { db } from "@/db/client";

export type Period = {
  id: string;
  name: string;
  starts_on: string; // YYYY-MM-DD, Pacific
  ends_on: string;
};

export type MemberHours = {
  id: string;
  first_name: string;
  last_name: string;
  grad_year: number | null;
  active: boolean;
  minutes: number;
  sessions: number;
};

// Dates come back as text: postgres.js would turn a date into a UTC-midnight
// Date, which displays as the previous day in Pacific time.
export async function listPeriods(): Promise<Period[]> {
  return db()<Period[]>`
    select id, name, starts_on::text, ends_on::text
    from periods
    order by starts_on desc, name
  `;
}

export async function createPeriod(input: {
  name: string;
  startsOn: string;
  endsOn: string;
  createdBy: string;
}): Promise<string> {
  const [row] = await db()<{ id: string }[]>`
    insert into periods (name, starts_on, ends_on, created_by)
    values (${input.name}, ${input.startsOn}, ${input.endsOn}, ${input.createdBy})
    returning id
  `;
  return row.id;
}

// Periods hold no hours, so deleting one loses nothing.
export async function deletePeriod(id: string): Promise<void> {
  await db()`delete from periods where id = ${id}`;
}

// Same math as the member_hours view (closed sessions plus adjustments),
// limited to a range of Pacific calendar days, or all time when range is null.
// A session counts where it started; an adjustment, where it was entered.
export async function hoursByMember(range: { startsOn: string; endsOn: string } | null): Promise<MemberHours[]> {
  return db()<MemberHours[]>`
    with bounds as (
      select
        coalesce(${range?.startsOn ?? null}::date::timestamp at time zone 'America/Los_Angeles', '-infinity') as lo,
        coalesce((${range?.endsOn ?? null}::date + 1)::timestamp at time zone 'America/Los_Angeles', 'infinity') as hi
    )
    select
      m.id, m.first_name, m.last_name, m.grad_year, m.active,
      round(coalesce(s.minutes, 0) + coalesce(a.minutes, 0))::int as minutes,
      s.count::int as sessions
    from members m
    cross join bounds b
    left join lateral (
      select sum(extract(epoch from (check_out_at - check_in_at)) / 60) as minutes, count(*) as count
      from sessions
      where member_id = m.id
        and check_out_at is not null
        and check_in_at >= b.lo and check_in_at < b.hi
    ) s on true
    left join lateral (
      select sum(delta_min) as minutes
      from adjustments
      where member_id = m.id
        and created_at >= b.lo and created_at < b.hi
    ) a on true
    order by m.active desc, minutes desc, m.last_name, m.first_name
  `;
}
