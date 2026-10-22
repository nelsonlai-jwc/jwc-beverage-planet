import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getOutlets, getRecipeNames, getViewer, loadFullVersion } from "@/lib/recipes/data";
import { toSopData } from "@/lib/recipes/format";
import { createClient } from "@/lib/supabase/server";
import { CopyForm } from "@/components/recipes/CopyForm";
import { SopView } from "@/components/recipes/SopView";

export default async function CopyRecipePage({
  params,
}: {
  params: Promise<{ locale: string; recipeId: string }>;
}) {
  const { locale, recipeId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Recipes");
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const { data: recipe } = await supabase.from("recipes").select("*").eq("id", recipeId).maybeSingle();
  if (!viewer || viewer.role === "BARISTA" || !recipe?.current_approved_version_id) notFound();

  const source = await loadFullVersion(supabase, recipe.current_approved_version_id);
  if (!source) notFound();
  const outlets = await getOutlets(supabase);

  // Every Prep dependency, following each Prep's approved version (O07).
  const deps: { id: string; depth: number }[] = [];
  let frontier = source.ingredients.flatMap((i) => (i.prep_recipe_id ? [i.prep_recipe_id] : []));
  for (let depth = 1; frontier.length && depth <= 10; depth++) {
    const fresh = [...new Set(frontier)].filter((id) => !deps.some((d) => d.id === id));
    deps.push(...fresh.map((id) => ({ id, depth })));
    if (!fresh.length) break;
    const { data: preps } = await supabase.from("recipes").select("current_approved_version_id").in("id", fresh);
    const versionIds = (preps ?? []).flatMap((p) => (p.current_approved_version_id ? [p.current_approved_version_id] : []));
    const { data: rows } = versionIds.length
      ? await supabase.from("recipe_ingredients").select("prep_recipe_id").in("recipe_version_id", versionIds)
      : { data: [] };
    frontier = (rows ?? []).flatMap((r) => (r.prep_recipe_id ? [r.prep_recipe_id] : []));
  }
  const depNames = await getRecipeNames(supabase, deps.map((d) => d.id));

  // Existing recipes in the outlets this viewer can copy into, for mapping and the same-name check.
  const targets = outlets.filter((o) => viewer.managedOutletIds.includes(o.id) && o.id !== recipe.outlet_id);
  const { data: targetRecipes } = targets.length
    ? await supabase
        .from("recipes")
        .select("id, outlet_id, is_prep")
        .in("outlet_id", targets.map((o) => o.id))
        .eq("status", "ACTIVE")
    : { data: [] };
  const targetNames = await getRecipeNames(supabase, (targetRecipes ?? []).map((r) => r.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={`/recipes/${recipeId}`} className="text-sm underline">
          {t("backToRecipe")}
        </Link>
        <h1 className="font-serif text-[32px] font-normal">{t("copyTitle", { name: source.product_name ?? "" })}</h1>
        <p className="text-sm text-[#3d3f3a]">
          {t("copySource", {
            outlet: outlets.find((o) => o.id === recipe.outlet_id)?.name ?? "—",
            no: source.version_no,
          })}
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <CopyForm
          sourceRecipeId={recipeId}
          sourceName={source.product_name ?? ""}
          targets={targets}
          deps={deps.map((d) => ({ ...d, name: depNames.get(d.id) ?? "—" }))}
          existing={(targetRecipes ?? []).map((r) => ({
            id: r.id,
            outletId: r.outlet_id,
            isPrep: r.is_prep,
            name: targetNames.get(r.id) ?? "",
          }))}
        />
        <SopView data={toSopData(source)} />
      </div>
    </div>
  );
}
