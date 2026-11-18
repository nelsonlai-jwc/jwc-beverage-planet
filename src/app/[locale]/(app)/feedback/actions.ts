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
  MAX_NOTE,
  isPriority,
  isRejectReason,
  isStatus,
  safeFromPath,
  type FeedbackDevice,
} from "@/lib/feedback/types";
import { claudeTask } from "@/lib/feedback/claude";
import { createClient } from "@/lib/supabase/server";

export type FeedbackResult =
  | { ok: true; id?: string }
  | { ok: false; error: "TITLE_REQUIRED" | "DESCRIPTION_REQUIRED" | "REASON_REQUIRED" | "INVALID" | "NOT_ALLOWED" | "UNKNOWN" };

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

/** Super Admin: status, reply, one-tap reject reasons, and the internal priority and note. */
export async function updateFeedback(
  id: string,
  input: { status: string; reply: string; rejectReasons: string[]; priority: string | null; note: string },
): Promise<FeedbackResult> {
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") return { ok: false, error: "NOT_ALLOWED" };
  const reply = input.reply.trim();
  const note = input.note.trim();
  const reasons = input.status === "REJECTED" ? [...new Set(input.rejectReasons)] : [];
  if (!isStatus(input.status) || reply.length > MAX_REPLY || note.length > MAX_NOTE) return { ok: false, error: "INVALID" };
  if (!reasons.every(isRejectReason)) return { ok: false, error: "INVALID" };
  if (input.priority !== null && !isPriority(input.priority)) return { ok: false, error: "INVALID" };
  if (input.status === "REJECTED" && !reasons.length && !reply) return { ok: false, error: "REASON_REQUIRED" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback_reports")
    .update({ status: input.status, admin_reply: reply || null, reject_reasons: reasons })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: "UNKNOWN" };
  if (!data?.length) return { ok: false, error: "NOT_ALLOWED" };
  const triage = await supabase
    .from("feedback_triage")
    .upsert({ report_id: id, priority: input.priority, note: note || null });
  if (triage.error) return { ok: false, error: "UNKNOWN" };
  revalidatePath("/feedback");
  return { ok: true };
}

/** Super Admin: the reports as a ready-to-paste task for Claude Code. */
export async function copyForClaude(ids: string[]): Promise<{ ok: true; text: string } | { ok: false }> {
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN" || !ids.length || ids.length > 50) return { ok: false };
  const text = await claudeTask(ids);
  return text ? { ok: true, text } : { ok: false };
}
