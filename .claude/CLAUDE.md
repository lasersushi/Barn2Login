# CLAUDE.md — Barn2 Sign-In

Attendance and hours tracking for FRC Team 751 (Barn 2).
Read `DESIGN.md` for the full spec. This file is the short list of things
that must not be violated.

## Stack

- Next.js (App Router) on Vercel, TypeScript, strict mode
- Supabase Postgres, accessed **only** from server routes using the service role key
- Discord bot via **HTTP interactions** (no gateway, no always-on process)
- iPad kiosk is a plain web page in Safari; QR decoding via `qr-scanner`

## Hard invariants

**1. Hours are never stored as a number.**
There is no `members.total_hours` column and there never will be. Hours are
derived from `sessions` and `adjustments` by a SQL view. If you find yourself
writing `UPDATE ... SET hours = hours + x`, stop — that is the bug this whole
system exists to fix.

**2. `sessions` is append-only in spirit.**
The only permitted UPDATE is setting `check_out_at`, `closed_by`, and `flags`
on an open session. Corrections are new rows in `adjustments`. Never DELETE
from `sessions`.

**3. All timestamps are `timestamptz`, stored UTC, rendered `America/Los_Angeles`.**
Never store naive local time. Never do timezone math in the client.

**4. The anon key is never used and never shipped to the browser.**
RLS denies everything to `anon` and `authenticated`. All database access goes
through server routes holding the service role key. The kiosk page talks to
our API, never to Supabase directly.

**5. Tokens are stored hashed.**
`sha256` of the token, never the token itself. This applies to member tokens,
QR tokens, and backup codes.

**6. Nothing is ever blocked on a location signal.**
There is no IP check (Design.md §6 was dropped). The defense against someone
scanning for an absent member is the kiosk saying the name out loud, plus
the nightly digest. A valid, unreplaced QR or badge always scans.

**7. Never invent a schema change to make a feature easier.**
If the spec seems to require a new column, say so and ask.

## Conventions

- Package manager: pnpm
- Node version pinned in `.nvmrc` and `package.json` engines — check
  `discord.js` docs for the current minimum before assuming
- Migrations live in `supabase/migrations/`, applied via Supabase CLI
- Types generated with `supabase gen types typescript` into `src/types/db.ts`,
  regenerated after every migration, committed
- No ORM. Plain SQL via `postgres` (porsager). Queries live in `src/db/`
- Cron routes are guarded by a `CRON_SECRET` bearer token; reject without it

## Testing notes

- Register Discord commands **guild-scoped** during development. Global
  commands take up to an hour to propagate; guild commands are instant.
- Discord signature verification needs the **raw** request body. In App Router
  use `await req.text()` before any parsing. Getting this wrong is the single
  most common failure.
- Discord sends deliberately invalid signatures to test the endpoint. Never
  stub verification out, even temporarily.

## When in doubt

Prefer the boring option. This is a high school robotics team, not a
security product. A flagged row a mentor reviews beats a clever automated
defense that fails silently.