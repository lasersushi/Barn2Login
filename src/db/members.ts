import "server-only";
import { db } from "@/db/client";

export type Member = {
  id: string;
  first_name: string;
  last_name: string;
  grad_year: number | null;
  subteam: string | null;
  discord_id: string | null;
  photo_url: string | null;
  active: boolean;
};

// The roster mirrors Discord: everyone with the member role (or a leadership
// role) has a row, keyed by discord_id. Nobody is added by hand.
export type RosterPerson = { discordId: string; displayName: string };

// Discord has one name; the roster has two. "Mary Jane Smith" becomes
// "Mary" + "Jane Smith". A one-word name leaves last_name empty.
export function splitName(displayName: string): { firstName: string; lastName: string } {
  const [firstName, ...rest] = displayName.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

export async function listMembers(): Promise<Member[]> {
  return db()<Member[]>`
    select id, first_name, last_name, grad_year, subteam, discord_id, photo_url, active
    from members
    order by active desc, last_name, first_name
  `;
}

// For /my-qr: makes sure the person running it has an active row with
// their current Discord name, creating it the first time.
export async function upsertMember(person: RosterPerson): Promise<Member> {
  const { firstName, lastName } = splitName(person.displayName);
  const [member] = await db()<Member[]>`
    insert into members (discord_id, first_name, last_name)
    values (${person.discordId}, ${firstName}, ${lastName})
    on conflict (discord_id) do update
      set first_name = excluded.first_name, last_name = excluded.last_name, active = true
    returning id, first_name, last_name, grad_year, subteam, discord_id, photo_url, active
  `;
  return member;
}

// Makes the roster match `people`: adds or reactivates everyone in it,
// refreshes their names, and deactivates everyone else. Deactivating is a
// soft delete: sessions and hours stay (Design.md §13).
export async function syncRoster(people: RosterPerson[]): Promise<void> {
  // An empty list means the role ID is wrong or Discord returned nothing,
  // not that the whole team quit. Refuse rather than deactivate everyone.
  if (people.length === 0) {
    throw new Error("Nobody in the Discord server has the member role. Check MEMBER_ROLE_ID.");
  }
  const ids = people.map((p) => p.discordId);
  const names = people.map((p) => splitName(p.displayName));
  await db().begin(async (tx) => {
    await tx`
      insert into members (discord_id, first_name, last_name)
      select * from unnest(
        ${ids}::text[],
        ${names.map((n) => n.firstName)}::text[],
        ${names.map((n) => n.lastName)}::text[]
      )
      on conflict (discord_id) do update
        set first_name = excluded.first_name, last_name = excluded.last_name, active = true
    `;
    await tx`
      update members set active = false
      where active and (discord_id is null or discord_id <> all(${ids}::text[]))
    `;
  });
}

export async function findMemberByDiscordId(discordId: string): Promise<Member | null> {
  const [member] = await db()<Member[]>`
    select id, first_name, last_name, grad_year, subteam, discord_id, photo_url, active
    from members
    where discord_id = ${discordId}
  `;
  return member ?? null;
}
