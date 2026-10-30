import { InteractionResponseFlags, InteractionResponseType } from "discord-interactions";
import { issueRedeemCode, REDEEM_TTL_MIN } from "@/db/codes";
import { hoursByMember, pacificToday } from "@/db/hours";
import { findMemberByDiscordId, upsertMember } from "@/db/members";
import { signOutAll } from "@/db/sessions";
import { discordDisplayName } from "@/discord/api";
import { belongsOnRoster, hasAdminRole } from "@/lib/auth";
import { compProgress, compRange, compRequirement, daysBetween } from "@/lib/comp";
import { requireEnv } from "@/lib/env";
import { formatHours } from "@/lib/time";
import type { Interaction, InteractionResponse } from "@/discord/types";

// Stops Discord from fetching the link to build a preview. A crawler
// visiting a one-time link is harmless here (redeeming needs a POST from
// the page's JavaScript), but the preview is noise either way.
const SUPPRESS_EMBEDS = 1 << 2;

// Command definitions live in scripts/register-commands.mts. A name handled
// here must also be registered there, or Discord will never send it.
export async function handleCommand(interaction: Interaction): Promise<InteractionResponse> {
  switch (interaction.data?.name) {
    case "ping":
      return reply("Pong!");
    case "my-qr":
      return myQr(interaction);
    case "hours":
      return myHours(interaction);
    case "sign-out-all":
      return signOutEveryone(interaction);
    default:
      return reply("Unknown command.");
  }
}

// Design.md §5a: reply privately with a one-time link to the member's
// permanent QR. The link keeps the long-lived token out of Discord.
//
// Having the member role is what puts someone on the roster, so their first
// /my-qr creates their row; nobody has to add them first.
//
// A member who already has a QR gets no link unless they pass reset:True.
// Tapping a link replaces the old QR, so this stops someone from turning
// off the QR in their Photos by accident.
async function myQr(interaction: Interaction): Promise<InteractionResponse> {
  // In a DM there's no member, so no roles to check.
  const discord = interaction.member;
  if (!discord) return reply("Run /my-qr in the Barn 2 server.");
  if (!belongsOnRoster(discord.roles)) {
    return reply("You need the member role in the Barn 2 server to sign in. Ask leadership if that's a mistake.");
  }

  const member = await upsertMember({
    discordId: discord.user.id,
    displayName: discordDisplayName(discord.nick, discord.user),
  });

  const reset = interaction.data?.options?.find((o) => o.name === "reset")?.value === true;
  if (member.has_phone_qr && !reset) {
    return reply(
      `You already have a sign-in QR code. Find it in your Photos and scan that one. ` +
        `Lost it? Run /my-qr again with reset set to True. That makes a new code and turns the old one off.`,
    );
  }

  const { token } = await issueRedeemCode(member.id);
  const link = `${requireEnv("APP_BASE_URL")}/redeem/${token}`;
  return reply(
    `Tap to get your permanent sign-in QR code. Save it to Photos and scan it every time you arrive and leave. ` +
      `(Link works once, expires in ${REDEEM_TTL_MIN} minutes. Getting a new code turns your old one off.)\n${link}`,
    SUPPRESS_EMBEDS,
  );
}

// A member's own hours, privately. Same numbers as /admin/hours, plus
// progress toward the next competition when COMP_DATE is set.
async function myHours(interaction: Interaction): Promise<InteractionResponse> {
  const discordId = interaction.member?.user.id ?? interaction.user?.id;
  const member = discordId ? await findMemberByDiscordId(discordId) : null;
  if (!member) return reply("You don't have any hours yet. Run /my-qr to get your sign-in QR code, then scan it at the kiosk.");

  const minutesFor = async (range: Parameters<typeof hoursByMember>[0]) =>
    (await hoursByMember(range)).find((r) => r.id === member.id)?.minutes ?? 0;

  const allTime = await minutesFor(null);
  const lines = [`You have **${formatHours(allTime)}** hours all time.`];

  const comp = compRequirement();
  if (comp) {
    const daysLeft = daysBetween(await pacificToday(), comp.date);
    if (daysLeft >= 0) {
      const counted = comp.countFrom ? await minutesFor(compRange(comp)) : allTime;
      lines.push(compProgress(comp, counted, daysLeft));
    }
  }
  return reply(lines.join("\n"));
}

// Leadership's end-of-day command. Anyone in the server can see it, but only
// members with one of the ADMIN_ROLE_IDS roles can run it. In a DM there's no member,
// so no roles, so it's refused.
async function signOutEveryone(interaction: Interaction): Promise<InteractionResponse> {
  if (!hasAdminRole(interaction.member?.roles)) {
    return reply("Only team leadership can sign everyone out.");
  }

  const signedOut = await signOutAll();
  if (signedOut.length === 0) return reply("Nobody was signed in.");

  const names = signedOut.map((m) => `${m.first_name} ${m.last_name}`).join(", ");
  const message = `Signed out ${signedOut.length}: ${names}`;
  // Discord rejects messages over 2,000 characters.
  return reply(message.length <= 2000 ? message : `Signed out ${signedOut.length} people.`);
}

// Ephemeral replies are visible only to the member who ran the command.
export function reply(content: string, extraFlags = 0): InteractionResponse {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: InteractionResponseFlags.EPHEMERAL | extraFlags },
  };
}
