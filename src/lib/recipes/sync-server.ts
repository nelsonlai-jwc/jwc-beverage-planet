import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadFullVersion } from "./data";
import { RECIPE_OUTLETS, type RecipeOutlets } from "./outlets";
import { recipeNameKey } from "./sync";
import type { FullVersion } from "./types";

type Client = SupabaseClient<Database>;

export type SyncSource = RecipeOutlets & { id: string; version: FullVersion };

/**
 * The picked recipes with their approved versions, or null when they cannot be synced
 * together: fewer than two, not all active and approved, different names or kinds, or one
 * has a draft / pending / returned version (same checks as public.sync_recipes).
 */
export async function loadSyncSources(
  supabase: Client,
  ids: string[],
): Promise<{ sources: SyncSource[]; isPrep: boolean } | null> {
  const unique = [...new Set(ids)];
  if (unique.length < 2) return null;
  const { data: recipes } = await supabase
    .from("recipes")
    .select(`id, is_prep, status, current_approved_version_id, ${RECIPE_OUTLETS}`)
    .in("id", unique);
  if ((recipes ?? []).length !== unique.length) return null;
  if (recipes!.some((r) => r.status !== "ACTIVE" || !r.current_approved_version_id)) return null;
  if (new Set(recipes!.map((r) => r.is_prep)).size !== 1) return null;

  const { count } = await supabase
    .from("recipe_versions")
    .select("id", { count: "exact", head: true })
    .in("recipe_id", unique)
    .in("status", ["DRAFT", "PENDING", "RETURNED"]);
  if (count) return null;

  const versions = await Promise.all(recipes!.map((r) => loadFullVersion(supabase, r.current_approved_version_id!)));
  if (versions.some((v) => !v)) return null;
  // Same name and, for drinks, the same temperature (as public.sync_recipes).
  const isPrep = recipes![0].is_prep;
  const keyOf = (v: NonNullable<(typeof versions)[number]>) =>
    `${isPrep ? "" : (v.temperature ?? "")}:${recipeNameKey(v.product_name)}`;
  if (new Set(versions.map((v) => keyOf(v!))).size !== 1) return null;

  // Keep the order the recipes were picked in.
  const sources = unique.map((id) => {
    const index = recipes!.findIndex((r) => r.id === id);
    const r = recipes![index];
    return { id, all_outlets: r.all_outlets, recipe_outlets: r.recipe_outlets, version: versions[index]! };
  });
  return { sources, isPrep };
}
