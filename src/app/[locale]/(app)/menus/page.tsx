import { getTranslations, setRequestLocale } from "next-intl/server";
import { BaristaMenus } from "@/components/menus/BaristaMenus";
import { MenuList } from "@/components/menus/MenuList";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { CATEGORY_SELECT, flattenCategories, toCategory } from "@/lib/menus/categories";
import { loadRecipes, type MenuRecipe } from "@/lib/menus/recipes";
import { createClient } from "@/lib/supabase/server";
import { TranslationNote } from "@/components/content/TranslationNote";
import { getLocalizer } from "@/lib/content/translations";

export default async function MenusPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Menus");
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  if (user.role === "BARISTA") {
    // RLS returns only published menus of the Barista's own outlet.
    const { data: menus } = await supabase
      .from("menus")
      .select("id, name, outlet_id, menu_items(recipe_id, price, sort_order, category_id)")
      .eq("status", "PUBLISHED")
      .order("name");
    const recipeIds = (menus ?? []).flatMap((m) => m.menu_items.map((i) => i.recipe_id));
    const recipes = await loadRecipes(supabase, { recipeIds });
    const { data: categoryRows } = await supabase
      .from("menu_categories")
      .select(CATEGORY_SELECT)
      .in("outlet_id", [...new Set((menus ?? []).map((m) => m.outlet_id))]);
    // Menu, category and drink names in the viewer's language (AI translated).
    const loc = await getLocalizer(
      [
        ...(menus ?? []).map((m) => m.name),
        ...(categoryRows ?? []).map((c) => c.name),
        ...[...recipes.values()].map((r) => r.productName),
      ],
      locale,
    );
    const localizeRecipe = (recipe: MenuRecipe | null) =>
      recipe ? { ...recipe, productName: loc.t(recipe.productName) } : null;
    const categories = (categoryRows ?? []).map((row) => toCategory({ ...row, name: loc.t(row.name) }));
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} note={t("baristaNote")} />
        <TranslationNote entries={loc.shown()} canEdit={false} />
        <BaristaMenus
          menus={(menus ?? []).map((menu) => ({
            id: menu.id,
            name: loc.t(menu.name),
            categories: flattenCategories(categories.filter((c) => c.outletId === menu.outlet_id)),
            items: [...menu.menu_items]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((item) => ({
                price: item.price,
                categoryId: item.category_id,
                recipe: localizeRecipe(recipes.get(item.recipe_id) ?? null),
              })),
          }))}
        />
      </div>
    );
  }

  const { data: menus } = await supabase
    .from("menus")
    .select("id, name, status, outlet_id, published_at, menu_items(count), menu_revisions(id)")
    .neq("status", "ARCHIVED")
    .order("name");

  const loc = await getLocalizer(
    (menus ?? []).map((m) => m.name),
    locale,
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={t("managerNote")} />
      <TranslationNote entries={loc.shown()} canEdit={user.role === "ADMIN"} />
      <MenuList
        outlets={user.outlets}
        menus={(menus ?? []).map((menu) => ({
          id: menu.id,
          name: loc.t(menu.name),
          status: menu.status,
          outletId: menu.outlet_id,
          publishedAt: menu.published_at,
          itemCount: menu.menu_items[0]?.count ?? 0,
          hasPendingChanges: menu.menu_revisions !== null,
        }))}
      />
    </div>
  );
}
