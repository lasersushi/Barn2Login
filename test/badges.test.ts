import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as scanRoute } from "@/app/api/scan/route";
import { BADGE_PREFIX, issueBadge, listBadgeHolders, revokeBadge } from "@/db/badges";
import { scanMemberToken } from "@/db/sessions";
import { sql } from "./db-client";

const scanBadge = (token: string) => scanMemberToken("badge", token);

async function addMember(active = true) {
  const [m] = await sql<{ id: string }[]>`
    insert into members (first_name, last_name, active)
    values ('Ada', 'Lovelace', ${active})
    returning id
  `;
  return m.id;
}

async function badgeFor(memberId: string): Promise<string> {
  const issued = await issueBadge(memberId);
  if (!issued) throw new Error("issue failed");
  return issued.qrText.slice(BADGE_PREFIX.length);
}

// Moves the member's sessions back in time, as if the scan was a while ago.
async function age(memberId: string, by: string) {
  await sql`
    update sessions
    set check_in_at = check_in_at - ${by}::interval,
        check_out_at = check_out_at - ${by}::interval
    where member_id = ${memberId}
  `;
}

describe("issueBadge", () => {
  it("stores only the hash of the token", async () => {
    const memberId = await addMember();
    const issued = await issueBadge(memberId);
    expect(issued).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
    expect(issued!.qrText.startsWith(BADGE_PREFIX)).toBe(true);

    const [row] = await sql<{ token_hash: string }[]>`select token_hash from members where id = ${memberId}`;
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued!.qrText).not.toContain(row.token_hash);
  });

  it("won't make a badge for an inactive member", async () => {
    expect(await issueBadge(await addMember(false))).toBeNull();
  });
});

describe("scanBadge", () => {
  it("checks in unflagged, then checks out on a later scan", async () => {
    const memberId = await addMember();
    const badge = await badgeFor(memberId);

    expect(await scanBadge(badge)).toMatchObject({ ok: true, action: "check_in" });
    await age(memberId, "2 hours");
    expect(await scanBadge(badge)).toMatchObject({ ok: true, action: "check_out" });

    const sessions = await sql`select source, closed_by, flags, ip_status from sessions`;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ source: "qr", closed_by: "tap", flags: [], ip_status: null });
  });

  it("ignores the same badge again within a minute", async () => {
    const memberId = await addMember();
    const badge = await badgeFor(memberId);

    await scanBadge(badge);
    expect(await scanBadge(badge)).toEqual({ ok: false, reason: "repeat" });
    const [s] = await sql`select check_out_at from sessions`;
    expect(s.check_out_at).toBeNull();

    // Checking out starts the same one-minute window.
    await age(memberId, "2 hours");
    expect(await scanBadge(badge)).toMatchObject({ ok: true, action: "check_out" });
    expect(await scanBadge(badge)).toEqual({ ok: false, reason: "repeat" });
  });

  it("stops working when a new badge is made or it's revoked", async () => {
    const memberId = await addMember();
    const old = await badgeFor(memberId);
    const current = await badgeFor(memberId);
    expect(await scanBadge(old)).toEqual({ ok: false, reason: "invalid_badge" });
    expect((await scanBadge(current)).ok).toBe(true);

    await revokeBadge(memberId);
    expect(await listBadgeHolders()).toEqual([]);
    await age(memberId, "2 hours");
    expect(await scanBadge(current)).toEqual({ ok: false, reason: "invalid_badge" });
  });

  it("rejects a badge for someone who lost the member role", async () => {
    const memberId = await addMember();
    const badge = await badgeFor(memberId);
    await sql`update members set active = false where id = ${memberId}`;
    expect(await scanBadge(badge)).toEqual({ ok: false, reason: "inactive" });
  });
});

describe("POST /api/scan with a badge", () => {
  const kioskCookie = `b2_kiosk=${createHmac("sha256", "test-session-secret")
    .update("kiosk:test-kiosk-secret")
    .digest("base64url")}`;

  function scanRequest(token: string) {
    return new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: kioskCookie },
      body: JSON.stringify({ token }),
    });
  }

  it("recognizes the badge prefix", async () => {
    const issued = await issueBadge(await addMember());
    const res = await scanRoute(scanRequest(issued!.qrText));
    expect(await res.json()).toMatchObject({ ok: true, action: "check_in", name: "Ada Lovelace" });
  });

  it("says a revoked badge needs replacing", async () => {
    const memberId = await addMember();
    const issued = await issueBadge(memberId);
    await revokeBadge(memberId);
    const body = await (await scanRoute(scanRequest(issued!.qrText))).json();
    expect(body).toMatchObject({ ok: false, message: expect.stringContaining("badge no longer works") });
  });
});
