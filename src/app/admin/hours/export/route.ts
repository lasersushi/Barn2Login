import { hoursSummary, pacificToday } from "@/db/hours";
import { requireAdmin } from "@/lib/auth";
import { hoursWorkbook } from "@/lib/xlsx";

// The "Export .xlsx" link on /admin/hours. Everyone, all time plus one
// column per period, regardless of which period tab is open.
export async function GET() {
  await requireAdmin();
  const [file, day] = await Promise.all([hoursSummary().then(hoursWorkbook), pacificToday()]);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="barn2-hours-${day}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
