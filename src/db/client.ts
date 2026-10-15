import "server-only";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. See the comments in .env.local.");
}

// The Supabase transaction pooler (port 6543) does not support prepared
// statements. idle_timeout closes unused connections so dev hot reloads
// and idle serverless instances don't hold pooler slots open.
export const sql = postgres(url, {
  prepare: false,
  idle_timeout: 20,
});
