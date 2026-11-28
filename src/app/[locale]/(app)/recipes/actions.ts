"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notifyReviewResult } from "@/lib/email/approval";
import { MAX_IMPORT_ROWS, type ImportRecipeRow } from "@/lib/recipes/csv-import";
import type { ValidationError } from "@/lib/recipes/types";
import type { Json } from "@/types/database";
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
  "OUTLET_REQUIRED",
  "OUTLET_ON_MENU",
  "OUTLET_NEEDED",
  "PREP_NOT_COVERED",
  "NOT_CURRENT_APPROVAL",
  "OPEN_VERSION_EXISTS",
  "DUPLICATE_NAME",
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

/** Admin only: the outlets a recipe is made for, or all outlets. Applies at once. */
export async function setRecipeOutlets(
  recipeId: string,
  outletIds: string[],
  allOutlets: boolean,
): Promise<RecipeActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_recipe_outlets", {
    p_recipe_id: recipeId,
    p_outlet_ids: allOutlets ? [] : outletIds,
    p_all_outlets: allOutlets,
  });
  refresh();
  return error ? fail(error) : { ok: true };
}

export async function restoreRecipe(recipeId: string): Promise<RecipeActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_archived", { p_entity_type: "RECIPE", p_entity_id: recipeId });
  refresh();
  return error ? fail(error) : { ok: true };
}

/** Admin only: the current approved version goes back to Pending approval. */
export async function undoRecipeApproval(versionId: string, reason: string): Promise<RecipeActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_approval", {
    p_entity_type: "RECIPE_VERSION",
    p_entity_id: versionId,
    p_reason: reason.trim(),
  });
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

// CSV import ------------------------------------------------------------

/**
 * Creates each checked row as a new recipe draft, with the same calls as "New recipe"
 * and "Save draft" (so the same permission checks apply). Nothing is submitted: the
 * drafts go through the normal Submit and approval. If any row fails, the drafts made
 * so far are deleted again, so the import is all or nothing.
 */
export async function importRecipes(rows: ImportRecipeRow[]): Promise<RecipeActionResult & { count?: number }> {
  if (!rows.length || rows.length > MAX_IMPORT_ROWS) return { ok: false, error: "UNKNOWN" };
  const supabase = await createClient();
  const created: string[] = [];
  const undo = async () => {
    if (created.length) await supabase.from("recipes").delete().in("id", created);
  };

  for (const row of rows) {
    const { data: versionId, error } = await supabase.rpc("create_recipe", {
      p_outlet_ids: row.allOutlets ? [] : row.outletIds,
      p_all_outlets: row.allOutlets,
      p_is_prep: row.isPrep,
      p_product_name: row.draft.product_name,
    });
    if (error || !versionId) {
      await undo();
      return error ? fail(error) : { ok: false, error: "UNKNOWN" };
    }
    const { data: version } = await supabase
      .from("recipe_versions")
      .select("recipe_id, revision")
      .eq("id", versionId)
      .single();
    if (!version) {
      await undo();
      return { ok: false, error: "UNKNOWN" };
    }
    created.push(version.recipe_id);
    const { error: saveError } = await supabase.rpc("save_recipe_draft", {
      p_version_id: versionId,
      p_revision: version.revision,
      p_draft: { ...row.draft, tags: [], photos: [] } as unknown as Json,
    });
    if (saveError) {
      await undo();
      return fail(saveError);
    }
  }
  refresh();
  return { ok: true, count: created.length };
}

// Bulk actions of the "My outlets" list -------------------------------------
// Each recipe goes through the same call as its single action (same permission checks);
// one that fails is skipped and reported, the others still go ahead.

export type BulkResult = { id: string; ok: boolean; outcome?: "APPLIED" | "REQUESTED"; error?: string; message?: string };

const MAX_BULK = 200;

function bulkFail(id: string, error: PostgrestError): BulkResult {
  const result = fail(error);
  return result.ok ? { id, ok: true } : { id, ok: false, error: result.error, message: result.message };
}

/** Admin only: every chosen recipe gets the same outlets (or all outlets). */
export async function bulkSetRecipeOutlets(
  recipeIds: string[],
  outletIds: string[],
  allOutlets: boolean,
): Promise<BulkResult[]> {
  if (!recipeIds.length || recipeIds.length > MAX_BULK) return [];
  const supabase = await createClient();
  const results: BulkResult[] = [];
  for (const id of recipeIds) {
    const { error } = await supabase.rpc("set_recipe_outlets", {
      p_recipe_id: id,
      p_outlet_ids: allOutlets ? [] : outletIds,
      p_all_outlets: allOutlets,
    });
    results.push(error ? bulkFail(id, error) : { id, ok: true });
  }
  refresh();
  return results;
}

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Copies each recipe as a draft into one outlet, under its own name: the version the card
 * shows (the one in progress, else the approved one). Approved Preps are copied or reused
 * as on the Copy page. Skipped: a drink whose name and temp the outlet already has, and a
 * recipe whose Prep is not approved (it must be mapped by hand on the Copy page).
 */
