import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getRecipeNames, getViewer } from "@/lib/recipes/data";
import { formatDateTime } from "@/lib/recipes/format";
import { createClient } from "@/lib/supabase/server";
import { card } from "@/components/recipes/ui";

/** Who did what to a recipe and when, newest first. */
export default async function RecipeHistoryPage({
  params,
}: {
  params: Promise<{ locale: string; recipeId: string }>;
}) {
  const { locale, recipeId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Recipes");
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const { data: recipe } = await supabase.from("recipes").select("id, outlet_id").eq("id", recipeId).maybeSingle();
  if (!viewer || !recipe || !viewer.managedOutletIds.includes(recipe.outlet_id)) notFound();

  const [{ data: rows }, names] = await Promise.all([
    supabase.rpc("recipe_change_log", { p_recipe_id: recipeId }),
    getRecipeNames(supabase, [recipeId]),
  ]);

  const title = (row: NonNullable<typeof rows>[number]) => {
    const version = row.version_no ? `V${row.version_no} · ` : "";
    if (row.source === "VERSION") return version + t(`changeLog.version.${row.action}`);
    if (row.source === "APPROVAL") return version + t(`events.${row.action}`);
    const [action, status] = row.action.split(":");
    if (row.source === "REVIEW") return t(`changeLog.reviewed.${status}`, { action: t(`changeLog.kind.${action}`) });
    return status === "DIRECT" ? t(`changeLog.direct.${action}`) : t(`changeLog.requested.${action}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={`/recipes/${recipeId}`} className="text-sm underline">
          {t("backToRecipe")}
        </Link>
        <h1 className="font-serif text-[32px] font-normal">{t("changeLog.title")}</h1>
        <p className="text-sm text-[#3d3f3a]">{names.get(recipeId)}</p>
      </div>
      {(rows ?? []).length === 0 ? (
        <p className={card}>{t("changeLog.empty")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {(rows ?? []).map((row, index) => (
            <li key={index} className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{title(row)}</span>
                <span className="text-[13px] text-[#3d3f3a]">
                  {row.actor_name ?? "—"} · {formatDateTime(row.happened_at, locale)}
                </span>
              </div>
              {row.reason && (
                <p className="text-sm">
                  {row.source === "VERSION" ? t("changeLog.summary") : t("archive.reason")}: {row.reason}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
