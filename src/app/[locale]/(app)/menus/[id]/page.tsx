import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { MenuEditor } from "@/components/menus/MenuEditor";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadRecipes } from "@/lib/menus/recipes";
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
       menu_items(recipe_id, price, sort_order),
       menu_revisions(id, menu_revision_items(recipe_id, price, sort_order))`,
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

  return (
    <MenuEditor
      menu={{
        id: menu.id,
        name: menu.name,
        status: menu.status,
        outletName: menu.outlets?.name ?? "",
        publishedAt: menu.published_at,
      }}
      revisionId={revision?.id ?? null}
      liveItems={live.map((item) => ({ recipeId: item.recipe_id, price: item.price }))}
      draftItems={draft.map((item) => ({ recipeId: item.recipe_id, price: item.price }))}
      recipes={[...recipes.values()]
        .filter((recipe) => recipe.purpose === "OFFICIAL_RELEASE")
        .sort((a, b) => a.productName.localeCompare(b.productName))}
      allRecipeNames={Object.fromEntries([...names.values()].map((r) => [r.id, r.productName]))}
    />
  );
}
