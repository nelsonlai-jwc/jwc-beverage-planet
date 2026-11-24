import { getTranslations, setRequestLocale } from "next-intl/server";
import { ImportRecipesForm } from "@/components/recipes/ImportRecipesForm";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { normalize } from "@/lib/materials/csv";
import type { RecipeImportLookups, Unit } from "@/lib/recipes/csv-import";
import { getOutlets, getRecipeNames, getViewer } from "@/lib/recipes/data";
import { RECIPE_OUTLETS } from "@/lib/recipes/outlets";
import { STYLES, TEMPS } from "@/lib/recipes/types";
import { getOptionLabels, styleValues } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";
import { card } from "@/components/recipes/ui";

const PURPOSES = ["RND", "OFFICIAL_RELEASE"];

export default async function ImportRecipesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Recipes");
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer || viewer.role === "BARISTA") return <p className={card}>{t("noAccess")}</p>;

  const [outlets, labels, materials, costUnits, preps, packaging, recipes] = await Promise.all([
    getOutlets(supabase),
    getOptionLabels(),
    supabase.from("materials").select("id, name, brand").neq("status", "ARCHIVED"),
    supabase.from("material_current_costs").select("material_id, unit"),
    supabase.from("recipes").select(`id, current_approved_version_id, ${RECIPE_OUTLETS}`).eq("is_prep", true).eq("status", "ACTIVE"),
    supabase.from("packaging_items").select("id, name, brand").neq("status", "ARCHIVED"),
    supabase.from("recipes").select(`id, current_approved_version_id, ${RECIPE_OUTLETS}`).eq("is_prep", false).eq("status", "ACTIVE"),
  ]);

  // Every name of a value in all three languages (and the code itself) is accepted.
  const aliases: Record<string, Record<string, string>> = { types: {}, styles: {}, temps: {}, purposes: {} };
  const allOutlets = new Set<string>(["all", "all outlets"]);
  const styles = styleValues(labels, STYLES).filter((s) => s !== "PREP_MATERIAL");
  for (const l of routing.locales) {
    const tl = await getTranslations({ locale: l, namespace: "Recipes" });
    aliases.types[normalize(tl("drink"))] = "DRINK";
    aliases.types[normalize(tl("prep"))] = "PREP";
    allOutlets.add(normalize(tl("allOutletsOption")));
    for (const s of STYLES) aliases.styles[normalize(tl(`style.${s}`))] = s;
    for (const temp of TEMPS) aliases.temps[normalize(tl(`temp.${temp}`))] = temp;
    for (const p of PURPOSES) aliases.purposes[normalize(tl(`purpose.${p}`))] = p;
  }
  for (const [code, value] of [["drink", "DRINK"], ["prep", "PREP"], ["prep material", "PREP"]]) aliases.types[code] = value;
  for (const s of styles) aliases.styles[normalize(s)] = s;
  for (const temp of TEMPS) aliases.temps[normalize(temp)] = temp;
  for (const p of PURPOSES) aliases.purposes[normalize(p)] = p;
  for (const l of labels) {
    const map = l.group === "STYLE" ? aliases.styles : l.group === "TEMP" ? aliases.temps : null;
    if (!map || (l.group === "STYLE" && !styles.includes(l.value as never))) continue;
    for (const name of [l.en, l.zh, l.ms]) if (name) map[normalize(name)] = l.value;
  }

  const unitByMaterial = new Map((costUnits.data ?? []).map((c) => [c.material_id, c.unit as Unit | null]));
  const prepRows = preps.data ?? [];
  const drinkRows = recipes.data ?? [];
  const [prepNames, prepYields, drinkVersions] = await Promise.all([
    getRecipeNames(supabase, prepRows.map((p) => p.id)),
    (async () => {
      const ids = prepRows.map((p) => p.current_approved_version_id).filter((id): id is string => Boolean(id));
      if (!ids.length) return new Map<string, Unit | null>();
      const { data } = await supabase.from("recipe_versions").select("recipe_id, yield_unit").in("id", ids);
      return new Map((data ?? []).map((v) => [v.recipe_id, v.yield_unit as Unit | null]));
    })(),
    drinkRows.length
      ? supabase
          .from("recipe_versions")
          .select("recipe_id, product_name, temperature, status")
          .in("recipe_id", drinkRows.map((r) => r.id))
          .in("status", ["APPROVED", "DRAFT", "PENDING", "RETURNED"])
      : Promise.resolve({ data: [] }),
  ]);
  const existing = drinkRows.flatMap((r) =>
    (drinkVersions.data ?? [])
      .filter((v) => v.recipe_id === r.id && v.product_name)
      .map((v) => ({
        key: `${normalize(v.product_name)}|${v.temperature ?? ""}`,
        allOutlets: r.all_outlets,
        outletIds: r.recipe_outlets.map((o) => o.outlet_id),
      })),
  );

  const lookups: RecipeImportLookups = {
    outlets: outlets.filter((o) => viewer.managedOutletIds.includes(o.id)),
    allowAll: viewer.role === "ADMIN",
    allOutlets: [...allOutlets],
    types: aliases.types as RecipeImportLookups["types"],
    styles: aliases.styles,
    temps: aliases.temps,
    purposes: aliases.purposes,
    materials: (materials.data ?? []).map((m) => ({ id: m.id, name: m.name, brand: m.brand, unit: unitByMaterial.get(m.id) ?? null })),
    preps: prepRows.map((p) => ({
      id: p.id,
      name: prepNames.get(p.id) ?? "",
      unit: prepYields.get(p.id) ?? null,
      allOutlets: p.all_outlets,
      outletIds: p.recipe_outlets.map((o) => o.outlet_id),
    })),
    packaging: (packaging.data ?? []).map((p) => ({ id: p.id, name: p.name, brand: p.brand })),
    existing,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/recipes" className="text-sm underline">
          {t("backToList")}
        </Link>
        <h1 className="font-serif text-[26px] font-normal leading-tight md:text-[28px]">{t("import.title")}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("import.intro")}</p>
      </div>
      <ImportRecipesForm locale={locale} lookups={lookups} />
    </div>
  );
}
