export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">Barn 2 Sign-In</h1>
      <p className="text-zinc-600">
        To sign in or out, run <code>/sign-in</code> in the team Discord and scan your code at the kiosk.
      </p>
      <a href="/admin" className="text-sm text-zinc-500 underline">
        Mentor login
      </a>
    </main>
  );
}
