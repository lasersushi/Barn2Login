import ExcelJS from "exceljs";
import { periodColumn, type HoursSummary } from "@/db/hours";

// The same table as the nightly hours.csv, but hours are stored as numbers
// (shown to one decimal, like the site) so mentors can sum and sort them.
export async function hoursWorkbook({ periods, rows }: HoursSummary): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hours", { views: [{ state: "frozen", ySplit: 1 }] });

  const hours = { style: { numFmt: "0.0" } };
  sheet.columns = [
    { header: "First name", key: "first", width: 16 },
    { header: "Last name", key: "last", width: 18 },
    { header: "Status", key: "status", width: 10 },
    { header: "All time (hours)", key: "all", width: 16, ...hours },
    ...periods.map((p, i) => ({ header: periodColumn(p), key: `p${i}`, width: 22, ...hours })),
  ];

  for (const { member: m, periodMinutes } of rows) {
    sheet.addRow({
      first: m.first_name,
      last: m.last_name,
      status: m.active ? "Active" : "Inactive",
      all: m.minutes / 60,
      ...Object.fromEntries(periodMinutes.map((min, i) => [`p${i}`, min / 60])),
    });
  }

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: "top" };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
