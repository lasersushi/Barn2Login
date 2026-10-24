import { afterEach, describe, expect, it, vi } from "vitest";
import { splitName, syncRoster } from "@/db/members";
import { fetchGuildMembers } from "@/discord/api";
import { sql } from "./db-client";

const roster = () =>
  sql<{ discord_id: string | null; first_name: string; last_name: string; active: boolean }[]>`
    select discord_id, first_name, last_name, active from members order by discord_id nulls first
  `;

describe("splitName", () => {
  it("puts the first word in first_name and the rest in last_name", () => {
    expect(splitName("Ada Lovelace")).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(splitName("  Mary  Jane Smith ")).toEqual({ firstName: "Mary", lastName: "Jane Smith" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });
});

describe("syncRoster", () => {
  it("adds everyone it's given", async () => {
    await syncRoster([
      { discordId: "1", displayName: "Ada Lovelace" },
      { discordId: "2", displayName: "Grace Hopper" },
    ]);
    expect(await roster()).toEqual([
      { discord_id: "1", first_name: "Ada", last_name: "Lovelace", active: true },
      { discord_id: "2", first_name: "Grace", last_name: "Hopper", active: true },
    ]);
  });

  it("deactivates people who lost the role, left, or were never linked, and keeps their hours", async () => {
    const [left] = await sql<{ id: string }[]>`
      insert into members (first_name, last_name, discord_id) values ('Left', 'Team', '9') returning id
    `;
    await sql`insert into members (first_name, last_name) values ('Old', 'Manual')`;
    await sql`
      insert into sessions (member_id, check_in_at, check_out_at, source, closed_by)
      values (${left.id}, now() - interval '2 hours', now() - interval '1 hour', 'qr', 'tap')
    `;

    await syncRoster([{ discordId: "1", displayName: "Ada Lovelace" }]);

    expect(await roster()).toEqual([
      { discord_id: null, first_name: "Old", last_name: "Manual", active: false },
      { discord_id: "1", first_name: "Ada", last_name: "Lovelace", active: true },
      { discord_id: "9", first_name: "Left", last_name: "Team", active: false },
    ]);
    const [{ total_minutes }] = await sql`select total_minutes from member_hours where member_id = ${left.id}`;
    expect(Math.round(Number(total_minutes))).toBe(60);
  });

  it("reactivates and renames people who come back, without duplicating them", async () => {
    await syncRoster([{ discordId: "1", displayName: "Ada Lovelace" }, { discordId: "2", displayName: "Grace" }]);
    await syncRoster([{ discordId: "2", displayName: "Grace" }]);
    await syncRoster([
      { discordId: "1", displayName: "Ada King" },
      { discordId: "2", displayName: "Grace" },
    ]);
    expect(await roster()).toEqual([
      { discord_id: "1", first_name: "Ada", last_name: "King", active: true },
      { discord_id: "2", first_name: "Grace", last_name: "", active: true },
    ]);
  });

  it("refuses an empty list instead of deactivating everyone", async () => {
    await syncRoster([{ discordId: "1", displayName: "Ada Lovelace" }]);
    await expect(syncRoster([])).rejects.toThrow(/MEMBER_ROLE_ID/);
    expect((await roster())[0].active).toBe(true);
  });
});

describe("fetchGuildMembers", () => {
  afterEach(() => vi.unstubAllGlobals());

  const person = (id: number) => ({
    nick: null,
    roles: ["role-member"],
    user: { id: String(id), username: `user${id}`, global_name: `User ${id}` },
  });

  it("follows pages past Discord's 1,000-member limit and skips bots", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => person(i + 1));
    const second = [person(1001), { nick: null, roles: [], user: { id: "1002", username: "bot", bot: true } }];
    const fetchMock = vi.fn(async (url: string) =>
      Response.json(new URL(url).searchParams.get("after") === "0" ? first : second),
    );
    vi.stubGlobal("fetch", fetchMock);

    const members = await fetchGuildMembers();
    expect(members).toHaveLength(1001);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get("after"))).toEqual(["0", "1000"]);
    expect(members.find((m) => m.id === "1001")).toEqual({
      id: "1001",
      username: "user1001",
      displayName: "User 1001",
      roles: ["role-member"],
    });
  });
});
