import type { Metadata } from "next";
import { isKioskPage } from "@/lib/auth";
import { setUpKiosk } from "./actions";
import { Kiosk } from "./kiosk";

export const metadata: Metadata = {
  title: "Barn 2 Kiosk",
  robots: { index: false, follow: false },
};

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isKioskPage()) return <Kiosk />;

  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Set up this device as the kiosk</h1>
      <p className="text-zinc-500">Enter the kiosk secret. You only need to do this once per iPad.</p>
      <form action={setUpKiosk} className="flex flex-col gap-3">
        <input
          name="secret"
          type="password"
          required
          autoComplete="off"
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
        {error && <p className="text-red-600">That secret didn&apos;t match.</p>}
        <button className="rounded-md bg-black px-4 py-2 text-white">Set up kiosk</button>
      </form>
    </main>
  );
}
