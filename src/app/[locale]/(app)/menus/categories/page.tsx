import { getTranslations, setRequestLocale } from "next-intl/server";
import { MenuCategories } from "@/components/menus/MenuCategories";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { CATEGORY_SELECT, toCategory } from "@/lib/menus/categories";
import { createClient } from "@/lib/supabase/server";

export default async function MenuCategoriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("MenuCategories");
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role === "BARISTA") {
    return <p className="rounded-[20px] bg-white p-6 text-sm">{t("noAccess")}</p>;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("menu_categories")
    .select(CATEGORY_SELECT)
    .in(
      "outlet_id",
      user.outlets.map((o) => o.id),
    );
  const initialOutletId = user.outlets.some((o) => o.id === query.outlet)
    ? (query.outlet as string)
    : (user.outlets[0]?.id ?? "");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={t("note")} />
      <MenuCategories
        // Remount when the outlet in the link changes.
        key={initialOutletId}
        outlets={user.outlets}
        categories={(data ?? []).map(toCategory)}
        initialOutletId={initialOutletId}
      />
    </div>
  );
}
