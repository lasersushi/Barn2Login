// The subset of Discord's interaction payload this app reads.
// Full shape: https://discord.com/developers/docs/interactions/receiving-and-responding

export type CommandOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
};

export type Interaction = {
  id: string;
  type: number;
  token: string;
  guild_id?: string;
  data?: {
    name: string;
    options?: CommandOption[];
  };
  // Present when the command is used in a server.
  member?: { user: { id: string; username: string } };
  // Present when the command is used in a DM.
  user?: { id: string; username: string };
};

export type InteractionResponse = {
  type: number;
  data?: {
    content?: string;
    flags?: number;
  };
};
