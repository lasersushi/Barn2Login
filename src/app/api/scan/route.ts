import { BADGE_PREFIX } from "@/db/badges";
import { PHONE_QR_PREFIX } from "@/db/phone-qr";
import { scanMemberToken } from "@/db/sessions";
import { isKioskRequest } from "@/lib/auth";
import { formatDuration, formatTime } from "@/lib/time";

const MESSAGES = {
  invalid: "This QR code doesn't work anymore. Run /my-qr in Discord for your permanent one.",
  invalid_badge: "This badge no longer works. Please see a mentor for a new one.",
  invalid_phone_qr: "This QR code was replaced. Run /my-qr in Discord for your current one.",
  inactive: "This roster entry is inactive. Please see a mentor.",
  repeat: "Got it already. Wait a minute before scanning again.",
};

// The kiosk POSTs each scanned QR's text here. Only a device holding the
// kiosk cookie may call it, so a QR has to physically reach the iPad.
export async function POST(req: Request) {
  if (!isKioskRequest(req)) {
    return Response.json({ error: "This device isn't set up as the kiosk." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof body?.token !== "string" || body.token.length === 0) {
    return Response.json({ error: "Missing token." }, { status: 400 });
  }

  // Anything without a known prefix is an old one-time QR or not ours.
  const token = body.token;
  const result = token.startsWith(BADGE_PREFIX)
    ? await scanMemberToken("badge", token.slice(BADGE_PREFIX.length))
    : token.startsWith(PHONE_QR_PREFIX)
      ? await scanMemberToken("phone", token.slice(PHONE_QR_PREFIX.length))
      : ({ ok: false, reason: "invalid" } as const);
  if (!result.ok) {
    return Response.json({ ok: false, message: MESSAGES[result.reason] });
  }

  const name = `${result.member.first_name} ${result.member.last_name}`;
  // The kiosk says the first name out loud.
  const firstName = result.member.first_name;
  const photoUrl = result.member.photo_url;

  if (result.action === "check_in") {
    return Response.json({
      ok: true,
      action: "check_in",
      name,
      firstName,
      photoUrl,
      detail: `Signed in at ${formatTime(result.checkInAt)}`,
    });
  }

  return Response.json({
    ok: true,
    action: "check_out",
    name,
    firstName,
    photoUrl,
    detail: `Signed out at ${formatTime(result.checkOutAt)} · ${formatDuration(result.checkInAt, result.checkOutAt)} today`,
  });
}
