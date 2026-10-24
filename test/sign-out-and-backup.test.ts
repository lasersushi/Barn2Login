import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as nightly } from "@/app/api/cron/nightly/route";
import { signOutAll } from "@/db/sessions";
import { handleCommand } from "@/discord/commands";
import { isAdmin } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { sql } from "./db-client";

async function addMember(firstName = "Ada", lastName = "Lovelace") {
  const [m] = await sql<{ id: string }[]>`
    insert into members (first_name, last_name, grad_year, token_hash)
    values (${firstName}, ${lastName}, 2028, 'secret-hash-' || gen_random_uuid()) returning id
  `;
  return m.id;
}

async function openSession(memberId: string, checkedInAgo = "2 hours") {
  const [s] = await sql<{ id: string }[]>`
    insert into sessions (member_id, check_in_at, source)
    values (${memberId}, now() - ${checkedInAgo}::interval, 'qr')
    returning id
  `;
  return s.id;
}

async function session(id: string) {
  const [s] = await sql`select check_out_at, closed_by, flags from sessions where id = ${id}`;
  return s;
}

describe("signOutAll", () => {
  it("closes every open session now, as an admin close, and says who", async () => {
    const a = await openSession(await addMember("Ada", "Lovelace"));
    const b = await openSession(await addMember("Grace", "Hopper"));

    expect(await signOutAll()).toEqual([
      { first_name: "Grace", last_name: "Hopper" },
      { first_name: "Ada", last_name: "Lovelace" },
    ]);
    for (const id of [a, b]) {
      const s = await session(id);
      expect(s.closed_by).toBe("admin");
      expect(s.check_out_at).not.toBeNull();
      expect(s.flags).toEqual([]);
    }
  });

  it("never touches a session that's already closed", async () => {
    const id = await openSession(await addMember());
    await sql`update sessions set check_out_at = now(), closed_by = 'tap' where id = ${id}`;
    expect(await signOutAll()).toEqual([]);
    expect((await session(id)).closed_by).toBe("tap");
  });
});

describe("/sign-out-all command", () => {
  const interaction = (roles?: string[]) => ({
    id: "1",
    type: 2,
    token: "t",
    data: { name: "sign-out-all" },
    member: { user: { id: "user-1", username: "someone" }, roles },
  });

  it("refuses anyone without the leadership role, and signs nobody out", async () => {
    const id = await openSession(await addMember());
    for (const roles of [undefined, [], ["role-member"]]) {
      const res = await handleCommand(interaction(roles));
      expect(res.data?.content).toMatch(/Only team leadership/);
    }
    expect((await session(id)).check_out_at).toBeNull();
  });

  it("accepts any of the listed leadership roles", async () => {
    for (const role of ["role-captain", "role-leadership", "role-mentor"]) {
      const res = await handleCommand(interaction([role]));
      expect(res.data?.content).toBe("Nobody was signed in.");
    }
  });

  it("refuses when run in a DM, where there are no roles", async () => {
    const res = await handleCommand({ id: "1", type: 2, token: "t", data: { name: "sign-out-all" }, user: { id: "u", username: "u" } });
    expect(res.data?.content).toMatch(/Only team leadership/);
  });

  it("signs everyone out for leadership and lists them", async () => {
    await openSession(await addMember("Ada", "Lovelace"));
    await openSession(await addMember("Grace", "Hopper"));
    const res = await handleCommand(interaction(["role-member", "role-leadership"]));
    expect(res.data?.content).toBe("Signed out 2: Grace Hopper, Ada Lovelace");
    expect(res.data?.flags).toBe(64);
  });

  it("says so when nobody is signed in", async () => {
    const res = await handleCommand(interaction(["role-leadership"]));
    expect(res.data?.content).toBe("Nobody was signed in.");
  });
});

describe("isAdmin (website login)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function discordReturns(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("looks up the member's roles in the team server with the bot token", async () => {
    const fetchMock = discordReturns(200, { roles: ["role-leadership"] });
    expect(await isAdmin("user-1")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/guilds/guild-1/members/user-1",
      expect.objectContaining({ headers: { Authorization: "Bot test-bot-token" } }),
    );
  });

  it("is false without the role, or when they aren't in the server", async () => {
    discordReturns(200, { roles: ["role-member"] });
    expect(await isAdmin("user-1")).toBe(false);
    discordReturns(404, { message: "Unknown Member" });
    expect(await isAdmin("user-1")).toBe(false);
  });

  it("fails closed when Discord errors", async () => {
    discordReturns(500, {});
    await expect(isAdmin("user-1")).rejects.toThrow();
  });
});

