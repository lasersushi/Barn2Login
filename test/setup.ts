import { afterAll, beforeEach } from "vitest";
import { sql } from "./db-client";

beforeEach(async () => {
  await sql`truncate members, meetings, sessions, adjustments, pending_codes cascade`;
});

// Release the single PGlite connection for the next test file.
afterAll(async () => {
  await sql.end();
});
