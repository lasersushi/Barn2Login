import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "@/discord/commands";
import { sendCompReminders } from "@/discord/reminders";
import { compRequirement, daysBetween } from "@/lib/comp";
import type { Interaction } from "@/discord/types";
import { sql } from "./db-client";

async function addMember(first: string, discordId: string | null) {
  const [m] = await sql<{ id: string }[]>`
    insert into members (first_name, last_name, discord_id)
    values (${first}, 'Test', ${discordId})
    returning id
  `;
  return m.id;
}

// A closed session of `hours` that started `daysAgo` days ago.
async function addHours(memberId: string, hours: number, daysAgo = 1) {
  await sql`
    insert into sessions (member_id, check_in_at, check_out_at, source, closed_by)
    values (
      ${memberId},
      now() - ${`${daysAgo} days`}::interval,
      now() - ${`${daysAgo} days`}::interval + ${`${hours} hours`}::interval,
      'qr', 'tap'
    )
  `;
}

// Today in Pacific plus `days`, as YYYY-MM-DD.
async function pacificDay(days: number) {
  const [{ day }] = await sql<{ day: string }[]>`
    select to_char((now() at time zone 'America/Los_Angeles')::date + ${days}::int, 'YYYY-MM-DD') as day
  `;
  return day;
}

const COMP_VARS = ["COMP_NAME", "COMP_DATE", "COMP_HOURS_REQUIRED", "COMP_HOURS_FROM", "MENTOR_CHANNEL_ID"];

afterEach(() => {
  for (const name of COMP_VARS) delete process.env[name];
  vi.unstubAllGlobals();
});

describe("daysBetween", () => {
  it("counts calendar days across months and the DST change", () => {
    expect(daysBetween("2026-10-28", "2026-11-04")).toBe(7);
    expect(daysBetween("2027-03-13", "2027-03-15")).toBe(2);
    expect(daysBetween("2026-11-04", "2026-11-04")).toBe(0);
    expect(daysBetween("2026-11-05", "2026-11-04")).toBe(-1);
  });
});

describe("compRequirement", () => {
  it("is off when COMP_DATE is unset", () => {
    expect(compRequirement()).toBeNull();
  });

  it("refuses malformed settings instead of reminding nobody", () => {
    process.env.COMP_DATE = "11/14/2026";
    process.env.COMP_HOURS_REQUIRED = "30";
    expect(() => compRequirement()).toThrow(/COMP_DATE/);
    process.env.COMP_DATE = "2026-11-14";
    process.env.COMP_HOURS_REQUIRED = "thirty";
    expect(() => compRequirement()).toThrow(/COMP_HOURS_REQUIRED/);
  });
});

