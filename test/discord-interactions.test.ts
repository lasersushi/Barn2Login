import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/discord/interactions/route";

// A real Ed25519 keypair standing in for Discord's. Verification runs for real.
let privateKey: KeyObject;

beforeAll(() => {
  const pair = generateKeyPairSync("ed25519");
  privateKey = pair.privateKey;
  // Discord's dashboard shows the public key as 32 raw bytes in hex.
  const raw = pair.publicKey.export({ format: "jwk" }).x!;
  process.env.DISCORD_PUBLIC_KEY = Buffer.from(raw, "base64url").toString("hex");
});

function signedRequest(body: string, opts: { tamper?: boolean } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
  return new Request("http://localhost/api/discord/interactions", {
    method: "POST",
    headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
    body: opts.tamper ? body.replace("1", "2") : body,
  });
}

describe("POST /api/discord/interactions", () => {
  it("answers a signed PING with PONG", async () => {
    const res = await POST(signedRequest(JSON.stringify({ type: 1 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it("rejects a body that doesn't match its signature", async () => {
    const res = await POST(signedRequest(JSON.stringify({ type: 1 }), { tamper: true }));
    expect(res.status).toBe(401);
  });

  it("rejects a request with no signature headers", async () => {
    const res = await POST(
      new Request("http://localhost/api/discord/interactions", {
        method: "POST",
        body: JSON.stringify({ type: 1 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a signature made with a different key", async () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const body = JSON.stringify({ type: 1 });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await POST(
      new Request("http://localhost/api/discord/interactions", {
        method: "POST",
        headers: {
          "x-signature-ed25519": sign(null, Buffer.from(timestamp + body), other).toString("hex"),
          "x-signature-timestamp": timestamp,
        },
        body,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("replies to /ping ephemerally", async () => {
    const body = JSON.stringify({ id: "1", type: 2, token: "t", data: { name: "ping" } });
    const res = await POST(signedRequest(body));
    expect(await res.json()).toEqual({
      type: 4,
      data: { content: "Pong!", flags: 64 },
    });
  });
});