export async function bulkCopyRecipes(
  items: { recipeId: string; versionId: string | null }[],
  targetOutletId: string,
  idempotencyKey: string,
): Promise<BulkResult[]> {
  if (!items.length || items.length > MAX_BULK) return [];
  const supabase = await createClient();

  // Drinks the target outlet already has (approved or in progress), for the same-name check.
  const { data: active } = await supabase
    .from("recipes")
    .select("id, is_prep, current_approved_version_id, all_outlets, recipe_outlets(outlet_id)")
    .eq("status", "ACTIVE")
    .eq("is_prep", false);
  const inTarget = (active ?? []).filter(
    (r) => r.all_outlets || r.recipe_outlets.some((o) => o.outlet_id === targetOutletId),
  );
  const { data: targetVersions } = inTarget.length
    ? await supabase
        .from("recipe_versions")
        .select("recipe_id, id, status, product_name, temperature")
        .in("recipe_id", inTarget.map((r) => r.id))
    : { data: [] };
  const approvedIds = new Set(inTarget.map((r) => r.current_approved_version_id));
  const taken = new Set(
    (targetVersions ?? [])
      .filter((v) => approvedIds.has(v.id) || ["DRAFT", "PENDING", "RETURNED"].includes(v.status))
      .map((v) => `${norm(v.product_name)}|${v.temperature ?? ""}`),
  );

  const { data: sources } = await supabase
    .from("recipes")
    .select("id, is_prep, current_approved_version_id")
    .in("id", items.map((i) => i.recipeId));
  const sourceVersionIds = items.map(
    (i) => i.versionId ?? sources?.find((s) => s.id === i.recipeId)?.current_approved_version_id ?? "",
  );
  const { data: sourceVersions } = await supabase
    .from("recipe_versions")
    .select("id, product_name, temperature")
    .in("id", sourceVersionIds.filter(Boolean));

  const results: BulkResult[] = [];
  for (const [index, item] of items.entries()) {
    const source = sources?.find((s) => s.id === item.recipeId);
    const version = sourceVersions?.find((v) => v.id === sourceVersionIds[index]);
    if (!source || !version) {
      results.push({ id: item.recipeId, ok: false, error: "NOT_ALLOWED" });
      continue;
    }
    const nameKey = `${norm(version.product_name)}|${version.temperature ?? ""}`;
    if (!source.is_prep && taken.has(nameKey)) {
      results.push({ id: item.recipeId, ok: false, error: "DUPLICATE_NAME" });
      continue;
    }
    const { error } = await supabase.rpc("copy_recipe", {
      p_source_recipe_id: item.recipeId,
      p_target_outlet_id: targetOutletId,
      p_product_name: version.product_name ?? "",
      p_prep_mapping: {},
      p_idempotency_key: `${idempotencyKey}:${item.recipeId}:${targetOutletId}`,
      ...(item.versionId ? { p_source_version_id: item.versionId } : {}),
    });
    if (error) {
      // The recipe itself is always copyable here, so this message is about one of its Preps.
      results.push(
        error.message === "Only approved, active recipes can be copied"
          ? { id: item.recipeId, ok: false, error: "PREP_NOT_APPROVED" }
          : bulkFail(item.recipeId, error),
      );
      continue;
    }
    if (!source.is_prep) taken.add(nameKey);
    results.push({ id: item.recipeId, ok: true });
  }
  refresh();
  return results;
}

/**
 * Same as each card's Delete: a recipe never submitted is deleted; a submitted one is
 * archived (Admin, or a Manager while nothing is approved) or its deletion is requested.
 */
export async function bulkDeleteRecipes(
  items: { recipeId: string; neverSubmitted: boolean }[],
  reason: string,
): Promise<BulkResult[]> {
  if (!items.length || items.length > MAX_BULK) return [];
  const supabase = await createClient();
  const results: BulkResult[] = [];
  for (const item of items) {
    if (item.neverSubmitted) {
      const { data, error } = await supabase.from("recipes").delete().eq("id", item.recipeId).select("id");
      if (error) results.push(bulkFail(item.recipeId, error));
      else results.push(data?.length ? { id: item.recipeId, ok: true, outcome: "APPLIED" } : { id: item.recipeId, ok: false, error: "NOT_ALLOWED" });
      continue;
    }
    const { data, error } = await supabase.rpc("request_change", {
      p_entity_type: "RECIPE",
      p_entity_id: item.recipeId,
      p_action: "ARCHIVE",
      p_reason: reason.trim() || null,
    });
    results.push(
      error ? bulkFail(item.recipeId, error) : { id: item.recipeId, ok: true, outcome: data === "APPLIED" ? "APPLIED" : "REQUESTED" },
    );
  }
  refresh();
  return results;
}
