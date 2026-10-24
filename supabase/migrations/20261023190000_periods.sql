-- Named date ranges ("Build season 2027") that mentors total hours over.
-- A period stores no hours: totals are derived from sessions and adjustments
-- each time (CLAUDE.md invariant #1). Deleting a period loses nothing.
--
-- Dates are Pacific calendar days, inclusive on both ends. A session counts
-- toward a period if it started inside it; an adjustment, if it was entered
-- inside it.
create table periods (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  starts_on   date not null,
  ends_on     date not null,
  created_by  uuid not null references members(id),
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);

alter table periods enable row level security;
revoke all on periods from anon, authenticated;
