// Minimal RFC 4180 CSV: quote every field, double any quotes inside.
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join(";") : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))].join("\n") + "\n";
}
