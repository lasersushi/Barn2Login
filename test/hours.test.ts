import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createPeriod, deletePeriod, hoursByMember, hoursSummary, listPeriods } from "@/db/hours";
import { hoursWorkbook } from "@/lib/xlsx";
import { formatCalendarDate, formatHours } from "@/lib/time";
import { sql } from "./db-client";

async function addMember(first = "Ada", gradYear: number | null = 2028) {
  const [m] = await sql<{ id: string }[]>`
    insert into members (first_name, last_name, grad_year)
    values (${first}, 'Lovelace', ${gradYear})
    returning id
  `;
  return m.id;
}

// Times are written with an explicit offset; October 2026 is PDT (-07).
async function addSession(memberId: string, checkIn: string, checkOut: string | null) {
  await sql`
    insert into sessions (member_id, check_in_at, check_out_at, source, closed_by)
    values (${memberId}, ${checkIn}, ${checkOut}, 'qr', ${checkOut ? "tap" : null})
  `;
}

async function addAdjustment(memberId: string, deltaMin: number, createdAt: string) {
  const mentor = await addMember("Mentor", null);
  await sql`
    insert into adjustments (member_id, delta_min, reason, created_by, created_at)
    values (${memberId}, ${deltaMin}, 'test', ${mentor}, ${createdAt})
  `;
}

const hoursOf = (rows: Awaited<ReturnType<typeof hoursByMember>>, id: string) => rows.find((r) => r.id === id);

describe("hoursByMember", () => {
  it("all time matches the member_hours view", async () => {
    const a = await addMember("Ada");
    const b = await addMember("Grace");
    await addSession(a, "2026-10-01 16:00-07", "2026-10-01 18:30-07");
    await addSession(a, "2026-10-02 16:00-07", "2026-10-02 17:10-07");
    await addSession(b, "2026-10-03 16:00-07", "2026-10-03 16:45-07");
    await addAdjustment(b, 60, "2026-10-04 12:00-07");

    const rows = await hoursByMember(null);
    const view = await sql<{ member_id: string; total_minutes: string }[]>`select * from member_hours`;
    for (const v of view) {
      expect(hoursOf(rows, v.member_id)?.minutes).toBe(Math.round(Number(v.total_minutes)));
    }
    expect(hoursOf(rows, a)).toMatchObject({ minutes: 220, sessions: 2 });
    expect(hoursOf(rows, b)).toMatchObject({ minutes: 105, sessions: 1 });
  });

  it("ignores open sessions until they're closed", async () => {
    const a = await addMember();
    await addSession(a, "2026-10-01 16:00-07", null);
    expect(hoursOf(await hoursByMember(null), a)).toMatchObject({ minutes: 0, sessions: 0 });
  });

  it("lists members with no sessions at zero", async () => {
    const a = await addMember();
    expect(hoursOf(await hoursByMember({ startsOn: "2026-10-01", endsOn: "2026-10-31" }), a)).toMatchObject({
      minutes: 0,
      sessions: 0,
    });
  });

  it("uses Pacific days, inclusive on both ends", async () => {
    const a = await addMember();
    // 11:30 PM the night before: 06:30 UTC on Oct 1, but Sept 30 in Pacific.
    await addSession(a, "2026-09-30 23:30-07", "2026-10-01 00:30-07");
    // First minute of the first day.
    await addSession(a, "2026-10-01 00:00-07", "2026-10-01 00:10-07");
    // 11:30 PM on the last day: already Nov 1 in UTC.
    await addSession(a, "2026-10-31 23:30-07", "2026-11-01 00:00-07");
    // The day after.
    await addSession(a, "2026-11-01 16:00-07", "2026-11-01 17:00-07");

    const rows = await hoursByMember({ startsOn: "2026-10-01", endsOn: "2026-10-31" });
    expect(hoursOf(rows, a)).toMatchObject({ minutes: 40, sessions: 2 });
  });

  it("counts adjustments by the day they were entered", async () => {
    const a = await addMember();
    await addAdjustment(a, 90, "2026-10-15 12:00-07");
    await addAdjustment(a, -30, "2026-11-02 12:00-08");

    expect(hoursOf(await hoursByMember({ startsOn: "2026-10-01", endsOn: "2026-10-31" }), a)?.minutes).toBe(90);
    expect(hoursOf(await hoursByMember({ startsOn: "2026-11-01", endsOn: "2026-11-30" }), a)?.minutes).toBe(-30);
    expect(hoursOf(await hoursByMember(null), a)?.minutes).toBe(60);
  });
});

