# Barn2 Sign-In — Design Spec

Attendance and hours tracking for FRC Team 751 (Barn 2).

**Status:** design complete, not yet built
**Author:** Lucas Walker
**Target:** operational before the 2027 season kickoff (January)

---

## 1. Problem

The current sign-in system is a spreadsheet. It is slow to use, and — the real
problem — Mr. J has to open it several times a week during season to correct
hours by hand. Editing cells is destructive: there is no record of what a
number was before, no way to answer "why does this person have 43 hours," and
no way to recompute if a mistake is found later.

Hours matter. They feed a graduation requirement. Losing them or getting them
wrong is a real cost.

## 2. Goals

- Signing in and out takes under ten seconds and requires no mentor involvement
- Corrections are additive and auditable, never destructive
- Hours are recomputable from source records at any time
- Mentors get a nightly summary instead of having to go looking
- Zero recurring cost

**Non-goals:**

- Preventing a determined, coordinated cheater. See §7.
- Scouting, parts inventory, or anything else. This system tracks attendance.
- Working without Discord. Discord membership is a hard prerequisite.

## 3. Architecture

Everything is one Next.js app on Vercel. There is no separate bot process.

```
Vercel (Next.js, TypeScript)
├── /kiosk                    iPad page: camera QR scan + backup code display
│                             (one-time setup with KIOSK_SECRET sets a kiosk cookie)
├── /admin                    mentor UI: roster, review queue, overrides
│                             (Discord login; needs an ADMIN_ROLE_IDS role)
├── /api/auth/discord/*       mentor OAuth login + callback
├── /api/discord/interactions Discord slash commands (HTTP interactions)
├── /redeem/[token]           page the one-time link opens; its JS POSTs below
├── /api/redeem/[token]       captures member IP, issues QR (POST only, so link
│                             previewers can't burn the one-time link)
├── /api/scan                 kiosk POSTs scanned token, gets verdict + identity
│                             (rejected without the kiosk cookie)
├── /api/backup/claim         redeems a backup code submitted via Discord
└── /api/cron/nightly         heartbeat, backup export, digest
        │
        └── Supabase Postgres (service role key, server-side only)
```

**Why HTTP interactions instead of a gateway bot:** Discord POSTs slash
commands to a URL. Gateway connections are only needed for reading messages,
reactions, presence, or voice — none of which this system does. HTTP
interactions mean no always-on process, no hosting to keep alive over the
summer, and one deploy target.

**Why Supabase:** already in use for Barn2Scout, so one account and one
familiar client. Note the free tier pauses projects after 7 days of
inactivity, which the nightly cron's heartbeat write prevents (§8).

## 4. Data model

The central design decision: **hours are derived, never stored.**

```sql
create table members (
  id              uuid primary key default gen_random_uuid(),
  first_name      text not null,
  last_name       text not null,
  grad_year       int,                      -- null for mentors
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
  kind       text not null default 'build',  -- build | outreach | competition
  note       text
);

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members(id),
  meeting_id    uuid references meetings(id),
  check_in_at   timestamptz not null,
  check_out_at  timestamptz,                -- null = open
  source        text not null,              -- qr | backup | admin
  closed_by     text,                       -- tap | auto | admin
  ip_status     text,                       -- verified | off_network | unverifiable
  flags         text[] not null default '{}',
  created_by    uuid references members(id),-- set only for admin overrides
  note          text
);

create table adjustments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id),
  delta_min   int not null,                 -- may be negative
  reason      text not null,
  created_by  uuid not null references members(id),
  created_at  timestamptz not null default now()
);

-- short-lived, single-use credentials for all paths
create table pending_codes (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid references members(id),  -- null for backup codes until redeemed
  kind        text not null,                -- redeem | qr | backup
  code_hash   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  ip_status   text,                         -- recorded at issue time (qr only)
  ip_address  inet,                         -- raw IP at issue time (qr only), see §6
  created_at  timestamptz not null default now(),
  check (kind = 'backup' or member_id is not null)
);
create index on pending_codes (code_hash) where used_at is null;
```

