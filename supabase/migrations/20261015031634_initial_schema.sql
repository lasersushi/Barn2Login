-- Initial schema. See Design.md §4.
-- Hours are derived by the member_hours view, never stored.

create table members (
  id              uuid primary key default gen_random_uuid(),
  first_name      text not null,
  last_name       text not null,
  grad_year       int  not null,
  subteam         text,
  discord_id      text unique,              -- null until linked
  photo_url       text,                     -- Supabase Storage
  token_hash      text unique,              -- sha256 of long-lived member token
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table meetings (
  id         uuid primary key default gen_random_uuid(),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  kind       text not null default 'build'
             check (kind in ('build', 'outreach', 'competition')),
  note       text
);

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members(id),
  meeting_id    uuid references meetings(id),
  check_in_at   timestamptz not null,
  check_out_at  timestamptz,                -- null = open
  source        text not null
                check (source in ('qr', 'backup', 'admin')),
  closed_by     text
                check (closed_by in ('tap', 'auto', 'admin')),
  ip_status     text
                check (ip_status in ('verified', 'off_network', 'unverifiable')),
  flags         text[] not null default '{}',
  created_by    uuid references members(id),-- set only for admin overrides
  note          text
);

-- A member may have at most one open session at a time.
create unique index one_open_session
  on sessions (member_id) where check_out_at is null;

create table adjustments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id),
  delta_min   int not null,                 -- may be negative
  reason      text not null,
  created_by  uuid not null references members(id),
  created_at  timestamptz not null default now()
);

-- Short-lived, single-use credentials for both sign-in paths.
create table pending_codes (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id),
  kind        text not null
              check (kind in ('qr', 'backup')),
  code_hash   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  ip_status   text                          -- recorded at issue time (qr only)
              check (ip_status in ('verified', 'off_network', 'unverifiable')),
  created_at  timestamptz not null default now()
);
create index on pending_codes (code_hash) where used_at is null;

-- security_invoker makes the view obey the RLS of the tables underneath it.
-- Without it, a view runs as its owner and would bypass RLS entirely.
create view member_hours
with (security_invoker = true) as
select
  m.id as member_id,
  coalesce(sum(
    extract(epoch from (s.check_out_at - s.check_in_at)) / 60
  ) filter (where s.check_out_at is not null), 0)
  + coalesce((select sum(a.delta_min) from adjustments a where a.member_id = m.id), 0)
  as total_minutes
from members m
left join sessions s on s.member_id = m.id
group by m.id;

-- All access goes through server routes using the service role, which
-- bypasses RLS. Enabling RLS with no policies denies anon and authenticated.
alter table members       enable row level security;
alter table meetings      enable row level security;
alter table sessions      enable row level security;
alter table adjustments   enable row level security;
alter table pending_codes enable row level security;

-- Belt and braces: Supabase grants these roles table access by default.
revoke all on all tables in schema public from anon, authenticated;
