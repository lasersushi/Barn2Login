import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { hoursByMember, listPeriods } from "@/db/hours";
import { requireAdmin } from "@/lib/auth";
import { formatCalendarDate, formatHours } from "@/lib/time";
import { createPeriodAction, deletePeriodAction } from "../actions";

export const metadata: Metadata = { title: "Hours" };

const ERRORS: Record<string, string> = {
  "invalid-period": "A period needs a name, a start date, and an end date.",
  "period-end-before-start": "The period has to end on or after the day it starts.",
  "mentor-not-on-roster": "You're not on the roster yet. Open the roster page once to sync it with Discord, then try again.",
};

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; error?: string }>;
}) {
  await requireAdmin();
  const { period, error } = await searchParams;

  const periods = await listPeriods();
  // Chosen from the list rather than queried, so a stale or edited link
  // falls back to all time instead of erroring.
  const selected = periods.find((p) => p.id === period) ?? null;
  const rows = await hoursByMember(selected && { startsOn: selected.starts_on, endsOn: selected.ends_on });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Hours</h1>
        <Link href="/admin" className="text-sm text-zinc-500 underline">
          Back to roster
        </Link>
      </header>

      {error && ERRORS[error] && <p className="rounded-md bg-red-100 p-3 text-red-800">{ERRORS[error]}</p>}

      <section className="flex flex-col gap-3">
        <nav className="flex flex-wrap gap-2">
          <PeriodLink href="/admin/hours" current={!selected}>
            All time
          </PeriodLink>
          {periods.map((p) => (
            <PeriodLink key={p.id} href={`/admin/hours?period=${p.id}`} current={selected?.id === p.id}>
              {p.name}
            </PeriodLink>
          ))}
        </nav>
        <p className="text-sm text-zinc-500">
          {selected
            ? `${formatCalendarDate(selected.starts_on)} – ${formatCalendarDate(selected.ends_on)}. `
            : ""}
          Time counts once someone signs out. Adjustments count on the day they were entered.
        </p>

        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-2">Name</th>
              <th className="text-right">Sessions</th>
              <th className="text-right">Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={`border-t border-zinc-200 ${m.active ? "" : "text-zinc-400"}`}>
                <td className="py-2">
                  {m.first_name} {m.last_name}
                  {!m.active && " (inactive)"}
                </td>
                <td className="text-right">{m.sessions}</td>
                <td className="text-right font-medium">{formatHours(m.minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Periods</h2>
        <p className="text-sm text-zinc-500">
          A period is just a name and a date range (Pacific, both days included). Deleting one doesn&apos;t touch
          anyone&apos;s hours.
        </p>
        {periods.length === 0 && <p className="text-zinc-500">No periods yet.</p>}
        {periods.map((p) => (
          <form key={p.id} action={deletePeriodAction} className="flex items-center gap-3">
            <input type="hidden" name="periodId" value={p.id} />
            <span className="w-48 font-medium">{p.name}</span>
            <span className="text-sm text-zinc-500">
              {formatCalendarDate(p.starts_on)} – {formatCalendarDate(p.ends_on)}
            </span>
            <button className="text-xs underline">Delete</button>
          </form>
        ))}

        <form action={createPeriodAction} className="flex flex-wrap items-center gap-3">
          <input
            name="name"
            placeholder="Name, e.g. Build season 2027"
            required
            className="rounded-md border border-zinc-300 px-2 py-1"
          />
          <input name="startsOn" type="date" required className="rounded-md border border-zinc-300 px-2 py-1" />
          <span>to</span>
          <input name="endsOn" type="date" required className="rounded-md border border-zinc-300 px-2 py-1" />
          <button className="rounded-md bg-black px-3 py-1 text-white">Create</button>
        </form>
      </section>
    </main>
  );
}

function PeriodLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-sm ${
        current ? "border-black bg-black text-white" : "border-zinc-300"
      }`}
    >
      {children}
    </Link>
  );
}
