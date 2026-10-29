import { getTranslations } from "next-intl/server";
import { toCsv } from "@/lib/materials/csv";
import { getViewer } from "@/lib/recipes/data";
import { letterFor } from "@/lib/recipes/letters";
import { RECIPE_OUTLETS, outletLabel, type RecipeOutlets } from "@/lib/recipes/outlets";
import { asCost } from "@/lib/recipes/types";
import { createClient } from "@/lib/supabase/server";

const COLUMNS = [
  { key: "outlet", zh: "分店" },
  { key: "product_name", zh: "产品名称" },
  { key: "type", zh: "类型" },
  { key: "style", zh: "Style" },
  { key: "temperature", zh: "温度" },
  { key: "purpose", zh: "用途" },
  { key: "status", zh: "状态" },
  { key: "version", zh: "版本" },
  { key: "ingredients", zh: "原料" },
  { key: "packaging", zh: "包装" },
  { key: "steps", zh: "制作步骤" },
  { key: "cost", zh: "成本 MYR" },
  { key: "updated", zh: "更新时间" },
];

const label = (item?: { name: string; brand: string | null } | null) =>
  item ? (item.brand ? `${item.name} (${item.brand})` : item.name) : "—";

/**
 * One row per recipe the viewer can see (their outlets' recipes; all for an Admin),
 * archived ones left out. Shows the approved version, or the open draft when nothing
 * is approved yet; cost only for approved versions.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Recipes" });
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer || viewer.role === "BARISTA") return new Response(t("noAccess"), { status: 403 });

  const [{ data: recipes }, { data: outlets }, { data: costs }] = await Promise.all([
    supabase
      .from("recipes")
      .select(`id, outlet_id, is_prep, current_approved_version_id, ${RECIPE_OUTLETS}`)
      .eq("status", "ACTIVE"),
    supabase.from("outlets").select("id, name").order("sort_order"),
    supabase.rpc("report_current_costs", {}),
  ]);
  const recipeIds = (recipes ?? []).map((r) => r.id);
  const { data: versions } = recipeIds.length
    ? await supabase
        .from("recipe_versions")
        .select(
          "id, recipe_id, version_no, status, product_name, style, temperature, purpose, updated_at, recipe_ingredients(sort_order, quantity, unit, material_id, prep_recipe_id), recipe_packaging(sort_order, pieces, packaging_item_id), recipe_steps(step_no, instruction)",
        )
        .in("recipe_id", recipeIds)
        .in("status", ["APPROVED", "DRAFT", "PENDING", "RETURNED"])
        .order("version_no", { ascending: false })
    : { data: [] };

  const materialIds = new Set<string>();
  const packagingIds = new Set<string>();
  for (const v of versions ?? []) {
    for (const i of v.recipe_ingredients) if (i.material_id) materialIds.add(i.material_id);
    for (const p of v.recipe_packaging) packagingIds.add(p.packaging_item_id);
  }
  const [{ data: materials }, { data: packaging }] = await Promise.all([
    materialIds.size
      ? supabase.from("materials").select("id, name, brand").in("id", [...materialIds])
      : Promise.resolve({ data: [] as { id: string; name: string; brand: string | null }[] }),
    packagingIds.size
      ? supabase.from("packaging_items").select("id, name, brand").in("id", [...packagingIds])
      : Promise.resolve({ data: [] as { id: string; name: string; brand: string | null }[] }),
  ]);
  const materialById = new Map((materials ?? []).map((m) => [m.id, m]));
  const packagingById = new Map((packaging ?? []).map((p) => [p.id, p]));
  const outletName = (recipe: RecipeOutlets) => outletLabel(recipe, outlets ?? [], t("allOutletsOption"));
  const costByVersion = new Map((costs ?? []).map((c) => [c.version_id, asCost(c.cost)]));

  const chosen = (recipes ?? []).flatMap((r) => {
    const own = (versions ?? []).filter((v) => v.recipe_id === r.id);
    const version = own.find((v) => v.id === r.current_approved_version_id) ?? own[0];
    return version ? [{ recipe: r, version }] : [];
  });
  const nameOfRecipe = new Map(chosen.map(({ recipe, version }) => [recipe.id, version.product_name ?? ""]));

  const rows = chosen
    .sort(
      (a, b) =>
        outletName(a.recipe).localeCompare(outletName(b.recipe)) ||
        (a.version.product_name ?? "").localeCompare(b.version.product_name ?? ""),
    )
    .map(({ recipe, version }) => {
      const cost = costByVersion.get(version.id);
      const ingredients = [...version.recipe_ingredients]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i, index) => {
          const name = i.prep_recipe_id
            ? (nameOfRecipe.get(i.prep_recipe_id) ?? "—")
            : label(materialById.get(i.material_id ?? ""));
          return `${letterFor(index)} ${name} ${i.quantity ?? "—"} ${i.unit ?? ""}`.trim();
        });
      const packagingLines = [...version.recipe_packaging]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((p) => `${label(packagingById.get(p.packaging_item_id))} × ${Number(p.pieces)}`);
      const steps = [...version.recipe_steps]
        .sort((a, b) => a.step_no - b.step_no)
        .filter((s) => s.instruction.trim())
        .map((s, index) => `${index + 1}. ${s.instruction.trim()}`);
      return [
        outletName(recipe),
        version.product_name,
        recipe.is_prep ? t("prep") : t("drink"),
        version.style ? t(`style.${version.style}`) : "",
        version.temperature ? t(`temp.${version.temperature}`) : "",
        t(`purpose.${version.purpose}`),
        t(`status.${version.status}`),
        `V${version.version_no}`,
        ingredients.join("; "),
        packagingLines.join("; "),
        steps.join("\n"),
        cost?.is_complete && cost.total_cost != null ? cost.total_cost.toFixed(2) : "",
        version.updated_at.slice(0, 10),
      ];
    });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(COLUMNS, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="recipes-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
