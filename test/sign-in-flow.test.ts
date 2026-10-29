import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as scanRoute } from "@/app/api/scan/route";
import { issueBadge } from "@/db/badges";
import { issueRedeemCode } from "@/db/codes";
import { PHONE_QR_PREFIX, redeemForPhoneQr } from "@/db/phone-qr";
import { scanMemberToken } from "@/db/sessions";
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

// The full QR text, prefix included, as the kiosk would read it.
async function phoneQrFor(memberId: string): Promise<string> {
  const { token } = await issueRedeemCode(memberId);
  const result = await redeemForPhoneQr(token);
  if (!result.ok) throw new Error("redeem failed");
  return result.qrText;
}

const scanPhone = (qrText: string) => scanMemberToken("phone", qrText.slice(PHONE_QR_PREFIX.length));

// Moves the member's sessions back in time, as if the scan was a while ago.
async function age(memberId: string, by: string) {
  await sql`
    update sessions
    set check_in_at = check_in_at - ${by}::interval,
        check_out_at = check_out_at - ${by}::interval
    where member_id = ${memberId}
  `;
}

describe("redeem link → phone QR", () => {
  it("issues a prefixed QR, storing only hashes", async () => {
    const memberId = await addMember();
    const { token } = await issueRedeemCode(memberId);
    const result = await redeemForPhoneQr(token);
    expect(result).toMatchObject({ ok: true, firstName: "Ada" });
    if (!result.ok) return;
    expect(result.qrText.startsWith(PHONE_QR_PREFIX)).toBe(true);

    // Invariant #5: the raw tokens never touch the database.
    const [member] = await sql<{ qr_token_hash: string | null }[]>`
      select qr_token_hash from members where id = ${memberId}
    `;
    const [code] = await sql<{ code_hash: string }[]>`select code_hash from pending_codes`;
    const raw = result.qrText.slice(PHONE_QR_PREFIX.length);
    expect(member.qr_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect([member.qr_token_hash, code.code_hash]).not.toContain(raw);
    expect([member.qr_token_hash, code.code_hash]).not.toContain(token);
  });

  it("works only once", async () => {
    const { token } = await issueRedeemCode(await addMember());
    expect((await redeemForPhoneQr(token)).ok).toBe(true);
    expect((await redeemForPhoneQr(token)).ok).toBe(false);
  });

  it("refuses an expired link", async () => {
    const { token } = await issueRedeemCode(await addMember());
    await sql`update pending_codes set expires_at = now() - interval '1 second'`;
    expect((await redeemForPhoneQr(token)).ok).toBe(false);
  });

  it("refuses a deactivated member", async () => {
    const memberId = await addMember();
    const { token } = await issueRedeemCode(memberId);
    await sql`update members set active = false where id = ${memberId}`;
    expect((await redeemForPhoneQr(token)).ok).toBe(false);
  });

  it("leaves the member's printed badge working", async () => {
    const memberId = await addMember();
    const badge = await issueBadge(memberId);
    await phoneQrFor(memberId);
    expect((await scanMemberToken("badge", badge!.qrText.slice("b2badge:".length))).ok).toBe(true);
  });
});

describe("kiosk scan", () => {
  it("checks in, then checks out with the same QR, unflagged", async () => {
    const memberId = await addMember();
    const qr = await phoneQrFor(memberId);

    expect(await scanPhone(qr)).toMatchObject({ ok: true, action: "check_in" });
    await age(memberId, "2 hours");
    expect(await scanPhone(qr)).toMatchObject({ ok: true, action: "check_out" });

    const sessions = await sql`select source, closed_by, check_out_at, flags, ip_status from sessions`;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ source: "qr", closed_by: "tap", flags: [], ip_status: null });
    expect(sessions[0].check_out_at).not.toBeNull();
  });

  it("ignores the same QR again within a minute", async () => {
    const memberId = await addMember();
    const qr = await phoneQrFor(memberId);
    await scanPhone(qr);
    expect(await scanPhone(qr)).toEqual({ ok: false, reason: "repeat" });
    const [s] = await sql`select check_out_at from sessions`;
    expect(s.check_out_at).toBeNull();
  });

  it("stops accepting the old QR once the member gets a new one", async () => {
    const memberId = await addMember();
    const old = await phoneQrFor(memberId);
    const current = await phoneQrFor(memberId);
    expect(await scanPhone(old)).toEqual({ ok: false, reason: "invalid_phone_qr" });
    expect((await scanPhone(current)).ok).toBe(true);
  });

  it("rejects an unknown token", async () => {
    expect(await scanMemberToken("phone", "not-a-real-token")).toEqual({ ok: false, reason: "invalid_phone_qr" });
  });

  it("rejects a member who lost the member role", async () => {
    const memberId = await addMember();
    const qr = await phoneQrFor(memberId);
    await sql`update members set active = false where id = ${memberId}`;
    expect(await scanPhone(qr)).toEqual({ ok: false, reason: "inactive" });
  });

  it("attaches the check-in to the meeting happening now", async () => {
    const [meeting] = await sql<{ id: string }[]>`
      insert into meetings (starts_at, ends_at)
      values (now() - interval '30 minutes', now() + interval '2 hours')
      returning id
    `;
    await scanPhone(await phoneQrFor(await addMember()));
    const [session] = await sql`select meeting_id from sessions`;
    expect(session.meeting_id).toBe(meeting.id);
  });

  it("counts hours through member_hours once the session closes", async () => {
    const memberId = await addMember();
    const qr = await phoneQrFor(memberId);
    await scanPhone(qr);
    await age(memberId, "90 minutes");
    await scanPhone(qr);
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
    const qr = await phoneQrFor(await addMember());
    expect((await scanRoute(scanRequest(qr))).status).toBe(401);
    expect((await scanRoute(scanRequest(qr, "b2_kiosk=forged"))).status).toBe(401);
    // The rejected attempts didn't sign anyone in.
    expect(await sql`select id from sessions`).toEqual([]);
  });

  it("returns the member's name, and first name to say out loud", async () => {
    const qr = await phoneQrFor(await addMember());
    const res = await scanRoute(scanRequest(qr, kioskCookie));
    expect(await res.json()).toMatchObject({
      ok: true,
      action: "check_in",
      name: "Ada Lovelace",
      firstName: "Ada",
    });
  });

  it("points an old one-time QR at /my-qr", async () => {
    const body = await (await scanRoute(scanRequest("an-old-unprefixed-token", kioskCookie))).json();
    expect(body).toMatchObject({ ok: false, message: expect.stringContaining("/my-qr") });
  });
});

describe("/my-qr command", () => {
  const interaction = (discordId: string, roles: string[] | undefined, nick: string | null = "Ada Lovelace") => ({
    id: "1",
    type: 2,
    token: "t",
    data: { name: "my-qr" },
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
      data: { name: "my-qr" },
      user: { id: "ada-discord", username: "ada" },
    });
    expect(res.data?.content).toMatch(/in the Barn 2 server/);
  });

  it("adds a member to the roster on their first /my-qr and sends a private one-time link", async () => {
    const res = await handleCommand(interaction("ada-discord", ["role-member"]));
    expect(res.data?.content).toMatch(/https:\/\/barn2\.test\/redeem\/[\w-]{43}/);
    expect(res.data?.flags).toBe(64 | 4);
    expect(await rowFor("ada-discord")).toEqual({ first_name: "Ada", last_name: "Lovelace", active: true });
  });

  it("lets leadership get a QR without the member role", async () => {
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
