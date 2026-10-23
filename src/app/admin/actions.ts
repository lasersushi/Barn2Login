"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createMember, findMemberByDiscordId, linkDiscord, setActive, unlinkDiscord } from "@/db/members";
import { overrideRecordSession, overrideSignIn, type OverrideResult } from "@/db/overrides";
import { signOutAll, signOutMember } from "@/db/sessions";
import { clearAdminSession, requireAdmin } from "@/lib/auth";

// Every action re-checks the mentor's session: Server Actions can be called
// by a direct POST, not only from the page that renders the form.

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function addMemberAction(formData: FormData) {
  await requireAdmin();
  const firstName = text(formData, "firstName");
  const lastName = text(formData, "lastName");
  const gradYearText = text(formData, "gradYear");
  const gradYear = gradYearText ? Number(gradYearText) : null;
  if (!firstName || !lastName || (gradYear !== null && !Number.isInteger(gradYear))) {
    redirect("/admin?error=invalid-member");
  }
  await createMember({ firstName, lastName, gradYear, subteam: text(formData, "subteam") || null });
  revalidatePath("/admin");
}

export async function linkDiscordAction(formData: FormData) {
  await requireAdmin();
  const memberId = text(formData, "memberId");
  const discordId = text(formData, "discordId");
  if (!memberId || !discordId) redirect("/admin?error=pick-account");
  try {
    await linkDiscord(memberId, discordId);
  } catch {
    // discord_id is unique: that account is already linked to someone else.
    redirect("/admin?error=already-linked");
  }
  revalidatePath("/admin");
}

export async function unlinkDiscordAction(formData: FormData) {
  await requireAdmin();
  await unlinkDiscord(text(formData, "memberId"));
  revalidatePath("/admin");
}

export async function setActiveAction(formData: FormData) {
  await requireAdmin();
  await setActive(text(formData, "memberId"), text(formData, "active") === "true");
  revalidatePath("/admin");
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

// Overrides record which mentor acted (sessions.created_by), so the mentor
// needs their own roster entry with their Discord linked.
async function requireMentorMember(): Promise<string> {
  const admin = await requireAdmin();
  const mentor = await findMemberByDiscordId(admin.discordId);
  if (!mentor) redirect("/admin?error=mentor-not-on-roster");
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

export async function logoutAction() {
  await clearAdminSession();
  redirect("/admin/login");
}
