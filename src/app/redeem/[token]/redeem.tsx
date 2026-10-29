"use client";

import { useEffect, useRef, useState } from "react";

type Issued = { firstName: string; qrDataUrl: string };
type State = { status: "loading" } | { status: "error"; message: string } | ({ status: "ok" } & Issued);

export function Redeem({ token }: { token: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  // React's dev-mode Strict Mode runs effects twice. The link is single-use,
  // so a second POST would fail and replace the QR with an error.
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;

    fetch(`/api/redeem/${encodeURIComponent(token)}`, { method: "POST" })
      .then(async (res) => {
        const body = await res.json();
        setState(res.ok ? { status: "ok", ...body } : { status: "error", message: body.error });
      })
      .catch(() => setState({ status: "error", message: "Couldn't reach the server. Check your connection and try again." }));
  }, [token]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      {state.status === "loading" && <p className="text-lg">Getting your code…</p>}

      {state.status === "error" && <p className="text-lg">{state.message}</p>}

      {state.status === "ok" && (
        <>
          <h1 className="text-2xl font-semibold">Hi {state.firstName}</h1>
          {/* A plain <img> so it can be long-pressed and saved to Photos. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.qrDataUrl} alt="Your sign-in QR code" className="w-full rounded-lg bg-white" />
          <p className="text-lg">
            This is your permanent sign-in code. Scan it at the kiosk every time you arrive and leave.
          </p>
          <ul className="space-y-1 text-sm text-zinc-500">
            <li>
              <strong>Long-press the code and save it to Photos now.</strong> This page can&apos;t show it again.
            </li>
            <li>Turn your screen brightness up when you scan.</li>
            <li>Running /my-qr again makes a new code and turns this one off.</li>
          </ul>
        </>
      )}
    </main>
  );
}