describe("periods", () => {
  it("round-trips dates without shifting them a day", async () => {
    const createdBy = await addMember("Mentor", null);
    const id = await createPeriod({ name: "Build season", startsOn: "2027-01-10", endsOn: "2027-02-24", createdBy });
    expect(await listPeriods()).toEqual([{ id, name: "Build season", starts_on: "2027-01-10", ends_on: "2027-02-24" }]);
    expect(formatCalendarDate("2027-01-10")).toBe("Jan 10, 2027");
  });

  it("lists newest first, and deleting one leaves hours alone", async () => {
    const createdBy = await addMember("Mentor", null);
    const a = await addMember();
    await addSession(a, "2026-10-01 16:00-07", "2026-10-01 18:00-07");
    const older = await createPeriod({ name: "Preseason", startsOn: "2026-09-01", endsOn: "2026-12-31", createdBy });
    const newer = await createPeriod({ name: "Build", startsOn: "2027-01-10", endsOn: "2027-02-24", createdBy });
    expect((await listPeriods()).map((p) => p.id)).toEqual([newer, older]);

    await deletePeriod(older);
    expect((await listPeriods()).map((p) => p.id)).toEqual([newer]);
    expect(hoursOf(await hoursByMember(null), a)?.minutes).toBe(120);
  });

  it("rejects a period that ends before it starts", async () => {
    const createdBy = await addMember("Mentor", null);
    await expect(
      createPeriod({ name: "Backwards", startsOn: "2027-02-01", endsOn: "2027-01-01", createdBy }),
    ).rejects.toThrow();
  });
});

describe("formatHours", () => {
  it("shows one decimal place", () => {
    expect(formatHours(0)).toBe("0.0");
    expect(formatHours(220)).toBe("3.7");
    expect(formatHours(-30)).toBe("-0.5");
  });
});

describe("hoursWorkbook", () => {
  it("has the hours.csv columns, with hours as numbers", async () => {
    const ada = await addMember("Ada");
    await addSession(ada, "2026-10-01 16:00-07", "2026-10-01 19:40-07");
    await addSession(ada, "2026-11-05 16:00-08", "2026-11-05 17:00-08");
    await createPeriod({ name: "October", startsOn: "2026-10-01", endsOn: "2026-10-31", createdBy: ada });

    const workbook = new ExcelJS.Workbook();
    // exceljs types its own global Buffer that Node's doesn't match; at
    // runtime load() takes a Node Buffer fine.
    const file = await hoursWorkbook(await hoursSummary());
    await workbook.xlsx.load(file as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Hours")!;

    expect(sheet.getRow(1).values).toEqual([
      undefined, // exceljs rows are 1-indexed
      "First name",
      "Last name",
      "Status",
      "All time (hours)",
      "October, 2026-10-01 to 2026-10-31 (hours)",
    ]);
    const row = sheet.getRow(2);
    expect(row.getCell(1).value).toBe("Ada");
    expect(row.getCell(3).value).toBe("Active");
    expect(row.getCell(4).value).toBeCloseTo(280 / 60);
    expect(row.getCell(5).value).toBeCloseTo(220 / 60);
    expect(row.getCell(5).numFmt).toBe("0.0");
    expect(sheet.rowCount).toBe(2);
  });
});
