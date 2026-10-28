"use client";

import { useActionState } from "react";
import { makeBadgeAction, type BadgeState } from "../actions";

type Option = { id: string; name: string; hasBadge: boolean };

export function MakeBadge({ members }: { members: Option[] }) {
  const [state, formAction, pending] = useActionState(makeBadgeAction, {} as BadgeState);

  return (
    <>
      <form action={formAction} className="flex flex-wrap items-center gap-3 print:hidden">
        <select name="memberId" required defaultValue="" className="rounded-md border border-zinc-300 px-2 py-1">
          <option value="" disabled>
            Member…
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.hasBadge ? " (replaces their badge)" : ""}
            </option>
          ))}
        </select>
        <button disabled={pending} className="rounded-md bg-black px-3 py-1 text-white disabled:opacity-50">
          Make badge
        </button>
      </form>

      {state.error && <p className="rounded-md bg-red-100 p-3 text-red-800 print:hidden">{state.error}</p>}

      {state.badge && (
        <div className="flex flex-col items-start gap-3">
          {/* Sized to print about the width of an ID card. */}
          <div className="flex w-[3in] flex-col items-center gap-1 rounded-lg border border-zinc-300 bg-white p-3 text-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.badge.qrDataUrl} alt={`Sign-in badge for ${state.badge.name}`} className="w-full" />
            <p className="text-lg font-semibold">{state.badge.name}</p>
            <p className="text-xs">Barn 2 sign-in · if lost, tell a mentor</p>
          </div>
          <button onClick={() => window.print()} className="rounded-md border px-3 py-1 print:hidden">
            Print
          </button>
        </div>
      )}
    </>
  );
}
