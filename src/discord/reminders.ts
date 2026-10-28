import "server-only";
import { hoursByMember, pacificToday } from "@/db/hours";
import { listMembers } from "@/db/members";
import { fetchGuildMembers, postChannelMessage, sendDirectMessage } from "@/discord/api";
import { compProgress, compRange, compRequirement, daysBetween } from "@/lib/comp";
import { requireEnv } from "@/lib/env";
import { formatHours } from "@/lib/time";

// Days before the competition when anyone short on hours gets a DM. Only
// these days, so it's a few nudges rather than a nightly nag.
export const REMINDER_DAYS = [14, 7, 3, 1];

// Discord rejects messages over 2,000 characters.
const MAX_MESSAGE = 2000;

// Run by the nightly cron. Goes by the Discord server, not the members table,
// so someone with the member role who has never signed in (and so has no row
// yet) is reminded at zero hours. Mentors are on the roster through
// ADMIN_ROLE_IDS but don't need hours, so only the member role counts;
// captains have both roles and are reminded like everyone else.
export async function sendCompReminders() {
  const comp = compRequirement();
  if (!comp) return "not configured";

  const daysLeft = daysBetween(await pacificToday(), comp.date);
  if (!REMINDER_DAYS.includes(daysLeft)) return { daysLeft, sent: "not a reminder day" };

  const memberRole = requireEnv("MEMBER_ROLE_ID").trim();
  const [server, roster, hours] = await Promise.all([
    fetchGuildMembers(),
    listMembers(),
    hoursByMember(compRange(comp)),
  ]);
  const rowIdByDiscordId = new Map(roster.flatMap((m) => (m.discord_id ? [[m.discord_id, m.id]] : [])));
  const minutesByRowId = new Map(hours.map((h) => [h.id, h.minutes]));

  const students = server.filter((person) => person.roles.includes(memberRole));
  const behind = students
    .map((person) => {
      const rowId = rowIdByDiscordId.get(person.id);
      return { person, minutes: (rowId && minutesByRowId.get(rowId)) || 0 };
    })
    .filter(({ minutes }) => minutes < comp.requiredMinutes);

  // One at a time: ~40 DMs is quick, and it stays clear of rate limits.
  // One person's failure doesn't stop the rest.
  const dmed: string[] = [];
  const dmsClosed: string[] = [];
  const failed: string[] = [];
  let firstError: unknown;
  for (const { person, minutes } of behind) {
    const message = `Hours reminder: ${compProgress(comp, minutes, daysLeft)} Run /hours anytime to check.`;
    try {
      const delivered = await sendDirectMessage(person.id, message);
      (delivered ? dmed : dmsClosed).push(person.displayName);
    } catch (e) {
      failed.push(person.displayName);
      firstError ??= e;
    }
  }

  // Mentors follow up in person with anyone the bot couldn't reach.
  const channelId = process.env.MENTOR_CHANNEL_ID?.trim();
  if (channelId) {
    const lines = [
      `**Hours reminders:** ${comp.name ?? "the competition"} is in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. ` +
        `${students.length - behind.length} of ${students.length} have the ${formatHours(comp.requiredMinutes)} hours needed.`,
    ];
    if (dmed.length) lines.push(`DMed ${dmed.length}: ${dmed.join(", ")}`);
    if (dmsClosed.length) lines.push(`**DMs closed, please tell them in person:** ${dmsClosed.join(", ")}`);
    if (failed.length) lines.push(`**Couldn't DM (error):** ${failed.join(", ")}`);
    const report = lines.join("\n");
    await postChannelMessage(
      channelId,
      report.length <= MAX_MESSAGE ? report : `${report.slice(0, MAX_MESSAGE - 1)}…`,
    );
  }

  // Thrown last so everyone else still got their DM and mentors their list.
  if (failed.length) {
    const reason = firstError instanceof Error ? firstError.message : String(firstError);
    throw new Error(`Couldn't DM ${failed.join(", ")}: ${reason}`);
  }

  return {
    daysLeft,
    behind: behind.length,
    dmed: dmed.length,
    dmsClosed,
    mentorReport: channelId ? "posted" : "MENTOR_CHANNEL_ID not set",
  };
}
