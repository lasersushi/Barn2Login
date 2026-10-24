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
  // Present when the command is used in a server. roles are role IDs;
  // nick is the server nickname.
  member?: {
    user: { id: string; username: string; global_name?: string | null };
    roles?: string[];
    nick?: string | null;
  };
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
