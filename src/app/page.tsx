export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">Barn 2 Sign-In</h1>
      <p className="text-zinc-600">
        Run <code>/my-qr</code> in the team Discord once to get your QR code, then scan it at the kiosk every time
        you arrive and leave.
      </p>
      <a href="/admin" className="text-sm text-zinc-500 underline">
        Mentor login
      </a>
    </main>
  );
}