describe("GET /api/cron/nightly", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Answers every upload with success and records what was sent where.
  function captureFetch() {
    const uploads: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        uploads.push({ url, body: String(init.body) });
        return Response.json({ ok: true });
      }),
    );
    return uploads;
  }

  const request = (auth?: string) =>
    new Request("http://localhost/api/cron/nightly", { headers: auth ? { authorization: auth } : {} });

  it("rejects calls without the cron secret", async () => {
    expect((await nightly(request())).status).toBe(401);
    expect((await nightly(request("Bearer wrong"))).status).toBe(401);
  });

  it("backs up to Storage without token hashes, and doesn't sign anyone out", async () => {
    const id = await openSession(await addMember());
    const uploads: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        uploads.push({ url, body: String(init.body) });
        return new Response("{}", { status: 200 });
      }),
    );

    const res = await nightly(request("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json())).toEqual(["heartbeat", "backup"]);
    expect(uploads.map((u) => u.url.split("/").slice(-1)[0])).toEqual([
      "hours.csv",
      "members.csv",
      "sessions.csv",
      "adjustments.csv",
      "periods.csv",
    ]);
    expect(uploads[0].url).toMatch(/^https:\/\/supabase\.test\/storage\/v1\/object\/backups\/\d{4}-\d{2}-\d{2}\//);
    expect(uploads[1].body).not.toContain("secret-hash");
    expect((await session(id)).check_out_at).toBeNull();
  });

  it("writes a readable hours.csv with a column per period", async () => {
    const ada = await addMember("Ada", "Lovelace");
    await sql`
      insert into sessions (member_id, check_in_at, check_out_at, source, closed_by) values
        (${ada}, '2026-10-01 16:00-07', '2026-10-01 18:30-07', 'qr', 'tap'),
        (${ada}, '2026-11-05 16:00-08', '2026-11-05 17:00-08', 'qr', 'tap')
    `;
    await sql`
      insert into periods (name, starts_on, ends_on, created_by)
      values ('October', '2026-10-01', '2026-10-31', ${ada})
    `;
    const uploads = captureFetch();

    await nightly(request("Bearer test-cron-secret"));
    const hours = uploads.find((u) => u.url.endsWith("/hours.csv"))!.body;
    expect(hours).toBe(
      '"First name","Last name","Status","All time (hours)","October, 2026-10-01 to 2026-10-31 (hours)"\n' +
        '"Ada","Lovelace","Active","3.5","2.5"\n',
    );
  });

  describe("Google Drive copy", () => {
    afterEach(() => {
      delete process.env.DRIVE_BACKUP_URL;
      delete process.env.DRIVE_BACKUP_SECRET;
    });

    it("is skipped when not set up", async () => {
      const uploads = captureFetch();
      const res = await nightly(request("Bearer test-cron-secret"));
      expect((await res.json()).backup.drive).toBe("not configured");
      expect(uploads.every((u) => u.url.startsWith("https://supabase.test/"))).toBe(true);
    });

    it("posts the same files to the Apps Script with the shared secret", async () => {
      process.env.DRIVE_BACKUP_URL = "https://script.google.test/exec";
      process.env.DRIVE_BACKUP_SECRET = "drive-secret";
      const uploads = captureFetch();

      const res = await nightly(request("Bearer test-cron-secret"));
      expect(res.status).toBe(200);
      const drive = uploads.find((u) => u.url === "https://script.google.test/exec")!;
      const body = JSON.parse(drive.body);
      expect(body.secret).toBe("drive-secret");
      expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Object.keys(body.files)).toEqual([
        "hours.csv",
        "members.csv",
        "sessions.csv",
        "adjustments.csv",
        "periods.csv",
      ]);
    });

    it("still copies to Drive when Storage fails, and reports both failures", async () => {
      process.env.DRIVE_BACKUP_URL = "https://script.google.test/exec";
      process.env.DRIVE_BACKUP_SECRET = "drive-secret";
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          calls.push(url);
          return url.startsWith("https://supabase.test/")
            ? new Response("Bucket not found", { status: 404 })
            : new Response("<html>Script error</html>", { status: 200 });
        }),
      );

      const res = await nightly(request("Bearer test-cron-secret"));
      expect(res.status).toBe(500);
      expect(calls).toContain("https://script.google.test/exec");
      const { error } = (await res.json()).backup;
      expect(error).toMatch(/Bucket not found/);
      expect(error).toMatch(/Drive backup failed.*Script error/);
    });
  });

  it("reports a 500 when the backup fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bucket not found", { status: 404 })));
    const res = await nightly(request("Bearer test-cron-secret"));
    expect(res.status).toBe(500);
    expect((await res.json()).backup.error).toMatch(/Bucket not found/);
  });
});

describe("toCsv", () => {
  it("quotes fields and escapes quotes, commas, and newlines", () => {
    expect(toCsv([{ a: 'say "hi"', b: "x,y", c: "line\nbreak", d: null }])).toBe(
      '"a","b","c","d"\n"say ""hi""","x,y","line\nbreak",\n',
    );
    expect(toCsv([{ 'Build, "phase 1"': 1 }])).toBe('"Build, ""phase 1"""\n"1"\n');
  });
});
