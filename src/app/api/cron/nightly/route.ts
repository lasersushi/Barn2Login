import { db } from "@/db/client";
import { exportBackups } from "@/db/backup";
import { sendCompReminders } from "@/discord/reminders";
import { safeEqual } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";

// Runs once a day from Vercel Cron (vercel.json). Vercel sends
// "Authorization: Bearer $CRON_SECRET"; anything else is rejected.
// Each job runs even if an earlier one fails, and any failure makes the
// response a 500 so it shows up in Vercel's cron logs.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${requireEnv("CRON_SECRET")}`)) {
    return new Response("unauthorized", { status: 401 });
  }

  const results: Record<string, unknown> = {};
  let failed = false;

  async function run(name: string, job: () => Promise<unknown>) {
    try {
      results[name] = await job();
    } catch (e) {
      failed = true;
      results[name] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Any query counts as activity, which keeps the free Supabase project
  // from pausing after 7 days idle (Design.md §8), e.g. over the summer.
  await run("heartbeat", async () => (await db()`select now() as at`)[0].at);
  await run("backup", exportBackups);
  await run("reminders", sendCompReminders);

  return Response.json(results, { status: failed ? 500 : 200 });
}
