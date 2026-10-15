// Stands in for src/db/client.ts under Vitest. See vitest.config.mts.
import postgres from "postgres";

export const sql = postgres({
  host: "127.0.0.1",
  port: 54329,
  user: "postgres",
  database: "postgres",
  prepare: false,
  max: 1,
});
