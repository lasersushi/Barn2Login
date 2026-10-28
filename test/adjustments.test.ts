import { describe, expect, it } from "vitest";
import { listAdjustments, removeHours } from "@/db/adjustments";
import { sql } from "./db-client";

async function addMember(firstName = "Ada", lastName = "Lovelace", active = true) {
  const [m] = await sql<{ id: string }[]>`
    insert into members (first_name, last_name, active)
    values (${firstName}, ${lastName}, ${active})
    returning id
  `;
  return m.id;
}

// A closed session of the given length, ending now.
async function addHours(memberId: string, minutes: number) {
  await sql`
    insert into sessions (member_id, check_in_at, check_out_at, source, closed_by)
    values (${memberId}, now() - make_interval(mins => ${minutes}), now(), 'qr', 'tap')
  `;
}

async function totalMinutes(memberId: string) {
  const [row] = await sql`select round(total_minutes) as m from member_hours where member_id = ${memberId}`;
  return Number(row.m);
}

describe("removeHours", () => {
  it("takes hours off the total with an adjustment, leaving sessions alone", async () => {
    const memberId = await addMember();
    const mentorId = await addMember("Grace", "Hopper");
    await addHours(memberId, 180);
    const [before] = await sql`select check_in_at, check_out_at from sessions`;

    const result = await removeHours({ memberId, minutes: 90, reason: "left early", mentorId });
    expect(result).toEqual({ ok: true });
    expect(await totalMinutes(memberId)).toBe(90);

    const [after] = await sql`select check_in_at, check_out_at from sessions`;
    expect(after).toEqual(before);
    expect(await listAdjustments()).toMatchObject([
      { member_name: "Ada Lovelace", delta_min: -90, reason: "left early", mentor_name: "Grace Hopper" },
    ]);
  });

  it("won't take anyone below zero", async () => {
    const memberId = await addMember();
    const mentorId = await addMember("Grace", "Hopper");
    await addHours(memberId, 60);

    expect(await removeHours({ memberId, minutes: 61, reason: "x", mentorId })).toEqual({
      ok: false,
      reason: "more_than_total",
    });
    expect(await removeHours({ memberId, minutes: 60, reason: "x", mentorId })).toEqual({ ok: true });
    expect(await totalMinutes(memberId)).toBe(0);
    expect(await removeHours({ memberId, minutes: 1, reason: "x", mentorId })).toMatchObject({ ok: false });
  });

  it("works for inactive members, whose hours still count", async () => {
    const memberId = await addMember("Ada", "Lovelace", false);
    const mentorId = await addMember("Grace", "Hopper");
    await addHours(memberId, 60);
    expect(await removeHours({ memberId, minutes: 30, reason: "x", mentorId })).toEqual({ ok: true });
  });

  it("rejects an unknown member", async () => {
    const mentorId = await addMember("Grace", "Hopper");
    const result = await removeHours({
      memberId: "00000000-0000-0000-0000-000000000000",
      minutes: 30,
      reason: "x",
      mentorId,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});
