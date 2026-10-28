"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notifyReviewResult } from "@/lib/email/approval";
import type { ValidationError } from "@/lib/recipes/types";
import { createClient } from "@/lib/supabase/server";

// Error codes the recipe pages explain; anything else shows the database message.
const KNOWN_ERRORS = [
  "NOT_ALLOWED",
  "NOT_ARCHIVABLE",
  "NOT_ARCHIVED",
  "IN_USE",
  "ON_MENU",
  "VERSION_PENDING",
  "REASON_REQUIRED",
  "REQUEST_ALREADY_PENDING",
  "RECIPE_ARCHIVED",
];

export type RecipeActionResult =
  | { ok: true; outcome?: "APPLIED" | "REQUESTED" }
  | { ok: false; error: string; message?: string; details?: string };

export type PublishResult = RecipeActionResult | { ok: false; error: "INVALID"; errors: ValidationError[] };

function fail(error: PostgrestError): RecipeActionResult {
  if (KNOWN_ERRORS.includes(error.message)) return { ok: false, error: error.message };
  if (error.code === "42501") return { ok: false, error: "NOT_ALLOWED" };
  return { ok: false, error: "UNKNOWN", message: error.message, details: error.details };
}

function refresh() {
  revalidatePath("/", "layout");
}

/** "Delete" of a submitted recipe: an Admin archives at once, a Manager asks with a reason. */
export async function archiveRecipe(recipeId: string, reason: string): Promise<RecipeActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_change", {
    p_entity_type: "RECIPE",
    p_entity_id: recipeId,
    p_action: "ARCHIVE",
    p_reason: reason.trim() || null,
  });
  refresh();
  if (error) return fail(error);
  return { ok: true, outcome: data === "APPLIED" ? "APPLIED" : "REQUESTED" };
}

export async function restoreRecipe(recipeId: string): Promise<RecipeActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_archived", { p_entity_type: "RECIPE", p_entity_id: recipeId });
  refresh();
  return error ? fail(error) : { ok: true };
}

export async function approveRecipeVersion(versionId: string, idempotencyKey: string): Promise<RecipeActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_recipe_version", {
    p_version_id: versionId,
    p_idempotency_key: idempotencyKey,
  });
  refresh();
  if (error) return fail(error);
  await notifyReviewResult(supabase, { kind: "recipe", id: versionId, approved: true });
  return { ok: true };
}

export async function returnRecipeVersion(versionId: string, reason: string): Promise<RecipeActionResult> {
  if (!reason.trim()) return { ok: false, error: "REASON_REQUIRED" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_recipe_version", {
    p_version_id: versionId,
    p_reason: reason.trim(),
  });
  refresh();
  if (error) return fail(error);
  await notifyReviewResult(supabase, { kind: "recipe", id: versionId, approved: false, reason });
  return { ok: true };
}

/** Admin edit of an approved recipe: the saved draft is submitted and approved together. */
export async function publishRecipeVersion(
  versionId: string,
  revision: number,
  idempotencyKey: string,
): Promise<PublishResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_recipe_version", {
    p_version_id: versionId,
    p_revision: revision,
    p_idempotency_key: idempotencyKey,
  });
  refresh();
  if (error) return fail(error);
  const result = data as unknown as { errors?: ValidationError[] } | null;
  if (result?.errors?.length) return { ok: false, error: "INVALID", errors: result.errors };
  return { ok: true, outcome: "APPLIED" };
}
