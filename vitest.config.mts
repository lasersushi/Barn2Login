import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Tests talk to an in-memory Postgres (PGlite) built from the real
      // migrations, never to Supabase. See test/global-setup.ts.
      { find: "@/db/client", replacement: path("./test/db-client.ts") },
      { find: "@", replacement: path("./src") },
      // server-only throws outside Next's server bundle; tests run in plain Node.
      { find: "server-only", replacement: path("./test/server-only-stub.ts") },
    ],
  },
  test: {
    globalSetup: "./test/global-setup.ts",
    setupFiles: ["./test/setup.ts"],
    // PGlite is a single database process; one test file at a time.
    fileParallelism: false,
    env: {
      SESSION_SECRET: "test-session-secret",
      KIOSK_SECRET: "test-kiosk-secret",
      APP_BASE_URL: "https://barn2.test",
      ADMIN_DISCORD_IDS: "mentor-1",
      CRON_SECRET: "test-cron-secret",
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    },
  },
});
