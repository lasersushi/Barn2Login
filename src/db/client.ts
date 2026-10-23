import "server-only";
import postgres from "postgres";
import { requireEnv } from "@/lib/env";

let client: postgres.Sql | undefined;

// Created on first use, not at import. `next build` imports every route to
// collect page data and must not need database credentials to do that.
//
// The Supabase transaction pooler (port 6543) does not support prepared
// statements. idle_timeout closes unused connections so dev hot reloads
// and idle serverless instances don't hold pooler slots open.
export function db(): postgres.Sql {
  client ??= postgres(requireEnv("DATABASE_URL"), {
    prepare: false,
    idle_timeout: 20,
  });
  return client;
}
