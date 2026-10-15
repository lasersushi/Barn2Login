import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export const TEST_DB_PORT = 54329;

// Builds a fresh database from supabase/migrations, in order, exactly as
// `supabase db push` would apply them.
export default async function setup() {
  const db = await PGlite.create();
  // Roles Supabase provides that the migrations revoke privileges from.
  await db.exec("create role anon; create role authenticated;");
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    await db.exec(readFileSync(new URL(file, dir), "utf8"));
  }

  const server = new PGLiteSocketServer({ db, port: TEST_DB_PORT, host: "127.0.0.1" });
  await server.start();

  return async () => {
    await server.stop();
    await db.close();
  };
}
