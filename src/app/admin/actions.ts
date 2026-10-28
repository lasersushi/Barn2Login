"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { issueBadge, revokeBadge } from "@/db/badges";
import { createPeriod, deletePeriod } from "@/db/hours";
import { findMemberByDiscordId } from "@/db/members";
import { overrideRecordSession, overrideSignIn, type OverrideResult } from "@/db/overrides";
import { signOutAll, signOutMember } from "@/db/sessions";
import { clearAdminSession, requireAdmin } from "@/lib/auth";

// Every action re-checks the mentor's session: Server Actions can be called
// by a direct POST, not only from the page that renders the form.

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function signOutAllAction() {
  await requireAdmin();
  await signOutAll();
  revalidatePath("/admin");
}

export async function signOutMemberAction(formData: FormData) {
  await requireAdmin();
  await signOutMember(text(formData, "memberId"));
  revalidatePath("/admin");
}

// Overrides and periods record which mentor acted (created_by), so the
// mentor needs a roster row. Leadership roles are synced onto the roster
// when /admin loads, so this only fails if that sync hasn't run yet.
async function requireMentorMember(page = "/admin"): Promise<string> {
  const admin = await requireAdmin();
  const mentor = await findMemberByDiscordId(admin.discordId);
  if (!mentor) redirect(`${page}?error=mentor-not-on-roster`);
  return mentor.id;
}

function finishOverride(result: OverrideResult) {
  if (!result.ok) redirect(`/admin?error=${result.reason}`);
  revalidatePath("/admin");
}

export async function overrideSignInAction(formData: FormData) {
  const mentorId = await requireMentorMember();
  const memberId = text(formData, "memberId");
  finishOverride(await overrideSignIn({ memberId, mentorId, note: text(formData, "note") || null }));
}

export async function overrideRecordSessionAction(formData: FormData) {
  const mentorId = await requireMentorMember();
  const memberId = text(formData, "memberId");
  const date = text(formData, "date");
  const start = text(formData, "start");
  const end = text(formData, "end");
  if (!memberId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    redirect("/admin?error=invalid-session");
  }
  finishOverride(
    await overrideRecordSession({ memberId, mentorId, date, start, end, note: text(formData, "note") || null }),
  );
}

export async function createPeriodAction(formData: FormData) {
  const createdBy = await requireMentorMember("/admin/hours");
  const name = text(formData, "name");
  const startsOn = text(formData, "startsOn");
  const endsOn = text(formData, "endsOn");
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!name || !isDate(startsOn) || !isDate(endsOn)) redirect("/admin/hours?error=invalid-period");
  // YYYY-MM-DD strings compare in date order.
  if (endsOn < startsOn) redirect("/admin/hours?error=period-end-before-start");
  const id = await createPeriod({ name, startsOn, endsOn, createdBy });
  redirect(`/admin/hours?period=${id}`);
}

export async function deletePeriodAction(formData: FormData) {
  await requireAdmin();
  await deletePeriod(text(formData, "periodId"));
  redirect("/admin/hours");
}

// Badges (Design.md §5d). The QR comes back to the page once, as action
// state, and is never stored or put in a URL. Reprinting means a new badge.
export type BadgeState = { badge?: { name: string; qrDataUrl: string }; error?: string };

export async function makeBadgeAction(_prev: BadgeState, formData: FormData): Promise<BadgeState> {
  await requireAdmin();
  const issued = await issueBadge(text(formData, "memberId"));
  if (!issued) return { error: "Pick an active member." };
  const qrDataUrl = await QRCode.toDataURL(issued.qrText, { width: 600, margin: 2, errorCorrectionLevel: "M" });
  revalidatePath("/admin/badges");
  return { badge: { name: `${issued.firstName} ${issued.lastName}`.trim(), qrDataUrl } };
}

export async function revokeBadgeAction(formData: FormData) {
  await requireAdmin();
  await revokeBadge(text(formData, "memberId"));
  revalidatePath("/admin/badges");
}

export async function logoutAction() {
  await clearAdminSession();
  redirect("/admin/login");
}
