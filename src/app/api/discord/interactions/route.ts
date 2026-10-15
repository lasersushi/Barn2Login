import { InteractionResponseType, InteractionType, verifyKey } from "discord-interactions";
import { handleCommand } from "@/discord/commands";
import type { Interaction } from "@/discord/types";

// Discord POSTs every slash command here (HTTP interactions, no gateway).
// Discord also sends deliberately invalid signatures to test this endpoint,
// so verification must never be stubbed out.
export async function POST(req: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error("DISCORD_PUBLIC_KEY is not set.");
  }

  // The signature covers the exact bytes Discord sent, so read the raw body
  // before any parsing. Re-serializing parsed JSON would break verification.
  const body = await req.text();
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");

  if (!signature || !timestamp || !(await verifyKey(body, signature, timestamp, publicKey))) {
    return new Response("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(body) as Interaction;

  if (interaction.type === InteractionType.PING) {
    return Response.json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    return Response.json(await handleCommand(interaction));
  }

  return new Response("unsupported interaction type", { status: 400 });
}
