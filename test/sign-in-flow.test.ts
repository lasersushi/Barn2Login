import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as scanRoute } from "@/app/api/scan/route";
import { issueRedeemCode, redeemForQr } from "@/db/codes";
import { scanQr } from "@/db/sessions";
import { handleCommand } from "@/discord/commands";
import { sql } from "./db-client";

async function addMember(fields: { discordId?: string; active?: boolean } = {}) {
  const [m] = await sql<{ id: string }[]>`
    insert into members (first_name, last_name, grad_year, discord_id, active)
    values ('Ada', 'Lovelace', 2028, ${fields.discordId ?? null}, ${fields.active ?? true})
    returning id
  `;
  return m.id;
}

async function qrFor(memberId: string): Promise<string> {
  const { token } = await issueRedeemCode(memberId);
  const result = await redeemForQr(token, "203.0.113.7");
  if (!result.ok) throw new Error("redeem failed");
  return result.token;
}

describe("redeem link → QR", () => {
  it("issues a QR and logs the IP, storing only hashes", async () => {
    const memberId = await addMember();
    const { token } = await issueRedeemCode(memberId);
    const result = await redeemForQr(token, "203.0.113.7");
    expect(result).toMatchObject({ ok: true, firstName: "Ada" });

    const rows = await sql<{ kind: string; code_hash: string; ip_address: string | null }[]>`
      select kind, code_hash, host(ip_address) as ip_address from pending_codes order by created_at, kind
    `;
    expect(rows.map((r) => r.kind).sort()).toEqual(["qr", "redeem"]);
    expect(rows.find((r) => r.kind === "qr")?.ip_address).toBe("203.0.113.7");
    // Invariant #5: the raw tokens never touch the database.
    for (const r of rows) expect([token, result.ok && result.token]).not.toContain(r.code_hash);
  });

  it("works only once", async () => {
    const { token } = await issueRedeemCode(await addMember());
    expect((await redeemForQr(token, null)).ok).toBe(true);
    expect((await redeemForQr(token, null)).ok).toBe(false);
  });

  it("refuses an expired link", async () => {
    const { token } = await issueRedeemCode(await addMember());
    await sql`update pending_codes set expires_at = now() - interval '1 second'`;
    expect((await redeemForQr(token, null)).ok).toBe(false);
  });

  it("refuses a deactivated member", async () => {
    const memberId = await addMember();
    const { token } = await issueRedeemCode(memberId);
    await sql`update members set active = false where id = ${memberId}`;
    expect((await redeemForQr(token, null)).ok).toBe(false);
  });
});

describe("kiosk scan", () => {
  it("checks in, then checks out on the next code", async () => {
    const memberId = await addMember();

    const first = await scanQr(await qrFor(memberId));
    expect(first).toMatchObject({ ok: true, action: "check_in" });

    const second = await scanQr(await qrFor(memberId));
    expect(second).toMatchObject({ ok: true, action: "check_out" });

    const sessions = await sql`select source, closed_by, check_out_at from sessions`;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ source: "qr", closed_by: "tap" });
    expect(sessions[0].check_out_at).not.toBeNull();
  });

  it("won't accept the same QR twice", async () => {
    const qr = await qrFor(await addMember());
    expect((await scanQr(qr)).ok).toBe(true);
    expect(await scanQr(qr)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an unknown token", async () => {
    expect(await scanQr("not-a-real-token")).toEqual({ ok: false, reason: "invalid" });
  });

  it("attaches the check-in to the meeting happening now", async () => {
    const [meeting] = await sql<{ id: string }[]>`
      insert into meetings (starts_at, ends_at)
      values (now() - interval '30 minutes', now() + interval '2 hours')
      returning id
    `;
    await scanQr(await qrFor(await addMember()));
    const [session] = await sql`select meeting_id from sessions`;
    expect(session.meeting_id).toBe(meeting.id);
  });

  it("counts hours through member_hours once the session closes", async () => {
    const memberId = await addMember();
    await scanQr(await qrFor(memberId));
    await sql`update sessions set check_in_at = check_in_at - interval '90 minutes'`;
    await scanQr(await qrFor(memberId));
    const [hours] = await sql`select round(total_minutes) as m from member_hours where member_id = ${memberId}`;
    expect(Number(hours.m)).toBe(90);
  });
});

describe("POST /api/scan", () => {
  function scanRequest(token: string, cookie?: string) {
    return new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ token }),
    });
  }
  const kioskCookie = `b2_kiosk=${createHmac("sha256", "test-session-secret")
    .update("kiosk:test-kiosk-secret")
    .digest("base64url")}`;

  it("rejects a device without the kiosk cookie", async () => {
    const qr = await qrFor(await addMember());
    expect((await scanRoute(scanRequest(qr))).status).toBe(401);
    expect((await scanRoute(scanRequest(qr, "b2_kiosk=forged"))).status).toBe(401);
    // The rejected attempts didn't burn the code.
    expect((await scanQr(qr)).ok).toBe(true);
  });

  it("returns the member's name for the kiosk", async () => {
    const qr = await qrFor(await addMember());
    const res = await scanRoute(scanRequest(qr, kioskCookie));
    expect(await res.json()).toMatchObject({ ok: true, action: "check_in", name: "Ada Lovelace" });
  });
});

describe("/sign-in command", () => {
  const interaction = (discordId: string, roles: string[] | undefined, nick: string | null = "Ada Lovelace") => ({
    id: "1",
    type: 2,
    token: "t",
    data: { name: "sign-in" },
    member: { user: { id: discordId, username: "ada", global_name: null }, roles, nick },
  });

  const rowFor = async (discordId: string) =>
    (await sql`select first_name, last_name, active from members where discord_id = ${discordId}`)[0];

  it("refuses people without the member role, and doesn't add them", async () => {
    for (const roles of [undefined, [], ["role-other"]]) {
      const res = await handleCommand(interaction("nobody", roles));
      expect(res.data?.content).toMatch(/need the member role/);
    }
    expect(await rowFor("nobody")).toBeUndefined();
  });

  it("refuses in a DM, where there are no roles", async () => {
    const res = await handleCommand({
      id: "1",
      type: 2,
      token: "t",
      data: { name: "sign-in" },
      user: { id: "ada-discord", username: "ada" },
    });
    expect(res.data?.content).toMatch(/in the Barn 2 server/);
  });

  it("adds a member to the roster on their first /sign-in and sends a private one-time link", async () => {
    const res = await handleCommand(interaction("ada-discord", ["role-member"]));
    expect(res.data?.content).toMatch(/https:\/\/barn2\.test\/redeem\/[\w-]{43}/);
    expect(res.data?.flags).toBe(64 | 4);
    expect(await rowFor("ada-discord")).toEqual({ first_name: "Ada", last_name: "Lovelace", active: true });
  });

  it("lets leadership sign in without the member role", async () => {
    const res = await handleCommand(interaction("captain-discord", ["role-captain"]));
    expect(res.data?.content).toMatch(/redeem/);
  });

  it("reuses the same row, picking up a new nickname and reactivating", async () => {
    const id = await addMember({ discordId: "ada-discord", active: false });
    await handleCommand(interaction("ada-discord", ["role-member"], "Ada King"));
    expect(await rowFor("ada-discord")).toEqual({ first_name: "Ada", last_name: "King", active: true });
    expect(await sql`select id from members`).toEqual([{ id }]);
  });
});
