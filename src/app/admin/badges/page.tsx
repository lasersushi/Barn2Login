import type { Metadata } from "next";
import Link from "next/link";
import { listBadgeHolders } from "@/db/badges";
import { listMembers } from "@/db/members";
import { requireAdmin } from "@/lib/auth";
import { revokeBadgeAction } from "../actions";
import { MakeBadge } from "./make-badge";

export const metadata: Metadata = { title: "Badges" };

export default async function BadgesPage() {
  await requireAdmin();
  const [members, holders] = await Promise.all([listMembers(), listBadgeHolders()]);
  const hasBadge = new Set(holders.map((h) => h.id));
  const options = members
    .filter((m) => m.active)
    .map((m) => ({ id: m.id, name: `${m.first_name} ${m.last_name}`.trim(), hasBadge: hasBadge.has(m.id) }));

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 p-6">
      <header className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold">Badges</h1>
        <Link href="/admin" className="text-sm text-zinc-500 underline">
          Back to roster
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500 print:hidden">
          A printed QR for members without a phone. It works at the kiosk until you revoke it, and the kiosk says the
          member&apos;s name out loud on every scan. The code is shown once. To reprint, make a new badge, which stops
          the old one working. A badge doesn&apos;t affect the member&apos;s phone QR from /my-qr.
        </p>
        <MakeBadge members={options} />
      </section>

      <section className="flex flex-col gap-3 print:hidden">
        <h2 className="text-xl font-semibold">Badges in use ({holders.length})</h2>
        {holders.length === 0 && <p className="text-zinc-500">Nobody has a badge.</p>}
        {holders.map((h) => (
          <form key={h.id} action={revokeBadgeAction} className="flex items-center gap-3">
            <input type="hidden" name="memberId" value={h.id} />
            <span className="w-48 font-medium">
              {h.first_name} {h.last_name}
            </span>
            <button className="text-xs underline">Revoke</button>
          </form>
        ))}
      </section>
    </main>
  );
}
