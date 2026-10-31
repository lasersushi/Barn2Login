"use client";

import type QrScanner from "qr-scanner";
import { useCallback, useEffect, useRef, useState } from "react";

type ScanResponse =
  | {
      ok: true;
      action: "check_in" | "check_out";
      name: string;
      firstName: string;
      photoUrl: string | null;
      detail: string;
    }
  | { ok: false; message: string };

export type VoicePack = "teto";
type Action = "check_in" | "check_out";
type Clips = Record<Action, AudioBuffer>;

const CLIP_FILES: Record<Action, string> = {
  check_in: "check-in.mp3",
  check_out: "check-out.mp3",
};

const RESULT_SHOWN_MS = 4000;
// The camera keeps seeing the same phone while the result is on screen.
const SAME_CODE_IGNORE_MS = 15_000;

export function Kiosk({ voicePack }: { voicePack: VoicePack | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const armedRef = useRef(false);
  const busyRef = useRef(false);
  const lastRef = useRef<{ token: string; at: number } | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const clipsRef = useRef<Clips | null>(null);
  const playingRef = useRef<{ source: AudioBufferSourceNode; timer: ReturnType<typeof setTimeout> } | null>(null);

  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // The character clip, then the first name in the plain voice. The name is
  // the part the shop has to catch, so it never goes in the character voice.
  const greet = useCallback((action: Action, firstName: string) => {
    // A second scan cuts off the first greeting. Detach before stopping, or
    // the old clip's onended would still say the old name.
    const playing = playingRef.current;
    if (playing) {
      playing.source.onended = null;
      clearTimeout(playing.timer);
      playing.source.stop();
      playingRef.current = null;
    }

    const ctx = audioCtxRef.current;
    const clip = clipsRef.current?.[action];
    if (!ctx || !clip || ctx.state !== "running") {
      // Safari can suspend the context, e.g. after the tab was backgrounded.
      // Try to wake it for next time; this scan uses the plain voice.
      ctx?.resume().catch(() => {});
      speak(`${action === "check_in" ? "Welcome" : "Bye"}, ${firstName}`, voiceRef.current);
      return;
    }

    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    const source = ctx.createBufferSource();
    source.buffer = clip;
    source.connect(ctx.destination);
    let said = false;
    function sayName() {
      if (said) return;
      said = true;
      clearTimeout(timer);
      playingRef.current = null;
      speak(firstName, voiceRef.current);
    }
    source.onended = sayName;
    // onended can go missing if Safari interrupts the context mid-clip.
    const timer = setTimeout(sayName, clip.duration * 1000 + 500);
    playingRef.current = { source, timer };
    source.start();
  }, []);

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
      const scanned: ScanResponse = res.ok ? body : { ok: false, message: body.error ?? "Something went wrong." };
      setResult(scanned);
      // Saying the name out loud is the check that the person scanning is
      // the person signing in: everyone in the shop hears it.
      if (scanned.ok) greet(scanned.action, scanned.firstName);
    } catch {
      setResult({ ok: false, message: "Couldn't reach the server. Check the iPad's Wi-Fi." });
    }

    setTimeout(() => {
      setResult(null);
      busyRef.current = false;
    }, RESULT_SHOWN_MS);
  }, [greet]);

  // Safari only grants the camera from a user gesture, hence the Start button.
  // Speech needs one too, and only counts it before the first await. Saying
  // something here unlocks it, and checks the volume is up. The character
  // clips' AudioContext needs the same gesture. "Sign-in ready" stays in the
  // plain voice: it is what unlocks speech for the names.
  const start = useCallback(async () => {
    speak("Sign-in ready", voiceRef.current);
    audioCtxRef.current?.resume().catch(() => {});
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

  // Voices load asynchronously; getVoices() is often empty until this fires.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    function pick() {
      voiceRef.current = bestVoice(speechSynthesis.getVoices());
    }
    pick();
    speechSynthesis.addEventListener("voiceschanged", pick);
    return () => speechSynthesis.removeEventListener("voiceschanged", pick);
  }, []);

  // One context for every clip: it can be created now, but only plays once
  // Start resumes it. Clips that fail to load just leave the plain voice.
  useEffect(() => {
    if (!voicePack || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    let cancelled = false;
    async function load(action: Action) {
      const res = await fetch(`/voice/${voicePack}/${CLIP_FILES[action]}`);
      if (!res.ok) throw new Error(`${CLIP_FILES[action]}: ${res.status}`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    }
    Promise.all([load("check_in"), load("check_out")])
      .then(([checkIn, checkOut]) => {
        if (!cancelled) clipsRef.current = { check_in: checkIn, check_out: checkOut };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (playingRef.current) clearTimeout(playingRef.current.timer);
      playingRef.current = null;
      clipsRef.current = null;
      audioCtxRef.current = null;
      ctx.close().catch(() => {});
    };
  }, [voicePack]);

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
        <p className="text-2xl text-zinc-300">
          Hold your QR code up to the camera. No code yet? Run /my-qr in Discord.
        </p>
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

// Downloaded voices (Settings → Accessibility → Spoken Content → Voices)
// sound far less robotic than the default. Ava (Premium) first, as the
// clearest over shop noise; then any other downloaded voice. Null means
// the default voice.
function bestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang === "en-US");
  return (
    english.find((v) => /^Ava\b/.test(v.name) && /premium/i.test(v.name)) ??
    english.find((v) => /premium|enhanced/i.test(v.name)) ??
    null
  );
}

// Never lets speech break scanning: a browser without it just stays quiet.
function speak(text: string, voice: SpeechSynthesisVoice | null) {
  if (typeof speechSynthesis === "undefined") return;
  // Two quick scans shouldn't queue up and fall behind.
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
