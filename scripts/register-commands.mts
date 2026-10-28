// Registers slash commands with Discord, guild-scoped so changes are instant.
// Global commands take up to an hour to propagate.
//
// Run with: pnpm discord:register
// Re-run whenever a command is added, renamed, or its options change.
// PUT replaces the full command list, so removed commands disappear too.

const commands = [
  {
    name: "ping",
    description: "Check that the sign-in bot is alive",
  },
  {
    name: "sign-in",
    description: "Get a one-time QR code to scan at the kiosk (signs you in or out)",
  },
  {
    name: "hours",
    description: "See your hours, and how close you are to the next competition's requirement",
  },
  {
    name: "sign-out-all",
    description: "Leadership only: sign out everyone who is still signed in",
  },
];

const appId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

if (!appId || !guildId || !botToken) {
  console.error("Missing DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, or DISCORD_BOT_TOKEN.");
  process.exit(1);
}

const res = await fetch(
  `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  },
);

if (!res.ok) {
  console.error(`Discord returned ${res.status}:`, await res.text());
  process.exit(1);
}

const registered = (await res.json()) as { name: string }[];
console.log(`Registered ${registered.length} command(s): ${registered.map((c) => c.name).join(", ")}`);
