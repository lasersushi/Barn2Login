import { scanQr } from "@/db/sessions";
import { isKioskRequest } from "@/lib/auth";
import { formatDuration, formatTime } from "@/lib/time";

const MESSAGES = {
  invalid: "That code expired or was already used. Run /sign-in in Discord for a new one.",
  inactive: "This roster entry is inactive. Please see a mentor.",
};

// The kiosk POSTs each scanned QR token here. Only a device holding the
// kiosk cookie may call it, so a QR has to physically reach the iPad.
export async function POST(req: Request) {
  if (!isKioskRequest(req)) {
    return Response.json({ error: "This device isn't set up as the kiosk." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof body?.token !== "string" || body.token.length === 0) {
    return Response.json({ error: "Missing token." }, { status: 400 });
  }

  const result = await scanQr(body.token);
  if (!result.ok) {
    return Response.json({ ok: false, message: MESSAGES[result.reason] });
  }

  const name = `${result.member.first_name} ${result.member.last_name}`;
  const photoUrl = result.member.photo_url;

  if (result.action === "check_in") {
    return Response.json({
      ok: true,
      action: "check_in",
      name,
      photoUrl,
      detail: `Signed in at ${formatTime(result.checkInAt)}`,
    });
  }

  return Response.json({
    ok: true,
    action: "check_out",
    name,
    photoUrl,
    detail: `Signed out at ${formatTime(result.checkOutAt)} · ${formatDuration(result.checkInAt, result.checkOutAt)} today`,
  });
}