Derived hours:

```sql
create view member_hours as
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
```

**Consequences of this shape:**

- A correction is an INSERT into `adjustments`, not an edit. History survives.
- A bug in the math is recoverable — fix the view, numbers are correct again.
- "Why does this person have 43 hours" is answerable, row by row, with timestamps.
- Open sessions contribute zero. Hours require both taps.

**Periods.** Mentors total hours over named date ranges ("Preseason 2026",
"Build season 2027") at `/admin/hours`. A period holds no hours, only a name
and a range of Pacific calendar days, both ends included:

```sql
create table periods (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  starts_on   date not null,
  ends_on     date not null,
  created_by  uuid not null references members(id),
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);
```

Totals for a period use the same math as `member_hours`, limited to sessions
that *started* inside it and adjustments *entered* inside it (adjustments have
no "applies to" date). Periods may overlap, and deleting one changes nobody's
hours. "All time" on that page is the `member_hours` total.

**Invariant:** a member may have at most one open session at a time. Enforce
with a partial unique index:

```sql
create unique index one_open_session
  on sessions (member_id) where check_out_at is null;
```

## 5. Sign-in flows

Three paths. Each proves something different.

### 5a. Primary — QR

1. Member runs `/sign-in` in Discord.
2. Bot replies **ephemerally** with a one-time link.
3. Member taps the link. `/api/redeem/[token]` sees their real IP.
4. Server classifies the IP (§6) and issues a QR image containing a fresh
   token. **TTL: 10 minutes. Single use.**
5. Member walks to the iPad and scans.
6. Kiosk POSTs the token to `/api/scan`. Server validates, determines whether
   this is a check-in or check-out from the member's open-session state,
   writes the row, returns the member's name and photo.
7. Kiosk displays name + photo full-size, and on check-out, session duration.

**Why the redirect step is mandatory:** Discord's servers POST the slash
command to us, so `/api/discord/interactions` sees *Discord's* IP, not the
member's. The tapped link is the only point where we observe the member's
actual network. A one-step slash command would look like it works and measure
nothing.

**Why the QR path needs no location check at redemption:** the member is
physically standing at the iPad. That is stronger evidence than any IP or GPS
reading. The location check happens at *issue* time, which is what prevents a
member at home from getting a code to forward to a friend.

### 5b. Backup — code displayed on iPad

For when the camera won't read a screen: glare, cracked display, dead phone
camera, code not saved.

1. Member taps "Backup sign-in" on the iPad.
2. Kiosk requests a code from the server, displays it large with a visible
   countdown, and clears it when it expires. **TTL: 5 minutes. Single use.**
3. Member sends the code to the bot (`/code <value>`).
4. Server matches the code, resolves the member from their Discord ID, writes
   the session.

**Code format:** 6 characters, letters only, no repeated characters.
Compared **case-insensitively**.

The originally specified space was P(52,6) = 14,658,134,400 (~33.8 bits),
i.e. mixed-case. Do not implement it that way. iOS auto-capitalizes the first
character of a message, so a lowercase-initial code is silently corrupted at
typing time, and `l`/`I` are indistinguishable in most sans-serif fonts.
Case-insensitive comparison gives P(26,6) = 165,765,600 (~27.3 bits), which is
ample given the rate limit below. Display in uppercase. Exclude `I` and `O`
if a fixed-width font isn't available on the kiosk.

**Rate limit is what actually secures this, not the entropy.** Cap redemption
at 5 attempts per minute per Discord user and 20 per minute globally. With ~40
codes outstanding and a 5-minute window, that puts a blind guesser at roughly
6 in a million. Without a limiter, the entropy alone is not enough.

Do not display a standing code. A code that sits on screen all meeting gets
photographed once and reused forever.

