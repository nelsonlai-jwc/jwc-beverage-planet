import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { RECIPE_OUTLETS, coversOutlet } from "@/lib/recipes/outlets";

type Version = Database["public"]["Tables"]["recipe_versions"]["Row"];

export type MenuRecipe = {
  id: string;
  productName: string;
  purpose: Version["purpose"];
  style: Version["style"];
  temperature: Version["temperature"];
};

// Current approved version details for the given recipes, keyed by recipe id.
export async function loadRecipes(
  supabase: SupabaseClient<Database>,
  filter: { recipeIds: string[] } | { outletId: string },
): Promise<Map<string, MenuRecipe>> {
  let query = supabase
    .from("recipes")
    .select(`id, current_approved_version_id, ${RECIPE_OUTLETS}`)
    .not("current_approved_version_id", "is", null);
  query =
    "recipeIds" in filter
      ? query.in("id", filter.recipeIds)
      : query.eq("is_prep", false).eq("status", "ACTIVE");
  const { data: rows } = await query;
  // An outlet's menu may use the recipes made for that outlet (or for all outlets).
  const recipes = "outletId" in filter ? (rows ?? []).filter((r) => coversOutlet(r, filter.outletId)) : rows;
  const versionIds = (recipes ?? []).flatMap((r) =>
    r.current_approved_version_id ? [r.current_approved_version_id] : [],
  );
  const { data: versions } = versionIds.length
    ? await supabase
        .from("recipe_versions")
        .select("id, recipe_id, product_name, purpose, style, temperature")
        .in("id", versionIds)
    : { data: [] };

  const result = new Map<string, MenuRecipe>();
  for (const v of versions ?? []) {
    result.set(v.recipe_id, {
      id: v.recipe_id,
      productName: v.product_name ?? "—",
      purpose: v.purpose,
      style: v.style,
      temperature: v.temperature,
    });
  }
  return result;
}
