import type { Metadata } from "next";
import Link from "next/link";
import { fetchGuildMembers, type GuildMember } from "@/discord/api";
import { listMembers, syncRoster, type Member } from "@/db/members";
import { listOpenSessions } from "@/db/sessions";
import { belongsOnRoster, requireAdmin } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/time";
import {
  logoutAction,
  overrideRecordSessionAction,
  overrideSignInAction,
  signOutAllAction,
  signOutMemberAction,
} from "./actions";

export const metadata: Metadata = { title: "Roster" };

const ERRORS: Record<string, string> = {
  "mentor-not-on-roster": "You're not on the roster yet. Reload this page to sync it with Discord, then try again.",
  inactive: "They're inactive because they don't have the member role in Discord.",
  already_signed_in: "They're already signed in.",
  "invalid-session": "Pick a member, a date, a start time, and an end time.",
  end_before_start: "The session has to end after it starts.",
  in_future: "That session hasn't ended yet. Use Sign in instead.",
  overlap: "That overlaps a session they already have, which would count the time twice.",
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { error } = await searchParams;

  // The roster follows Discord roles, re-synced on every visit. If Discord
  // can't be reached, the roster is shown as of the last successful sync.
  let guild: GuildMember[] = [];
  let syncError: string | null = null;
  try {
    guild = await fetchGuildMembers();
    await syncRoster(
      guild.filter((g) => belongsOnRoster(g.roles)).map((g) => ({ discordId: g.id, displayName: g.displayName })),
    );
  } catch (e) {
    syncError = e instanceof Error ? e.message : String(e);
  }

  const [members, open] = await Promise.all([listMembers(), listOpenSessions()]);
  const guildById = new Map(guild.map((g) => [g.id, g]));
  const signedIn = new Set(open.map((s) => s.member_id));
  const active = members.filter((m) => m.active);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Roster</h1>
        <div className="flex items-center gap-4">
          <Link href="/admin/hours" className="text-sm underline">
            Hours
          </Link>
          <Link href="/admin/badges" className="text-sm underline">
            Badges
          </Link>
          <form action={logoutAction}>
            <button className="text-sm text-zinc-500 underline">Log out</button>
          </form>
        </div>
      </header>

      {error && ERRORS[error] && <p className="rounded-md bg-red-100 p-3 text-red-800">{ERRORS[error]}</p>}
      {syncError && (
        <p className="rounded-md bg-amber-100 p-3 text-amber-900">
          Couldn&apos;t sync the roster with Discord ({syncError}). This is the roster as of the last sync. Check
          that &quot;Server Members Intent&quot; is on in the Developer Portal&apos;s Bot tab.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Signed in now ({open.length})</h2>
          {open.length > 0 && (
            <form action={signOutAllAction}>
              <button className="rounded-md bg-black px-3 py-1 text-white">Sign out everyone</button>
            </form>
          )}
        </div>
        {open.length === 0 && <p className="text-zinc-500">Nobody is signed in.</p>}
        {open.map((s) => (
          <form key={s.member_id} action={signOutMemberAction} className="flex items-center gap-3">
            <input type="hidden" name="memberId" value={s.member_id} />
            <span className="w-48 font-medium">
              {s.first_name} {s.last_name}
            </span>
            <span className="text-sm text-zinc-500">
              since {formatDate(s.check_in_at)}, {formatTime(s.check_in_at)}
            </span>
            <button className="text-xs underline">Sign out</button>
          </form>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">All members ({members.length})</h2>
        <p className="text-sm text-zinc-500">
          Everyone with the member role in Discord, using their server nickname. To add someone, give them the role;
          to remove them, take it away. Their hours stay either way.
        </p>
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-2">Name</th>
              <th>Discord</th>
              <th>Status</th>
              <th>Sign-in</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className={`border-t border-zinc-200 ${m.active ? "" : "text-zinc-400"}`}>
                <td className="py-2">{fullName(m)}</td>
                <td>{m.discord_id ? discordLabel(m.discord_id, guildById) : "—"}</td>
                <td>{m.active ? "Active" : "Inactive (no member role)"}</td>
                <td>
                  {signedIn.has(m.id) ? (
                    <span className="text-xs text-emerald-700">Signed in</span>
                  ) : m.active ? (
                    // Override for a dead phone. Signs out the normal way.
                    <form action={overrideSignInAction}>
                      <input type="hidden" name="memberId" value={m.id} />
                      <button className="text-xs underline">Sign in now</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Record a past session</h2>
        <p className="text-sm text-zinc-500">
          For when someone was there but couldn&apos;t scan (kiosk or Wi-Fi down). Times are Pacific. It&apos;s
          recorded under your name and flagged for review.
        </p>
        <form action={overrideRecordSessionAction} className="flex flex-wrap items-center gap-3">
          <select name="memberId" required defaultValue="" className="rounded-md border border-zinc-300 px-2 py-1">
            <option value="" disabled>
              Member…
            </option>
            {active.map((m) => (
              <option key={m.id} value={m.id}>
                {fullName(m)}
              </option>
            ))}
          </select>
          <input name="date" type="date" required className="rounded-md border border-zinc-300 px-2 py-1" />
          <input name="start" type="time" required className="rounded-md border border-zinc-300 px-2 py-1" />
          <span>to</span>
          <input name="end" type="time" required className="rounded-md border border-zinc-300 px-2 py-1" />
          <input name="note" placeholder="Why (optional)" className="rounded-md border border-zinc-300 px-2 py-1" />
          <button className="rounded-md bg-black px-3 py-1 text-white">Record</button>
        </form>
      </section>
    </main>
  );
}

function fullName(m: Member): string {
  return `${m.first_name} ${m.last_name}`.trim();
}

function discordLabel(discordId: string, guildById: Map<string, GuildMember>): string {
  // Empty when Discord couldn't be reached, which says nothing about this person.
  if (guildById.size === 0) return "—";
  const g = guildById.get(discordId);
  return g ? `@${g.username}` : "(not in server)";
}