### 5c. Override — mentor only

An `/admin` action that creates a session with `source='admin'` and records
which mentor did it. This is the only path that works with a dead phone, no
Discord account, or a network outage. It is not optional — build it in v0.

Two forms, both inserts only, both with `created_by` set to the mentor's own
`members` row (leadership roles are synced onto the roster, §11) and an
`admin_override` flag (§9):

- **Sign in now** — opens a session at the current time. The member signs
  out the normal way (scan, `/admin`, or `/sign-out-all`).
- **Record a past session** — a closed session from a Pacific date, start
  and end, for when nobody could scan. Rejected if it ends in the future or
  overlaps an existing session for that member (an open session counts as
  running until now), since either would count time twice.

## 6. IP classification

The school's egress IP(s) define "on campus."

**Do not hardcode an allowlist on day one.** Log `x-forwarded-for` on every
redeem for the first two weeks with enforcement off, then build the allowlist
from observed data. Schools often NAT through several addresses and rotate.

Three outcomes, never two:

| Status | Meaning | Action |
|---|---|---|
| `verified` | IP matches the school allowlist | Issue code normally |
| `off_network` | IP is a known-good public address elsewhere | Do not issue; tell the member why |
| `unverifiable` | IP is in Apple's iCloud Private Relay egress ranges | Issue code, tag session `unverifiable` |

Private Relay covers all Safari connections including `SFSafariViewController`,
which is how Discord opens links on iOS. Members with iCloud+ will hit this
without knowing what it is. Treating them as off-network would wrongly lock out
a chunk of the team; treating them as verified would ship a bypass that people
get *by default* from their couch. Tag and move on — the mentor digest stays
honest and nobody is stuck.

Fetch Apple's published relay egress ranges (the `mask.icloud.com` IP list) on
a schedule and cache it.

## 7. Threat model

Explicitly bounded. This is a high school team.

| Attack | Defeated by | Residual |
|---|---|---|
| Sign in from home | IP check at code issue | None meaningful |
| Sign in from elsewhere on campus | Backup code originates on the kiosk screen; QR requires walking to the iPad | None for QR path |
| Friend signs in for absent member | Absent member's IP fails, so no code is issued | None |
| Accomplice on campus relays a code | 10min/5min TTL, single use, photo shown at kiosk | Requires active collusion; lands flagged |
| Sign in and leave immediately | Hours require a closed session; both taps needed | Mentor review |
| Brute-forcing backup codes | Rate limit + single use + short TTL | Negligible |

**What is deliberately not defended against:** a member who understands Private
Relay and uses it to bypass the location check. Detectable in the digest as an
unusual `unverifiable` rate. Not worth engineering against.

**The real defense is the nightly digest.** Mentors were in the room. A human
who was present outperforms any automated check, and every mechanism above
exists to give that human a short, sorted list rather than forty rows to audit.

## 8. Scheduled work

One nightly cron on Vercel. Hobby caps cron at once per day and any expression
that fires more often fails at deploy time. Timing is guaranteed only within
the hour and is UTC-only, so schedule `0 10 * * *` — roughly 2–3am Pacific
either side of DST, safely outside any meeting.

The job does three things:

1. **Heartbeat** — a trivial query, which keeps the Supabase free project from
   pausing after 7 days of inactivity. Matters over the summer.
2. **Backup export** — dump `members` (minus `token_hash`), `sessions`,
   `adjustments` and `periods` to CSV in a private `backups` Storage bucket, one folder per
   day. The free tier has no automated backups and these hours are a
   graduation requirement.
3. **Digest** — post to a mentor-only Discord channel: full attendance for the
   meeting, the flagged-session list, and the backup-to-QR ratio.

