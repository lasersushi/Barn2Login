import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth";

export const metadata: Metadata = { title: "Mentor login" };

export default async function AdminLoginPage() {
  if (await getAdmin()) redirect("/admin");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Barn 2 Sign-In — mentors</h1>
      <p className="text-zinc-500">Sign in with the Discord account on the mentor list.</p>
      {/* A plain link, not next/link: this leaves the app for Discord. */}
      <a
        href="/api/auth/discord/login"
        className="rounded-md bg-[#5865F2] px-4 py-2 text-center font-medium text-white"
      >
        Sign in with Discord
      </a>
    </main>
  );
}
