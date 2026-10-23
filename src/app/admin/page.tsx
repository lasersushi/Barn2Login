import type { Metadata } from "next";
import { fetchGuildMembers, type GuildMember } from "@/discord/api";
import { listMembers, type Member } from "@/db/members";
import { listOpenSessions } from "@/db/sessions";
import { requireAdmin } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/time";
import {
  addMemberAction,
  linkDiscordAction,
  logoutAction,
  setActiveAction,
  signOutAllAction,
  signOutMemberAction,
  unlinkDiscordAction,
} from "./actions";

export const metadata: Metadata = { title: "Roster" };

const ERRORS: Record<string, string> = {
  "invalid-member": "First and last name are required, and grad year must be a number.",
  "pick-account": "Pick a Discord account to link.",
  "already-linked": "That Discord account is already linked to someone else.",
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { error } = await searchParams;

  const [members, open] = await Promise.all([listMembers(), listOpenSessions()]);
  let guild: GuildMember[] = [];
  let guildError: string | null = null;
  try {
    guild = await fetchGuildMembers();
  } catch (e) {
    guildError = e instanceof Error ? e.message : String(e);
  }

  const guildById = new Map(guild.map((g) => [g.id, g]));
  const linkedIds = new Set(members.map((m) => m.discord_id).filter(Boolean));
  const linkable = guild.filter((g) => !linkedIds.has(g.id));
  const unlinked = members.filter((m) => !m.discord_id && m.active);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Roster</h1>
        <form action={logoutAction}>
          <button className="text-sm text-zinc-500 underline">Log out</button>
        </form>
      </header>

      {error && ERRORS[error] && <p className="rounded-md bg-red-100 p-3 text-red-800">{ERRORS[error]}</p>}
      {guildError && (
        <p className="rounded-md bg-amber-100 p-3 text-amber-900">
          Couldn&apos;t load Discord server members ({guildError}). Linking is unavailable. Check that
          &quot;Server Members Intent&quot; is on in the Developer Portal&apos;s Bot tab.
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
        <h2 className="text-xl font-semibold">Needs a Discord link ({unlinked.length})</h2>
        <p className="text-sm text-zinc-500">These members can&apos;t sign in until they&apos;re linked.</p>
        {unlinked.length === 0 && <p className="text-zinc-500">Everyone active is linked.</p>}
        {unlinked.map((m) => (
          <form key={m.id} action={linkDiscordAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="memberId" value={m.id} />
            <span className="w-48 font-medium">{fullName(m)}</span>
            <select name="discordId" defaultValue="" className="rounded-md border border-zinc-300 px-2 py-1">
              <option value="" disabled>
                Pick a Discord account…
              </option>
              {linkable.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.displayName} (@{g.username})
                </option>
              ))}
            </select>
            <button className="rounded-md bg-black px-3 py-1 text-white" disabled={linkable.length === 0}>
              Link
            </button>
          </form>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">All members ({members.length})</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-2">Name</th>
              <th>Grad year</th>
              <th>Subteam</th>
              <th>Discord</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className={`border-t border-zinc-200 ${m.active ? "" : "text-zinc-400"}`}>
                <td className="py-2">{fullName(m)}</td>
                <td>{m.grad_year ?? "Mentor"}</td>
                <td>{m.subteam ?? "—"}</td>
                <td>
                  {m.discord_id ? (
                    <form action={unlinkDiscordAction} className="flex items-center gap-2">
                      <input type="hidden" name="memberId" value={m.id} />
                      <span>{discordLabel(m.discord_id, guildById)}</span>
                      <button className="text-xs text-zinc-500 underline">Unlink</button>
                    </form>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <form action={setActiveAction}>
                    <input type="hidden" name="memberId" value={m.id} />
                    <input type="hidden" name="active" value={String(!m.active)} />
                    <button className="text-xs underline">{m.active ? "Active — deactivate" : "Inactive — reactivate"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Add a member</h2>
        <form action={addMemberAction} className="flex flex-wrap gap-3">
          <input name="firstName" placeholder="First name" required className="rounded-md border border-zinc-300 px-2 py-1" />
          <input name="lastName" placeholder="Last name" required className="rounded-md border border-zinc-300 px-2 py-1" />
          <input
            name="gradYear"
            placeholder="Grad year (blank for mentor)"
            inputMode="numeric"
            className="rounded-md border border-zinc-300 px-2 py-1"
          />
          <input name="subteam" placeholder="Subteam (optional)" className="rounded-md border border-zinc-300 px-2 py-1" />
          <button className="rounded-md bg-black px-3 py-1 text-white">Add</button>
        </form>
      </section>
    </main>
  );
}

function fullName(m: Member): string {
  return `${m.first_name} ${m.last_name}`;
}

function discordLabel(discordId: string, guildById: Map<string, GuildMember>): string {
  const g = guildById.get(discordId);
  return g ? `${g.displayName} (@${g.username})` : `${discordId} (not in server)`;
}
