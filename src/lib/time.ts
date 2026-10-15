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
