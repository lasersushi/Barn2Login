// All display formatting happens on the server in the team's time zone
// (CLAUDE.md invariant #3). Clients receive finished strings.
const ZONE = "America/Los_Angeles";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hour: "numeric",
  minute: "2-digit",
});

export function formatTime(date: Date): string {
  return timeFormat.format(date);
}

export function formatDuration(from: Date, to: Date): string {
  const totalMin = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

// A YYYY-MM-DD calendar date is already Pacific, so it's formatted as-is.
// Treating it as an instant and converting would shift it by a day.
const calendarFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatCalendarDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return calendarFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}
