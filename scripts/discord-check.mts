// Diagnoses "Missing Access" (50001) from pnpm discord:register.
// Prints IDs and server names only, never the token.
//
// Run with: pnpm discord:check

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const headers = { Authorization: `Bot ${token}` };

const meRes = await fetch("https://discord.com/api/v10/users/@me", { headers });
if (!meRes.ok) {
  console.log(`Bot token rejected (${meRes.status}). Reset it on the Bot tab and update .env.local.`);
  process.exit(1);
}
const me = (await meRes.json()) as { id: string; username: string };
console.log(`1. Token belongs to bot "${me.username}", app ID ${me.id}`);
console.log(`   DISCORD_APPLICATION_ID matches: ${me.id === appId ? "YES" : "NO  <-- fix this"}`);

const guilds = (await (await fetch("https://discord.com/api/v10/users/@me/guilds", { headers })).json()) as {
  id: string;
  name: string;
}[];
console.log(`2. Bot is in ${guilds.length} server(s):`);
for (const g of guilds) console.log(`   - ${g.name} (${g.id})`);
console.log(
  `3. DISCORD_GUILD_ID is one of them: ${guilds.some((g) => g.id === guildId) ? "YES" : "NO  <-- fix this"}`,
);
