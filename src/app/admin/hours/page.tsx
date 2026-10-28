import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { listAdjustments } from "@/db/adjustments";
import { hoursByMember, listPeriods } from "@/db/hours";
import { requireAdmin } from "@/lib/auth";
import { formatCalendarDate, formatDate, formatHours } from "@/lib/time";
import {
  createPeriodAction,
  deletePeriodAction,
  overrideRecordSessionAction,
  removeHoursAction,
} from "../actions";

export const metadata: Metadata = { title: "Hours" };

const ERRORS: Record<string, string> = {
  "invalid-period": "A period needs a name, a start date, and an end date.",
  "period-end-before-start": "The period has to end on or after the day it starts.",
  "mentor-not-on-roster": "You're not on the roster yet. Open the roster page once to sync it with Discord, then try again.",
  "invalid-removal": "Pick a member, a number of hours above zero, and a reason.",
  not_found: "That member isn't on the roster.",
  inactive: "They're inactive because they don't have the member role in Discord.",
  "invalid-session": "Pick a member, a date, a start time, and an end time.",
  end_before_start: "The session has to end after it starts.",
  in_future: "That session hasn't ended yet. Use Sign in now on the roster instead.",
  overlap: "That overlaps a session they already have, which would count the time twice.",
  more_than_total: "That's more hours than they have in total.",
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
  const [rows, adjustments] = await Promise.all([
    hoursByMember(selected && { startsOn: selected.starts_on, endsOn: selected.ends_on }),
    listAdjustments(),
  ]);
  // The removal picker shows all-time totals, since that's the most anyone can lose.
  const allTime = selected ? await hoursByMember(null) : rows;
  // The member pickers below are easier to use in name order.
  const byName = allTime.toSorted(
    (a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name),
  );

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Hours</h1>
        <div className="flex gap-4">
          {/* A plain <a>: it's a file download, not a page to navigate to. */}
          <a href="/admin/hours/export" download className="text-sm text-zinc-500 underline">
            Export .xlsx
          </a>
          <Link href="/admin" className="text-sm text-zinc-500 underline">
            Back to roster
          </Link>
        </div>
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
            {byName
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Remove hours</h2>
        <p className="text-sm text-zinc-500">
          Recorded under your name with the reason, and listed below. Sessions aren&apos;t changed: the hours come off
          the total today, so they count against the period that includes today.
        </p>
        <form action={removeHoursAction} className="flex flex-wrap items-center gap-3">
          <select name="memberId" required defaultValue="" className="rounded-md border border-zinc-300 px-2 py-1">
            <option value="" disabled>
              Member…
            </option>
            {byName
              .filter((m) => m.minutes > 0)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name} ({formatHours(m.minutes)} h)
                </option>
              ))}
          </select>
          <input
            name="hours"
            type="number"
            min="0.01"
            step="any"
            required
            placeholder="Hours"
            className="w-24 rounded-md border border-zinc-300 px-2 py-1"
          />
          <input
            name="reason"
            required
            placeholder="Reason, e.g. left early on Oct 20"
            className="min-w-64 flex-1 rounded-md border border-zinc-300 px-2 py-1"
          />
          <button className="rounded-md bg-black px-3 py-1 text-white">Remove</button>
        </form>

        <h3 className="mt-2 font-semibold">Adjustments</h3>
        {adjustments.length === 0 && <p className="text-zinc-500">No adjustments yet.</p>}
        {adjustments.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-2">When</th>
                <th>Member</th>
                <th className="text-right">Hours</th>
                <th className="pl-4">Reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((a) => (
                <tr key={a.id} className="border-t border-zinc-200">
                  <td className="py-2">{formatDate(a.created_at)}</td>
                  <td>{a.member_name}</td>
                  <td className="text-right font-medium">
                    {a.delta_min < 0 ? "−" : "+"}
                    {formatHours(Math.abs(a.delta_min))}
                  </td>
                  <td className="pl-4">{a.reason}</td>
                  <td>{a.mentor_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
