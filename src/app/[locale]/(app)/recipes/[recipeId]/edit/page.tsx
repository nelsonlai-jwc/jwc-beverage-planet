import { notFound, redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getOutlets, getRecipeCost, getRecipeNames, getViewer, loadFullVersion } from "@/lib/recipes/data";
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
  const { data: recipe } = await supabase.from("recipes").select("*").eq("id", recipeId).maybeSingle();
  if (!viewer || !recipe || !viewer.managedOutletIds.includes(recipe.outlet_id)) notFound();
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
      .select("id")
      .eq("outlet_id", recipe.outlet_id)
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
  const prepNames = await getRecipeNames(supabase, (preps.data ?? []).map((p) => p.id));

  return (
    <RecipeEditor
      recipeId={recipeId}
      outletId={recipe.outlet_id}
      outletName={outlets.find((o) => o.id === recipe.outlet_id)?.name ?? "—"}
      isPrep={recipe.is_prep}
      version={version}
      returnReason={version.status === "RETURNED" ? (events.data?.[0]?.reason ?? null) : null}
      materials={(materials.data ?? []).map((m) => ({
        id: m.id,
        name: m.brand ? `${m.name} (${m.brand})` : m.name,
        approved: m.status === "APPROVED",
      }))}
      preps={(preps.data ?? []).map((p) => ({ id: p.id, name: prepNames.get(p.id) ?? "—" }))}
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
