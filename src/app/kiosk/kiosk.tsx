"use client";

import type QrScanner from "qr-scanner";
import { useCallback, useEffect, useRef, useState } from "react";

type ScanResponse =
  | { ok: true; action: "check_in" | "check_out"; name: string; photoUrl: string | null; detail: string }
  | { ok: false; message: string };

const RESULT_SHOWN_MS = 4000;
// The camera keeps seeing the same phone while the result is on screen.
const SAME_CODE_IGNORE_MS = 15_000;

export function Kiosk() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const armedRef = useRef(false);
  const busyRef = useRef(false);
  const lastRef = useRef<{ token: string; at: number } | null>(null);

  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const onDecode = useCallback(async ({ data }: QrScanner.ScanResult) => {
    const now = Date.now();
    if (busyRef.current) return;
    if (lastRef.current?.token === data && now - lastRef.current.at < SAME_CODE_IGNORE_MS) return;
    busyRef.current = true;
    lastRef.current = { token: data, at: now };

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data }),
      });
      const body = await res.json();
      setResult(res.ok ? body : { ok: false, message: body.error ?? "Something went wrong." });
    } catch {
      setResult({ ok: false, message: "Couldn't reach the server. Check the iPad's Wi-Fi." });
    }

    setTimeout(() => {
      setResult(null);
      busyRef.current = false;
    }, RESULT_SHOWN_MS);
  }, []);

  // Safari only grants the camera from a user gesture, hence the Start button.
  const start = useCallback(async () => {
    if (!videoRef.current) return;
    // Loaded on demand: the library touches browser-only APIs, and client
    // components are still rendered once on the server.
    const { default: QrScannerLib } = await import("qr-scanner");
    scannerRef.current ??= new QrScannerLib(videoRef.current, onDecode, {
      preferredCamera: "user",
      highlightScanRegion: true,
      returnDetailedScanResult: true,
      maxScansPerSecond: 10,
    });
    try {
      await scannerRef.current.start();
      armedRef.current = true;
      setArmed(true);
      setCameraError(null);
    } catch {
      setCameraError("Couldn't start the camera. Check Safari's camera permission for this site.");
    }
  }, [onDecode]);

  // The camera stream dies when the tab is backgrounded. Stop cleanly and
  // re-arm on return; if Safari refuses without a gesture, show Start again.
  useEffect(() => {
    function onVisibilityChange() {
      const scanner = scannerRef.current;
      if (!scanner || !armedRef.current) return;
      if (document.hidden) {
        scanner.stop();
      } else {
        scanner.start().catch(() => {
          armedRef.current = false;
          setArmed(false);
        });
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  return (
    <main className="relative flex h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-zinc-950 p-8 text-white">
      {/*
        Never hide the video with display:none. qr-scanner treats a hidden
        video as a Safari playback hazard and permanently forces it to
        opacity 0 and zero size, so the live feed would never appear.
        Before Start it's only transparent and out of the layout.
        The wrapper is also where qr-scanner draws its scan-region box.
      */}
      <div className={armed ? "relative" : "pointer-events-none absolute opacity-0"}>
        <video ref={videoRef} className="max-h-[70vh] max-w-full rounded-2xl" muted playsInline />
      </div>

      {!armed && (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-4xl font-semibold">Barn 2 Sign-In</h1>
          <button onClick={start} className="rounded-xl bg-white px-10 py-5 text-2xl font-semibold text-black">
            Start
          </button>
          {cameraError && <p className="max-w-md text-red-400">{cameraError}</p>}
        </div>
      )}

      {armed && !result && (
        <p className="text-2xl text-zinc-300">Run /sign-in in Discord, then hold your QR code up to the camera.</p>
      )}

      {result && <ResultCard result={result} />}
    </main>
  );
}

function ResultCard({ result }: { result: ScanResponse }) {
  if (!result.ok) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-red-700 p-10 text-center">
        <p className="text-4xl font-semibold">Not signed in</p>
        <p className="max-w-xl text-2xl">{result.message}</p>
      </div>
    );
  }

  const checkedIn = result.action === "check_in";
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-6 p-10 text-center ${
        checkedIn ? "bg-emerald-700" : "bg-sky-700"
      }`}
    >
      {result.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={result.photoUrl} alt="" className="h-56 w-56 rounded-full object-cover" />
      ) : (
        <div className="flex h-56 w-56 items-center justify-center rounded-full bg-white/20 text-7xl font-semibold">
          {initials(result.name)}
        </div>
      )}
      <p className="text-6xl font-semibold">{result.name}</p>
      <p className="text-3xl">{checkedIn ? "Welcome!" : "See you next time!"}</p>
      <p className="text-2xl text-white/80">{result.detail}</p>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
