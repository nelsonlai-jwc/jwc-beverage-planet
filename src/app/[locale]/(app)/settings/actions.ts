"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath, revalidateTag } from "next/cache";
import { OPTION_LABELS_TAG, type OptionGroup } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";

export type ListGroup = "MATERIAL_TYPE" | "OUTLET";
export type SettingResult = { ok: true; outcome?: "DELETED" | "DISABLED" } | { ok: false; error: string };

function fail(error: PostgrestError): SettingResult {
  if (error.code === "23505") return { ok: false, error: "DUPLICATE" };
  if (error.code === "23514") return { ok: false, error: "INVALID" };
  if (error.code === "42501") return { ok: false, error: "NOT_ALLOWED" };
  return { ok: false, error: "UNKNOWN" };
}

function refresh() {
  revalidatePath("/", "layout");
}

const OUTLET_CODE = /^[A-Z0-9-]{2,32}$/;

/** Adds a material type or outlet (id null) at the end, or renames one. */
export async function saveListValue(
  group: ListGroup,
  id: string | null,
  input: { name: string; code?: string },
): Promise<SettingResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "NAME_REQUIRED" };
  const supabase = await createClient();

  if (group === "MATERIAL_TYPE") {
    if (name.length > 60) return { ok: false, error: "INVALID" };
    if (id) {
      const { error } = await supabase.from("material_types").update({ name }).eq("id", id);
      refresh();
      return error ? fail(error) : { ok: true };
    }
    const { data: last } = await supabase
      .from("material_types")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1);
    const { error } = await supabase
      .from("material_types")
      .insert({ name, sort_order: (last?.[0]?.sort_order ?? 0) + 1 });
    refresh();
    return error ? fail(error) : { ok: true };
  }

  if (name.length > 100) return { ok: false, error: "INVALID" };
  if (id) {
    const { error } = await supabase.from("outlets").update({ name }).eq("id", id);
    refresh();
    return error ? fail(error) : { ok: true };
  }
  const code = (input.code ?? "").trim().toUpperCase();
  if (!OUTLET_CODE.test(code)) return { ok: false, error: "CODE_INVALID" };
  const { data: last } = await supabase
    .from("outlets")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const { error } = await supabase
    .from("outlets")
    .insert({ code, name, sort_order: (last?.[0]?.sort_order ?? 0) + 1 });
  refresh();
  return error ? fail(error) : { ok: true };
}

/** Deletes a value nothing uses; one in use is disabled instead. */
export async function removeListValue(group: ListGroup, id: string): Promise<SettingResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_setting_value", { p_group: group, p_id: id });
  refresh();
  if (error) return fail(error);
  return { ok: true, outcome: data === "DELETED" ? "DELETED" : "DISABLED" };
}

export async function setListValueActive(group: ListGroup, id: string, active: boolean): Promise<SettingResult> {
  const supabase = await createClient();
  const { error } =
    group === "MATERIAL_TYPE"
      ? await supabase.from("material_types").update({ is_active: active }).eq("id", id)
      : await supabase.from("outlets").update({ is_active: active }).eq("id", id);
  refresh();
  return error ? fail(error) : { ok: true };
}

/** ids (or option values) of the whole group, first to last. */
export async function reorderValues(group: ListGroup | OptionGroup, ids: string[]): Promise<SettingResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_setting_values", { p_group: group, p_ids: ids });
  if (group === "STYLE" || group === "TEMP" || group === "STRENGTH") revalidateTag(OPTION_LABELS_TAG);
  refresh();
  return error ? fail(error) : { ok: true };
}

export async function saveOptionLabel(
  group: OptionGroup,
  value: string,
  labels: { en: string; zh: string },
): Promise<SettingResult> {
  const en = labels.en.trim();
  const zh = labels.zh.trim();
  if (!en || !zh) return { ok: false, error: "NAME_REQUIRED" };
  if (en.length > 40 || zh.length > 40) return { ok: false, error: "INVALID" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("option_labels")
    .update({ label_en: en, label_zh: zh })
    .eq("option_group", group)
    .eq("value", value)
    .select("value");
  revalidateTag(OPTION_LABELS_TAG);
  refresh();
  if (error) return fail(error);
  return data?.length ? { ok: true } : { ok: false, error: "NOT_ALLOWED" };
}
