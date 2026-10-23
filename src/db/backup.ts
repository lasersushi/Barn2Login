import "server-only";
import { db } from "@/db/client";
import { requireEnv } from "@/lib/env";
import { toCsv } from "@/lib/csv";

// Supabase's free tier has no automated backups, and these hours are a
// graduation requirement (Design.md §8). Each night writes the source records
// to a private Storage bucket, one folder per day. Timestamps are UTC ISO.
const BUCKET = "backups";

export async function exportBackups(): Promise<string[]> {
  const [{ day }] = await db()<{ day: string }[]>`
    select to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD') as day
  `;
  const tables: Record<string, Record<string, unknown>[]> = {
    // Everything except token_hash: credentials don't belong in a backup.
    "members.csv": await db()`
      select id, first_name, last_name, grad_year, subteam, discord_id, photo_url, active, created_at
      from members order by created_at
    `,
    "sessions.csv": await db()`select * from sessions order by check_in_at`,
    "adjustments.csv": await db()`select * from adjustments order by created_at`,
  };

  const written: string[] = [];
  for (const [file, rows] of Object.entries(tables)) {
    const path = `${day}/${file}`;
    await upload(path, toCsv(rows));
    written.push(path);
  }
  return written;
}

async function upload(path: string, body: string): Promise<void> {
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
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
}
