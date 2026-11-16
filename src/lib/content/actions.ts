"use server";

import { createClient } from "@/lib/supabase/server";

/** Admin corrects the English, Chinese and Malay versions of one text by hand. */
export async function saveManualTranslation(
  source: string,
  values: { en: string; zh: string; ms: string },
): Promise<{ ok: true } | { ok: false; error: "REQUIRED" | "NOT_ALLOWED" | "UNKNOWN" }> {
  const en = values.en.trim();
  const zh = values.zh.trim();
  const ms = values.ms.trim();
  if (!en || !zh || !ms) return { ok: false, error: "REQUIRED" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_manual_translation", { p_source: source, p_en: en, p_zh: zh, p_ms: ms });
  if (!error) return { ok: true };
  return { ok: false, error: error.code === "42501" ? "NOT_ALLOWED" : "UNKNOWN" };
}
