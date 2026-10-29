// One-time reset before launch: deletes every roster entry and everything
// attached to it (sessions, adjustments, sign-in codes, periods), so the
// roster can start over from Discord roles.
//
// This is the one exception to "never DELETE from sessions" (CLAUDE.md #2).
// It's for wiping test data before real use, never for corrections.
// The nightly backups in Storage still hold the old data.
//
// Dry run (counts only): pnpm roster:reset
// Delete for real:       pnpm roster:reset --yes

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}

// The Supabase transaction pooler doesn't support prepared statements.
const sql = postgres(url, { prepare: false, max: 1 });

// Children first: each of these references members.
const TABLES = ["pending_codes", "adjustments", "sessions", "periods", "members"] as const;

try {
  for (const table of TABLES) {
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from ${sql(table)}`;
    console.log(`${table.padEnd(14)} ${count} row(s)`);
  }

  if (!process.argv.includes("--yes")) {
    console.log("\nDry run: nothing was deleted. Re-run with --yes to delete all of the above.");
  } else {
    await sql.begin(async (tx) => {
      for (const table of TABLES) await tx`delete from ${tx(table)}`;
    });
    console.log("\nDeleted. The roster refills from Discord the next time /admin is opened or someone runs /my-qr.");
  }
} finally {
  await sql.end();
}
