import { getTranslations, setRequestLocale } from "next-intl/server";
import { BaristaMenus } from "@/components/menus/BaristaMenus";
import { MenuList } from "@/components/menus/MenuList";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadRecipes } from "@/lib/menus/recipes";
import { createClient } from "@/lib/supabase/server";

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
      .select("id, name, menu_items(recipe_id, price, sort_order)")
      .eq("status", "PUBLISHED")
      .order("name");
    const recipeIds = (menus ?? []).flatMap((m) => m.menu_items.map((i) => i.recipe_id));
    const recipes = await loadRecipes(supabase, { recipeIds });
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} note={t("baristaNote")} />
        <BaristaMenus
          menus={(menus ?? []).map((menu) => ({
            id: menu.id,
            name: menu.name,
            items: [...menu.menu_items]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((item) => ({ price: item.price, recipe: recipes.get(item.recipe_id) ?? null })),
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={t("managerNote")} />
      <MenuList
        outlets={user.outlets}
        menus={(menus ?? []).map((menu) => ({
          id: menu.id,
          name: menu.name,
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
