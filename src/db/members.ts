import "server-only";
import { sql } from "@/db/client";

export type Member = {
  id: string;
  first_name: string;
  last_name: string;
  grad_year: number | null; // null for mentors
  subteam: string | null;
  discord_id: string | null;
  photo_url: string | null;
  active: boolean;
};

// Unlinked members first: they can't sign in until a mentor links them.
export async function listMembers(): Promise<Member[]> {
  return sql<Member[]>`
    select id, first_name, last_name, grad_year, subteam, discord_id, photo_url, active
    from members
    order by (discord_id is null) desc, active desc, last_name, first_name
  `;
}

export async function createMember(input: {
  firstName: string;
  lastName: string;
  gradYear: number | null;
  subteam: string | null;
}): Promise<void> {
  await sql`
    insert into members (first_name, last_name, grad_year, subteam)
    values (${input.firstName}, ${input.lastName}, ${input.gradYear}, ${input.subteam})
  `;
}

// discord_id is unique, so linking an ID that's already in use throws.
export async function linkDiscord(memberId: string, discordId: string): Promise<void> {
  await sql`update members set discord_id = ${discordId} where id = ${memberId}`;
}

export async function unlinkDiscord(memberId: string): Promise<void> {
  await sql`update members set discord_id = null where id = ${memberId}`;
}

// Soft delete only: sessions and adjustments stay attached (Design.md §13).
export async function setActive(memberId: string, active: boolean): Promise<void> {
  await sql`update members set active = ${active} where id = ${memberId}`;
}

export async function findMemberByDiscordId(discordId: string): Promise<Member | null> {
  const [member] = await sql<Member[]>`
    select id, first_name, last_name, grad_year, subteam, discord_id, photo_url, active
    from members
    where discord_id = ${discordId}
  `;
  return member ?? null;
}