**Closing forgotten sessions is manual, by decision.** Leadership signs
everyone out at the end of the day with `/sign-out-all` in Discord (limited
to members with one of the `ADMIN_ROLE_IDS` roles), or with the buttons under "Signed in now" on
`/admin`. These close at the current time with `closed_by='admin'` and no
flag — the same as each member tapping out. There is no automatic close: if
leadership forgets, an open session stays open and the member's next scan
closes it, so the "longer than 8 hours" flag (§9) is what catches it.

## 9. Flags and review

Auto-flag a session when it is `source='backup'` or `source='admin'`,
`ip_status != 'verified'`, longer than 8 hours, or created
within 60 seconds of another backup redemption. `/admin` sorts by flag count.

Target: a mentor reviews a handful of sessions a week, not the whole roster.

**Watch the backup-to-QR ratio.** Above roughly 10% it is not an abuse signal —
it means the kiosk is failing. Bad glare, awkward placement, dead iPad, codes
people can't find. People route around broken tools, and this number reports
it before anyone complains.

## 10. Kiosk operation

- iPad in Safari, page pinned. Settings → Display → Auto-Lock → Never.
- Guided Access on. Keep it plugged in.
- `getUserMedia` requires a user gesture, so the page needs a "Start" button
  after load. The camera dies when the tab backgrounds — handle
  `visibilitychange` and re-arm.
- Safari does not implement `BarcodeDetector`. Use `qr-scanner`, which falls
  back to a WASM decoder on WebKit.
- Expect scanning phone screens to be the main friction: glare and
  auto-dimming. Tell members to save the QR to Photos and raise brightness.

## 11. Onboarding

The Discord server is the roster. Nobody is added by hand: a new member joins
the server, leadership gives them the member role (`MEMBER_ROLE_ID`), and they
can sign in. This replaced an earlier design where mentors added people and
linked Discord accounts by hand, which kept two lists that drifted apart.

- The roster is everyone with the member role, plus anyone with an
  `ADMIN_ROLE_IDS` role (so overrides can record which mentor acted).
- **Sync** runs every time `/admin` loads: it adds or reactivates everyone who
  should be on the roster and deactivates everyone else (lost the role, left
  the server). Deactivating is a soft delete; hours stay. A sync that finds
  nobody with the role is refused instead of deactivating the whole team.
- **`/sign-in`** checks the role from the interaction payload and creates or
  reactivates the caller's row on the spot, so a new member can sign in
  before anyone opens `/admin`.
- **Names** come from the server nickname (else Discord display name, else
  username), refreshed on every sync, split at the first space into
  `first_name` / `last_name`. Members should set their server nickname to
  their real name; it is what appears on the hours page.
- `grad_year` and `subteam` are no longer filled in; the columns remain.

`pnpm roster:reset` wiped the hand-built test roster before launch (and with
it the test sessions). It is the only code that deletes from `sessions`.

## 12. Build order

Ship each step before starting the next.

1. Schema + migrations + generated types + `member_hours` view
2. `/api/discord/interactions` with signature verification and a `/ping`
   command — get this green before writing any real command
3. Admin roster page + Discord ID linking
4. `/sign-in` → redeem link → QR issue (no IP check yet, log IPs only)
5. Kiosk page: scan → `/api/scan` → name + photo display
6. Backup code path
7. Nightly cron: heartbeat + export (closing sessions is manual, see §8)
8. Digest and flags
9. Mentor override
10. **IP enforcement last**, once two weeks of logged addresses show what the
    school's egress actually looks like

Steps 1–5 are the working system. Everything after is hardening.

## 13. Open questions

- Confirm the school's egress IP set from real data before step 10.
- Photo storage: photos of minors. Agree a retention policy with mentors
  before collecting any, and tell members the system exists. Recommend
  roster photos only — do not capture a frame at sign-in time.
- Meeting schedule source: hand-entered by a mentor, or generated from a
  recurring rule? Hand-entered is fine for v0.
- What happens to sessions when a member is deactivated mid-season? Proposal:
  soft-delete only, never cascade.