import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { MenuEditor } from "@/components/menus/MenuEditor";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { CATEGORY_SELECT, flattenCategories, toCategory } from "@/lib/menus/categories";
import { loadRecipes } from "@/lib/menus/recipes";
import { loadCurrentCosts } from "@/lib/reports/data";
import { createClient } from "@/lib/supabase/server";

export default async function MenuPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Menus");
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role === "BARISTA") {
    return <p className="rounded-[20px] bg-white p-6 text-sm">{t("noAccess")}</p>;
  }

  const supabase = await createClient();
  const { data: menu } = await supabase
    .from("menus")
    .select(
      `id, name, status, outlet_id, published_at, outlets(name),
       menu_items(recipe_id, price, sort_order, category_id),
       menu_revisions(id, menu_revision_items(recipe_id, price, sort_order, category_id))`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!menu) notFound();

  const revision = menu.menu_revisions;
  const live = [...menu.menu_items].sort((a, b) => a.sort_order - b.sort_order);
  const draft = revision
    ? [...revision.menu_revision_items].sort((a, b) => a.sort_order - b.sort_order)
    : live;
  // Eligible recipes for the picker, plus names of items whose recipe has since changed.
  const recipes = await loadRecipes(supabase, { outletId: menu.outlet_id });
  const itemRecipes = await loadRecipes(supabase, {
    recipeIds: [...live, ...draft].map((item) => item.recipe_id),
  });
  const names = new Map([...itemRecipes, ...recipes]);
  const { data: categories } = await supabase
    .from("menu_categories")
    .select(CATEGORY_SELECT)
    .eq("outlet_id", menu.outlet_id);
  // Current cost of each drink (its current approved version).
  const costs = await loadCurrentCosts(supabase, menu.outlet_id);

  return (
    <MenuEditor
      menu={{
        id: menu.id,
        name: menu.name,
        status: menu.status,
        outletId: menu.outlet_id,
        outletName: menu.outlets?.name ?? "",
        publishedAt: menu.published_at,
      }}
      revisionId={revision?.id ?? null}
      liveItems={live.map(toItem)}
      draftItems={draft.map(toItem)}
      categories={flattenCategories((categories ?? []).map(toCategory))}
      recipes={[...recipes.values()]
        .filter((recipe) => recipe.purpose === "OFFICIAL_RELEASE")
        .sort((a, b) => a.productName.localeCompare(b.productName))}
      costs={Object.fromEntries(
        [...costs].map(([recipeId, { cost }]) => [
          recipeId,
          { total: cost.total_cost, complete: cost.is_complete },
        ]),
      )}
      allRecipeNames={Object.fromEntries([...names.values()].map((r) => [r.id, r.productName]))}
      allRecipeTemps={Object.fromEntries([...names.values()].map((r) => [r.id, r.temperature]))}
    />
  );
}

function toItem(item: { recipe_id: string; price: number | null; category_id: string | null }) {
  return { recipeId: item.recipe_id, price: item.price, categoryId: item.category_id };
}
