"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { UserRole } from "@/lib/auth/currentUser";
import { sendInviteEmail } from "@/lib/email/invite";
import { createClient } from "@/lib/supabase/server";

export type InviteResult =
  | { ok: true; email: string; expiresAt: string; emailed: true }
  // The email failed: the link is returned once so the Admin can send it by hand.
  | { ok: true; email: string; expiresAt: string; emailed: false; url: string }
  | { ok: false; error: "EMAIL_HAS_ACCOUNT" | "OUTLET_RULE" | "UNKNOWN" };

export async function inviteUser(target: {
  email: string;
  role: UserRole;
  outletIds: string[];
}): Promise<InviteResult> {
  // Runs as the signed-in user, so create_invitation still checks the Admin role.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_email: target.email,
    p_role: target.role,
    p_outlet_ids: target.outletIds,
  });
  if (error || !data?.[0]) {
    if (error?.code === "23505") return { ok: false, error: "EMAIL_HAS_ACCOUNT" };
    if (error?.code === "23514") return { ok: false, error: "OUTLET_RULE" };
    return { ok: false, error: "UNKNOWN" };
  }
  revalidatePath("/", "layout");

  // English by default; the invite page has a language switch.
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const url = `${origin}/en/invite/${data[0].token}`;
  const email = target.email.trim().toLowerCase();
  const expiresAt = data[0].expires_at;

  const emailed = await sendInviteEmail({ to: email, url });
  return emailed ? { ok: true, email, expiresAt, emailed } : { ok: true, email, expiresAt, emailed, url };
}
