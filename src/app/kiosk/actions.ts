"use server";

import { redirect } from "next/navigation";
import { checkKioskSecret, setKioskSession } from "@/lib/auth";

// Run once on the iPad: entering KIOSK_SECRET stores the kiosk cookie.
export async function setUpKiosk(formData: FormData) {
  const secret = formData.get("secret");
  if (typeof secret !== "string" || !checkKioskSecret(secret)) {
    redirect("/kiosk?error=1");
  }
  await setKioskSession();
  redirect("/kiosk");
}
