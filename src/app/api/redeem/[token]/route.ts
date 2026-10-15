import QRCode from "qrcode";
import { redeemForQr } from "@/db/codes";
import { clientIp } from "@/lib/ip";
import { formatTime } from "@/lib/time";

// Called by the /redeem/[token] page's JavaScript, from the member's phone.
// This request is the one place we observe the member's own network.
// A POST, so link previewers and prefetchers can't burn the one-time link.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const result = await redeemForQr(token, clientIp(req.headers));

  if (!result.ok) {
    return Response.json(
      { error: "This link expired or was already used. Run /sign-in in Discord for a new one." },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  // The QR holds only the raw token. Scanned by anything but the kiosk, it does nothing.
  const qrDataUrl = await QRCode.toDataURL(result.token, {
    width: 600,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  return Response.json(
    {
      firstName: result.firstName,
      qrDataUrl,
      expiresAt: formatTime(result.expiresAt),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
