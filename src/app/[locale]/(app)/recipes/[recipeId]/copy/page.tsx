import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getOutlets, getRecipeNames, getViewer, loadFullVersion } from "@/lib/recipes/data";
import { toSopData } from "@/lib/recipes/format";
import { RECIPE_OUTLETS, coversOutlet, outletLabel } from "@/lib/recipes/outlets";
import { createClient } from "@/lib/supabase/server";
import { CopyForm } from "@/components/recipes/CopyForm";
import { SopView } from "@/components/recipes/SopView";

export default async function CopyRecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; recipeId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { locale, recipeId } = await params;
  const { version: versionParam } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Recipes");
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const { data: recipe } = await supabase
    .from("recipes")
    .select("*, recipe_outlets(outlet_id)")
    .eq("id", recipeId)
    .maybeSingle();
  if (!viewer || viewer.role === "BARISTA" || !recipe || recipe.status !== "ACTIVE") notFound();

  // ?version= names the in-progress version (Draft, Pending, Returned) to copy; otherwise the approved one.
  const sourceVersionId = versionParam ?? recipe.current_approved_version_id;
  if (!sourceVersionId) notFound();
  const source = await loadFullVersion(supabase, sourceVersionId);
  if (!source || source.recipe_id !== recipeId) notFound();
  const isApproved = source.id === recipe.current_approved_version_id;
  if (!isApproved && !["DRAFT", "PENDING", "RETURNED"].includes(source.status)) notFound();
  const outlets = await getOutlets(supabase);

  // Every Prep dependency, following each Prep's approved version (O07), with the Preps that use it
  // ("" = the recipe itself) and the outlets it covers: a Prep already covering the target outlet is used as it is.
  type Dep = { id: string; depth: number; parentIds: string[]; approved: boolean; outletIds: string[]; allOutlets: boolean };
  const deps: Dep[] = [];
  let frontier = source.ingredients.flatMap((i) => (i.prep_recipe_id ? [{ id: i.prep_recipe_id, parent: "" }] : []));
  for (let depth = 1; frontier.length && depth <= 10; depth++) {
    for (const f of frontier) {
      const known = deps.find((d) => d.id === f.id);
      if (known && !known.parentIds.includes(f.parent)) known.parentIds.push(f.parent);
    }
    const fresh = [...new Set(frontier.map((f) => f.id))].filter((id) => !deps.some((d) => d.id === id));
    if (!fresh.length) break;
    const { data: preps } = await supabase
      .from("recipes")
      .select(`id, current_approved_version_id, ${RECIPE_OUTLETS}`)
      .in("id", fresh);
    for (const id of fresh) {
      const p = (preps ?? []).find((x) => x.id === id);
      deps.push({
        id,
        depth,
        parentIds: [...new Set(frontier.filter((f) => f.id === id).map((f) => f.parent))],
        approved: Boolean(p?.current_approved_version_id),
        outletIds: (p?.recipe_outlets ?? []).map((o) => o.outlet_id),
        allOutlets: Boolean(p?.all_outlets),
      });
    }
    const versionIds = (preps ?? []).flatMap((p) => (p.current_approved_version_id ? [p.current_approved_version_id] : []));
    const { data: rows } = versionIds.length
      ? await supabase.from("recipe_ingredients").select("recipe_version_id, prep_recipe_id").in("recipe_version_id", versionIds)
      : { data: [] };
    frontier = (rows ?? []).flatMap((r) => {
      const parent = (preps ?? []).find((p) => p.current_approved_version_id === r.recipe_version_id)?.id ?? "";
      return r.prep_recipe_id ? [{ id: r.prep_recipe_id, parent }] : [];
    });
  }
  const depNames = await getRecipeNames(supabase, deps.map((d) => d.id));

  // Existing recipes in the outlets this viewer can copy into, for mapping and the same-name check:
  // one entry per target outlet the recipe is made for. The recipe's own outlets are targets too.
  const targets = outlets.filter((o) => viewer.managedOutletIds.includes(o.id));
  const { data: activeRecipes } = targets.length
    ? await supabase.from("recipes").select(`id, is_prep, ${RECIPE_OUTLETS}`).eq("status", "ACTIVE")
    : { data: [] };
  const targetRecipes = (activeRecipes ?? []).flatMap((r) =>
    targets.filter((o) => coversOutlet(r, o.id)).map((o) => ({ id: r.id, outlet_id: o.id, is_prep: r.is_prep })),
  );
  const targetNames = await getRecipeNames(supabase, [...new Set(targetRecipes.map((r) => r.id))]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={`/recipes/${recipeId}`} className="text-sm underline">
          {t("backToRecipe")}
        </Link>
        <h1 className="font-serif text-[32px] font-normal">{t("copyTitle", { name: source.product_name ?? "" })}</h1>
        <p className="text-sm text-[#3d3f3a]">
          {isApproved
            ? t("copySource", {
                outlet: outletLabel(recipe, outlets, t("allOutletsOption")),
                no: source.version_no,
              })
            : t("copySourceOpen", {
                outlet: outletLabel(recipe, outlets, t("allOutletsOption")),
                status: t(`status.${source.status as "DRAFT" | "PENDING" | "RETURNED"}`),
                no: source.version_no,
              })}
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <CopyForm
          sourceRecipeId={recipeId}
          sourceVersionId={isApproved ? null : source.id}
          sourceName={source.product_name ?? ""}
          targets={targets}
          deps={deps.map((d) => ({ ...d, name: depNames.get(d.id) ?? "—" }))}
          existing={targetRecipes.map((r) => ({
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
