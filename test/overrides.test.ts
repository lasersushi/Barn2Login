import { describe, expect, it } from "vitest";
import { overrideRecordSession, overrideSignIn } from "@/db/overrides";
import { issueRedeemCode } from "@/db/codes";
import { PHONE_QR_PREFIX, redeemForPhoneQr } from "@/db/phone-qr";
import { scanMemberToken } from "@/db/sessions";
import { sql } from "./db-client";

async function addMember(fields: { active?: boolean; gradYear?: number | null } = {}) {
  const [m] = await sql<{ id: string }[]>`
    insert into members (first_name, last_name, grad_year, active)
    values ('Ada', 'Lovelace', ${fields.gradYear === undefined ? 2028 : fields.gradYear}, ${fields.active ?? true})
    returning id
  `;
  return m.id;
}

const mentor = () => addMember({ gradYear: null });

async function sessionsFor(memberId: string) {
  return sql`
    select check_in_at, check_out_at, source, closed_by, created_by, flags, note
    from sessions where member_id = ${memberId} order by check_in_at
  `;
}

describe("overrideSignIn", () => {
  it("opens a session now, recorded as the mentor's and flagged", async () => {
    const [memberId, mentorId] = [await addMember(), await mentor()];
    expect(await overrideSignIn({ memberId, mentorId, note: "phone died" })).toEqual({ ok: true });

    const [s] = await sessionsFor(memberId);
    expect(s).toMatchObject({
      source: "admin",
      created_by: mentorId,
      flags: ["admin_override"],
      note: "phone died",
      check_out_at: null,
    });
  });

  it("refuses if they're already signed in", async () => {
    const [memberId, mentorId] = [await addMember(), await mentor()];
    await overrideSignIn({ memberId, mentorId, note: null });
    expect(await overrideSignIn({ memberId, mentorId, note: null })).toEqual({
      ok: false,
      reason: "already_signed_in",
    });
    expect(await sessionsFor(memberId)).toHaveLength(1);
  });

  it("refuses an inactive member", async () => {
    const memberId = await addMember({ active: false });
    expect(await overrideSignIn({ memberId, mentorId: await mentor(), note: null })).toEqual({
      ok: false,
      reason: "inactive",
    });
  });

  it("is signed out by their next scan, like any session", async () => {
    const [memberId, mentorId] = [await addMember(), await mentor()];
    await overrideSignIn({ memberId, mentorId, note: null });
    const { token } = await issueRedeemCode(memberId);
    const qr = await redeemForPhoneQr(token);
    if (!qr.ok) throw new Error("redeem failed");
    // Past the one-minute repeat window.
    await sql`update sessions set check_in_at = check_in_at - interval '2 hours'`;
    const scanned = await scanMemberToken("phone", qr.qrText.slice(PHONE_QR_PREFIX.length));
    expect(scanned).toMatchObject({ ok: true, action: "check_out" });
  });
});

describe("overrideRecordSession", () => {
  const past = { date: "2026-10-01", note: null };

  it("records a closed session from Pacific times, flagged and attributed", async () => {
    const [memberId, mentorId] = [await addMember(), await mentor()];
    const result = await overrideRecordSession({ memberId, mentorId, ...past, start: "16:00", end: "18:30" });
    expect(result).toEqual({ ok: true });

    const [s] = await sessionsFor(memberId);
    // October 1 is PDT, UTC-7.
    expect(s.check_in_at.toISOString()).toBe("2026-10-01T23:00:00.000Z");
    expect(s.check_out_at.toISOString()).toBe("2026-10-02T01:30:00.000Z");
    expect(s).toMatchObject({ source: "admin", closed_by: "admin", created_by: mentorId, flags: ["admin_override"] });

    const [hours] = await sql`select round(total_minutes) as m from member_hours where member_id = ${memberId}`;
    expect(Number(hours.m)).toBe(150);
  });

  it("rejects an end before the start", async () => {
    const [memberId, mentorId] = [await addMember(), await mentor()];
    expect(await overrideRecordSession({ memberId, mentorId, ...past, start: "18:00", end: "16:00" })).toEqual({
      ok: false,
      reason: "end_before_start",
    });
  });

  it("rejects a session that hasn't ended yet", async () => {
    const [memberId, mentorId] = [await addMember(), await mentor()];
    const result = await overrideRecordSession({ memberId, mentorId, date: "2099-01-01", start: "16:00", end: "18:00", note: null });
    expect(result).toEqual({ ok: false, reason: "in_future" });
  });

  it("rejects overlapping an existing session, but allows back-to-back", async () => {
    const [memberId, mentorId] = [await addMember(), await mentor()];
    await overrideRecordSession({ memberId, mentorId, ...past, start: "16:00", end: "18:00" });

    expect(await overrideRecordSession({ memberId, mentorId, ...past, start: "17:00", end: "19:00" })).toEqual({
      ok: false,
      reason: "overlap",
    });
    expect(await overrideRecordSession({ memberId, mentorId, ...past, start: "18:00", end: "19:00" })).toEqual({
      ok: true,
    });
    expect(await sessionsFor(memberId)).toHaveLength(2);
  });

  it("treats a still-open session as running until now", async () => {
    const [memberId, mentorId] = [await addMember(), await mentor()];
    await sql`insert into sessions (member_id, check_in_at, source) values (${memberId}, '2026-10-01T20:00:00Z', 'qr')`;
    expect(await overrideRecordSession({ memberId, mentorId, ...past, start: "16:00", end: "18:00" })).toEqual({
      ok: false,
      reason: "overlap",
    });
  });
});
