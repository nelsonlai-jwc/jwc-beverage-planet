import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getOutlets, getRecipeCost, getRecipeNames, getViewer, loadFullVersion } from "@/lib/recipes/data";
import { RECIPE_OUTLETS, canManageRecipe, outletLabel } from "@/lib/recipes/outlets";
import { STYLES, TEMPS } from "@/lib/recipes/types";
import { getOptionLabels, orderOf } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";
import { RecipeEditor } from "@/components/recipes/RecipeEditor";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ locale: string; recipeId: string }>;
}) {
  const { locale, recipeId } = await params;
  setRequestLocale(locale);
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const { data: recipe } = await supabase
    .from("recipes")
    .select("*, recipe_outlets(outlet_id)")
    .eq("id", recipeId)
    .maybeSingle();
  if (!viewer || !recipe || !canManageRecipe(viewer, recipe)) notFound();
  if (recipe.status === "ARCHIVED") redirect(`/${locale}/recipes/${recipeId}`);

  const { data: open } = await supabase
    .from("recipe_versions")
    .select("id")
    .eq("recipe_id", recipeId)
    .in("status", ["DRAFT", "RETURNED"])
    .maybeSingle();
  if (!open) redirect(`/${locale}/recipes/${recipeId}`);

  const [version, outlets, materials, preps, packaging, events, cost] = await Promise.all([
    loadFullVersion(supabase, open.id),
    getOutlets(supabase),
    supabase.from("materials").select("id, name, brand, status").neq("status", "ARCHIVED").order("name"),
    supabase
      .from("recipes")
      .select(`id, ${RECIPE_OUTLETS}`)
      .eq("is_prep", true)
      .eq("status", "ACTIVE")
      .neq("id", recipeId),
    supabase.from("packaging_items").select("id, name, brand, status").neq("status", "ARCHIVED").order("name"),
    supabase
      .from("approval_events")
      .select("reason")
      .eq("entity_id", open.id)
      .eq("action", "RETURN")
      .order("created_at", { ascending: false })
      .limit(1),
    getRecipeCost(supabase, open.id),
  ]);
  if (!version) notFound();
  const labels = await getOptionLabels();
  const t = await getTranslations("Recipes");
  // Prep made for every outlet of this recipe (same rule as private.recipe_covers_recipe).
  const usablePreps = (preps.data ?? []).filter(
    (p) =>
      p.all_outlets ||
      (!recipe.all_outlets && recipe.recipe_outlets.every((o) => p.recipe_outlets.some((po) => po.outlet_id === o.outlet_id))),
  );
  const prepNames = await getRecipeNames(supabase, usablePreps.map((p) => p.id));

  return (
    <RecipeEditor
      recipeId={recipeId}
      outletId={recipe.outlet_id}
      outletName={outletLabel(recipe, outlets, t("allOutletsOption"))}
      isPrep={recipe.is_prep}
      version={version}
      returnReason={version.status === "RETURNED" ? (events.data?.[0]?.reason ?? null) : null}
      materials={(materials.data ?? []).map((m) => ({
        id: m.id,
        name: m.brand ? `${m.name} (${m.brand})` : m.name,
        approved: m.status === "APPROVED",
      }))}
      preps={usablePreps.map((p) => ({ id: p.id, name: prepNames.get(p.id) ?? "—" }))}
      packagingItems={(packaging.data ?? []).map((p) => ({
        id: p.id,
        name: p.brand ? `${p.name} (${p.brand})` : p.name,
        approved: p.status === "APPROVED",
      }))}
      initialCost={cost}
      adminDirect={viewer.role === "ADMIN" && Boolean(recipe.current_approved_version_id)}
      styles={orderOf(labels, "STYLE", STYLES)}
      temps={orderOf(labels, "TEMP", TEMPS)}
    />
  );
}
