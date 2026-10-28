import "server-only";
import { requireEnv } from "@/lib/env";
import { formatCalendarDate, formatHours } from "@/lib/time";

// The next competition's hours requirement. It lives in env vars, not the
// database, so changing it means editing Vercel's settings and redeploying.
// With COMP_DATE unset, reminders are off and /hours shows all-time only.
export type CompRequirement = {
  name: string | null; // COMP_NAME, e.g. "Silicon Valley Regional"
  date: string; // COMP_DATE, YYYY-MM-DD, Pacific
  requiredMinutes: number; // COMP_HOURS_REQUIRED, in hours
  countFrom: string | null; // COMP_HOURS_FROM, YYYY-MM-DD; null counts all time
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Read at call time like requireEnv. A malformed value throws rather than
// silently reminding nobody.
export function compRequirement(): CompRequirement | null {
  const date = process.env.COMP_DATE?.trim();
  if (!date) return null;
  if (!YMD.test(date)) throw new Error(`COMP_DATE must be YYYY-MM-DD, got "${date}".`);

  const hours = Number(requireEnv("COMP_HOURS_REQUIRED"));
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`COMP_HOURS_REQUIRED must be a positive number of hours.`);
  }

  const countFrom = process.env.COMP_HOURS_FROM?.trim() || null;
  if (countFrom && !YMD.test(countFrom)) {
    throw new Error(`COMP_HOURS_FROM must be YYYY-MM-DD, got "${countFrom}".`);
  }

  return {
    name: process.env.COMP_NAME?.trim() || null,
    date,
    requiredMinutes: Math.round(hours * 60),
    countFrom,
  };
}

// The hours that count toward the requirement, in hoursByMember's terms.
export function compRange(comp: CompRequirement): { startsOn: string; endsOn: string } | null {
  return comp.countFrom ? { startsOn: comp.countFrom, endsOn: comp.date } : null;
}

// Whole days from one YYYY-MM-DD to another. Both are already Pacific
// calendar dates, so this is plain date arithmetic with no time zones.
export function daysBetween(from: string, to: string): number {
  const utc = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

// One line for /hours and the reminder DM, e.g. "Silicon Valley Regional is
// in 7 days (Mar 12, 2027): you have 18.5 of the 30.0 hours needed, 11.5 to go."
export function compProgress(comp: CompRequirement, minutes: number, daysLeft: number): string {
  const when = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
  const what = `${comp.name ?? "The competition"} is ${when} (${formatCalendarDate(comp.date)})`;
  const since = comp.countFrom ? ` Hours since ${formatCalendarDate(comp.countFrom)} count.` : "";
  const needed = formatHours(comp.requiredMinutes);
  if (minutes >= comp.requiredMinutes) {
    return `${what}: you have ${formatHours(minutes)} hours, so you've met the ${needed} needed.${since}`;
  }
  return (
    `${what}: you have ${formatHours(minutes)} of the ${needed} hours needed, ` +
    `${formatHours(comp.requiredMinutes - minutes)} to go.${since}`
  );
}