describe("/hours", () => {
  const hours = (discordId: string) =>
    handleCommand({
      id: "1",
      type: 2,
      token: "t",
      data: { name: "hours" },
      member: { user: { id: discordId, username: "u" }, roles: ["role-member"] },
    } as Interaction);

  it("shows all-time hours, privately", async () => {
    await addHours(await addMember("Ada", "100"), 2.5);
    expect(await hours("100")).toEqual({
      type: 4,
      data: { content: "You have **2.5** hours all time.", flags: 64 },
    });
  });

  it("tells someone with no row how to start", async () => {
    expect((await hours("999")).data?.content).toMatch(/don't have any hours yet/);
  });

  it("adds progress toward the competition, counting only from COMP_HOURS_FROM", async () => {
    const ada = await addMember("Ada", "100");
    await addHours(ada, 4, 30); // before COMP_HOURS_FROM, so it doesn't count
    await addHours(ada, 2.5, 1);
    process.env.COMP_NAME = "Test Regional";
    process.env.COMP_DATE = await pacificDay(7);
    process.env.COMP_HOURS_REQUIRED = "10";
    process.env.COMP_HOURS_FROM = await pacificDay(-7);

    const content = (await hours("100")).data?.content;
    expect(content).toContain("You have **6.5** hours all time.");
    expect(content).toMatch(/Test Regional is in 7 days \(.+\): you have 2\.5 of the 10\.0 hours needed, 7\.5 to go\./);
  });

  it("drops the competition line once it has passed", async () => {
    await addHours(await addMember("Ada", "100"), 1);
    process.env.COMP_DATE = await pacificDay(-1);
    process.env.COMP_HOURS_REQUIRED = "10";
    expect((await hours("100")).data?.content).toBe("You have **1.0** hours all time.");
  });
});

describe("sendCompReminders", () => {
  type Sent = { url: string; body: { recipient_id?: string; content?: string } };
  let sent: Sent[];

  // The Discord server: two students, a mentor (no member role), and a
  // student who has never signed in. "closed" doesn't accept DMs.
  const server = [
    { nick: null, roles: ["role-member"], user: { id: "ada", username: "ada", global_name: "Ada" } },
    { nick: null, roles: ["role-member"], user: { id: "grace", username: "grace", global_name: "Grace" } },
    { nick: null, roles: ["role-mentor"], user: { id: "mentor", username: "m", global_name: "Mentor" } },
    { nick: null, roles: ["role-member"], user: { id: "closed", username: "c", global_name: "Newbie" } },
  ];

  beforeEach(async () => {
    sent = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/guilds/")) return Response.json(server);
        const body = JSON.parse(String(init?.body));
        sent.push({ url, body });
        if (url.endsWith("/users/@me/channels")) return Response.json({ id: `dm-${body.recipient_id}` });
        if (url.includes("/channels/dm-closed/")) {
          return Response.json({ code: 50007, message: "Cannot send messages to this user" }, { status: 403 });
        }
        return Response.json({ id: "message" });
      }),
    );
    await addHours(await addMember("Ada", "ada"), 3);
    await addHours(await addMember("Grace", "grace"), 12);
    await addMember("Mentor", "mentor");
    process.env.COMP_DATE = await pacificDay(7);
    process.env.COMP_HOURS_REQUIRED = "10";
  });

  const dmsTo = (id: string) => sent.filter((s) => s.url.endsWith(`/channels/dm-${id}/messages`));

  it("DMs students short on hours, skipping mentors and anyone who's met it", async () => {
    const result = await sendCompReminders();
    expect(result).toMatchObject({ daysLeft: 7, behind: 2, dmed: 1, dmsClosed: ["Newbie"] });
    expect(dmsTo("ada")).toHaveLength(1);
    expect(dmsTo("ada")[0].body.content).toMatch(/^Hours reminder: .*3\.0 of the 10\.0 hours needed, 7\.0 to go/);
    expect(dmsTo("grace")).toHaveLength(0);
    expect(sent.some((s) => s.body.recipient_id === "mentor")).toBe(false);
  });

  it("tells mentors who couldn't be reached", async () => {
    process.env.MENTOR_CHANNEL_ID = "mentors";
    await sendCompReminders();
    const report = sent.find((s) => s.url.endsWith("/channels/mentors/messages"))!.body.content!;
    expect(report).toContain("1 of 3 have the 10.0 hours needed");
    expect(report).toContain("DMed 1: Ada");
    expect(report).toContain("DMs closed, please tell them in person:** Newbie");
  });

  it("sends nothing on days that aren't reminder days", async () => {
    process.env.COMP_DATE = await pacificDay(5);
    expect(await sendCompReminders()).toEqual({ daysLeft: 5, sent: "not a reminder day" });
    expect(sent).toHaveLength(0);
  });

  it("keeps going after an error, then fails so the cron reports it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/guilds/")) return Response.json(server);
        const body = JSON.parse(String(init?.body));
        sent.push({ url, body });
        if (body.recipient_id === "ada") return new Response("oops", { status: 500 });
        if (url.endsWith("/users/@me/channels")) return Response.json({ id: `dm-${body.recipient_id}` });
        return Response.json({ id: "message" });
      }),
    );
    await expect(sendCompReminders()).rejects.toThrow(/Couldn't DM Ada: Discord returned 500/);
    expect(dmsTo("closed")).toHaveLength(1);
  });
});
