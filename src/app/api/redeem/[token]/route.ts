import QRCode from "qrcode";
import { redeemForPhoneQr } from "@/db/phone-qr";

// Called by the /redeem/[token] page's JavaScript, from the member's phone.
// A POST, so link previewers and prefetchers can't burn the one-time link.
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const result = await redeemForPhoneQr(token);

  if (!result.ok) {
    return Response.json(
      { error: "This link expired or was already used. Run /my-qr in Discord for a new one." },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  // The QR holds only the prefixed token. Scanned by anything but the kiosk, it does nothing.
  const qrDataUrl = await QRCode.toDataURL(result.qrText, {
    width: 600,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  return Response.json(
    { firstName: result.firstName, qrDataUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
}
