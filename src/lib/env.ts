import "server-only";

// Read at call time, not import time, so a missing variable fails the one
// request that needs it with a clear message instead of crashing the build.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local and to Vercel.`);
  }
  return value;
}
