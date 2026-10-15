import type { Metadata } from "next";
import { Redeem } from "./redeem";

export const metadata: Metadata = {
  title: "Your sign-in code",
  robots: { index: false, follow: false },
};

// Rendering this page does nothing on its own. The client component POSTs
// the token, so only a real browser running JavaScript redeems the link.
export default async function RedeemPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Redeem token={token} />;
}
