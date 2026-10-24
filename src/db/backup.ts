import "server-only";
import { db } from "@/db/client";
import { hoursByMember, listPeriods } from "@/db/hours";
import { requireEnv } from "@/lib/env";
import { toCsv } from "@/lib/csv";
import { formatHours } from "@/lib/time";

// Supabase's free tier has no automated backups, and these hours are a
// graduation requirement (Design.md §8). Each night writes the source records
// as CSV to two places, one folder per day:
//   - a private Supabase Storage bucket, next to the database
//   - a Google Drive folder, so a copy survives losing the Supabase account
//     and can be opened by anyone with no tools beyond Google Sheets
// Timestamps are UTC ISO. hours.csv is the readable summary; the other files
// are what a restore would load.
const BUCKET = "backups";

type Backup = { day: string; files: Record<string, string> };

export async function exportBackups(): Promise<{ storage: string[]; drive: string }> {
  const backup = await buildBackup();

  // Both destinations are attempted even if the first fails.
  const errors: string[] = [];
  let storage: string[] = [];
  let drive = "not configured";
  try {
    storage = await uploadToStorage(backup);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  if (process.env.DRIVE_BACKUP_URL) {
    try {
      drive = await uploadToDrive(backup);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (errors.length > 0) throw new Error(errors.join(" "));
  return { storage, drive };
}

async function buildBackup(): Promise<Backup> {
  const [{ day }] = await db()<{ day: string }[]>`
    select to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD') as day
  `;
  const tables: Record<string, Record<string, unknown>[]> = {
    "hours.csv": await hoursSummary(),
    // Everything except token_hash: credentials don't belong in a backup.
    "members.csv": await db()`
      select id, first_name, last_name, grad_year, subteam, discord_id, photo_url, active, created_at
      from members order by created_at
    `,
    "sessions.csv": await db()`select * from sessions order by check_in_at`,
    "adjustments.csv": await db()`select * from adjustments order by created_at`,
    "periods.csv": await db()`select * from periods order by starts_on`,
  };
  const files = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, toCsv(rows)]));
  return { day, files };
}

// One row per person, one column per period, in hours. Same numbers as
// /admin/hours. Headers are written for a person opening it in Sheets.
async function hoursSummary(): Promise<Record<string, unknown>[]> {
  const periods = await listPeriods();
  const allTime = await hoursByMember(null);
  const byPeriod = await Promise.all(
    periods.map(async (p) => {
      const rows = await hoursByMember({ startsOn: p.starts_on, endsOn: p.ends_on });
      return new Map(rows.map((r) => [r.id, r.minutes]));
    }),
  );
  return allTime.map((m) => ({
    "First name": m.first_name,
    "Last name": m.last_name,
    Status: m.active ? "Active" : "Inactive",
    "All time (hours)": formatHours(m.minutes),
    ...Object.fromEntries(
      periods.map((p, i) => [
        `${p.name}, ${p.starts_on} to ${p.ends_on} (hours)`,
        formatHours(byPeriod[i].get(m.id) ?? 0),
      ]),
    ),
  }));
}

async function uploadToStorage({ day, files }: Backup): Promise<string[]> {
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const written: string[] = [];
  for (const [file, body] of Object.entries(files)) {
    const path = `${day}/${file}`;
    const res = await fetch(`${requireEnv("SUPABASE_URL")}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "text/csv",
        "x-upsert": "true",
      },
      body,
    });
    if (!res.ok) {
      throw new Error(
        `Storage upload of ${path} failed (${res.status}): ${await res.text()}. ` +
          `Does a private bucket named "${BUCKET}" exist?`,
      );
    }
    written.push(path);
  }
  return written;
}

// Posts the files to the Apps Script in scripts/drive-backup.gs, which runs
// as the Drive folder's owner and writes them there. Apps Script can't read
// request headers, so the shared secret travels in the body.
async function uploadToDrive({ day, files }: Backup): Promise<string> {
  const res = await fetch(requireEnv("DRIVE_BACKUP_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: requireEnv("DRIVE_BACKUP_SECRET"), day, files }),
  });
  const text = await res.text();
  let reply: { ok?: boolean; error?: string } = {};
  try {
    reply = JSON.parse(text);
  } catch {
    // Apps Script answers script errors with an HTML page.
  }
  if (!res.ok || !reply.ok) {
    throw new Error(`Drive backup failed (${res.status}): ${reply.error ?? text.slice(0, 200)}`);
  }
  return `${day}/ (${Object.keys(files).length} files)`;
}
