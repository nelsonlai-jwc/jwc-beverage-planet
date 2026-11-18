"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  FEEDBACK_DEVICES,
  MAX_DESCRIPTION,
  MAX_FEEDBACK_PHOTOS,
  MAX_REPLY,
  MAX_TITLE,
  isKind,
  isStatus,
  safeFromPath,
  type FeedbackDevice,
} from "@/lib/feedback/types";
import { createClient } from "@/lib/supabase/server";

export type FeedbackResult =
  | { ok: true; id?: string }
  | { ok: false; error: "TITLE_REQUIRED" | "DESCRIPTION_REQUIRED" | "INVALID" | "NOT_ALLOWED" | "UNKNOWN" };

export async function submitFeedback(input: {
  kind: string;
  title: string;
  description: string;
  pageUrl: string | null;
  locale: string;
  device: string;
  userAgent: string;
  photoPaths: string[];
}): Promise<FeedbackResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "NOT_ALLOWED" };
  const title = input.title.trim();
  const description = input.description.trim();
  if (!isKind(input.kind)) return { ok: false, error: "INVALID" };
  if (!title) return { ok: false, error: "TITLE_REQUIRED" };
  if (!description) return { ok: false, error: "DESCRIPTION_REQUIRED" };
  if (title.length > MAX_TITLE || description.length > MAX_DESCRIPTION) return { ok: false, error: "INVALID" };
  const photos = input.photoPaths.filter((p) => p.startsWith(`${user.id}/`));
  if (photos.length > MAX_FEEDBACK_PHOTOS) return { ok: false, error: "INVALID" };
  const device = (FEEDBACK_DEVICES as readonly string[]).includes(input.device)
    ? (input.device as FeedbackDevice)
    : null;

  const supabase = await createClient();
  const id = crypto.randomUUID();
  // No .select(): keep the insert independent of the select policy.
  const { error } = await supabase.from("feedback_reports").insert({
    id,
    kind: input.kind,
    title,
    description,
    page_url: safeFromPath(input.pageUrl),
    locale: input.locale.slice(0, 10),
    device,
    user_agent: input.userAgent.slice(0, 500) || null,
    photo_paths: photos,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "NOT_ALLOWED" : "UNKNOWN" };
  revalidatePath("/feedback");
  return { ok: true, id };
}

/** Super Admin: status and the one reply the submitter reads. */
export async function updateFeedback(id: string, input: { status: string; reply: string }): Promise<FeedbackResult> {
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") return { ok: false, error: "NOT_ALLOWED" };
  if (!isStatus(input.status) || input.reply.length > MAX_REPLY) return { ok: false, error: "INVALID" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback_reports")
    .update({ status: input.status, admin_reply: input.reply.trim() || null })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: "UNKNOWN" };
  if (!data?.length) return { ok: false, error: "NOT_ALLOWED" };
  revalidatePath("/feedback");
  return { ok: true };
}
