import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getOutlets, getRecipeCost, getRecipeNames, getViewer, loadFullVersion } from "@/lib/recipes/data";
import { formatDateTime } from "@/lib/recipes/format";
import { outletLabel } from "@/lib/recipes/outlets";
import type { FullVersion } from "@/lib/recipes/types";
import { createClient } from "@/lib/supabase/server";
import { CostSummary, formatMoney } from "@/components/recipes/CostSummary";
import { ReviewActions } from "@/components/recipes/ReviewActions";
import { PurposeBadge, card } from "@/components/recipes/ui";

type Change = "added" | "removed" | "changed" | "same";

export default async function ReviewRecipePage({
  params,
}: {
  params: Promise<{ locale: string; recipeId: string }>;
}) {
  const { locale, recipeId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Recipes");
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const { data: recipe } = await supabase
    .from("recipes")
    .select("*, recipe_outlets(outlet_id)")
    .eq("id", recipeId)
    .maybeSingle();
  if (!viewer || viewer.role !== "ADMIN" || !recipe) notFound();

  const { data: pendingRow } = await supabase
    .from("recipe_versions")
    .select("id")
    .eq("recipe_id", recipeId)
    .eq("status", "PENDING")
    .maybeSingle();
  if (!pendingRow) {
    return (
      <div className="flex flex-col gap-4">
        <Link href={`/recipes/${recipeId}`} className="text-sm underline">
          {t("backToRecipe")}
        </Link>
        <p className={card}>{t("nothingToReview")}</p>
      </div>
    );
  }

  const [next, current, outlets] = await Promise.all([
    loadFullVersion(supabase, pendingRow.id),
    recipe.current_approved_version_id ? loadFullVersion(supabase, recipe.current_approved_version_id) : null,
    getOutlets(supabase),
  ]);
  if (!next) notFound();
  const [nextCost, currentCost] = await Promise.all([
    getRecipeCost(supabase, next.id),
    current ? getRecipeCost(supabase, current.id) : null,
  ]);

  // Published menus that switch to this version on approval (D08).
  const { data: menuItems } = await supabase
    .from("menu_items")
    .select("menu_id, price, menus!inner(name, status)")
    .eq("recipe_id", recipeId)
    .eq("menus.status", "PUBLISHED");

  // For a Prep recipe: this outlet's drinks whose approved version uses it (O07).
  let affectedDrinks: string[] = [];
  if (recipe.is_prep) {
    const { data: uses } = await supabase.from("recipe_ingredients").select("recipe_version_id").eq("prep_recipe_id", recipeId);
    const { data: users } = (uses ?? []).length
      ? await supabase
          .from("recipes")
          .select("id")
          .in("current_approved_version_id", (uses ?? []).map((u) => u.recipe_version_id))
      : { data: [] };
    const names = await getRecipeNames(supabase, (users ?? []).map((u) => u.id));
    affectedDrinks = [...names.values()];
  }

  const outletName = outletLabel(recipe, outlets, t("allOutletsOption"));
  const fieldRows = diffFields(t, current, next);
  const ingredientRows = diffIngredients(current, next);
  const stepCount = Math.max(current?.steps.length ?? 0, next.steps.length);
  const costDelta =
    nextCost?.is_complete && currentCost?.is_complete && nextCost.total_cost != null && currentCost.total_cost != null
      ? Number(nextCost.total_cost) - Number(currentCost.total_cost)
      : null;
  const changeClass: Record<Change, string> = {
    added: "bg-brand-green/30",
    removed: "bg-brand-red/20 line-through",
    changed: "bg-brand-orange/30",
    same: "",
  };

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex flex-col gap-2">
        <Link href={`/recipes/${recipeId}`} className="text-sm underline">
          {t("backToRecipe")}
        </Link>
        <h1 className="font-serif text-[32px] font-normal">
          {t("reviewTitle", { name: next.product_name ?? t("untitled") })}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-[#3d3f3a]">
          <span>{outletName}</span>
          <span>·</span>
          <span>{recipe.is_prep ? t("prep") : t("drink")}</span>
          <span>·</span>
          <span>{current ? t("compareVersions", { from: current.version_no, to: next.version_no }) : t("firstVersion", { no: next.version_no })}</span>
          <PurposeBadge purpose={next.purpose} />
        </p>
        <p className="text-sm">{t("submittedAt", { date: formatDateTime(next.submitted_at, locale) })}</p>
        {next.change_summary && (
          <p className="text-sm">
            <span className="font-semibold">{t("fields.changeSummary")}:</span> {next.change_summary}
          </p>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div className="flex flex-col gap-4">
          <section className={card}>
            <h2 className="text-base font-semibold">{t("sections.basic")}</h2>
            <DiffTable
              headers={[t("field"), current ? `V${current.version_no}` : "—", `V${next.version_no}`]}
              rows={fieldRows.map((r) => ({ cells: [r.label, r.before, r.after], change: r.before === r.after ? "same" : "changed" }))}
              changeClass={changeClass}
            />
          </section>

          <section className={card}>
            <h2 className="text-base font-semibold">{t("sections.ingredients")}</h2>
            <DiffTable
              headers={[t("fields.ingredient"), current ? `V${current.version_no}` : "—", `V${next.version_no}`]}
              rows={ingredientRows.map((r) => ({ cells: [r.name, r.before, r.after], change: r.change }))}
              changeClass={changeClass}
            />
          </section>

          <section className={card}>
            <h2 className="text-base font-semibold">{t("sections.method")}</h2>
            <ol className="flex flex-col gap-3">
              {Array.from({ length: stepCount }, (_, index) => {
                const before = current?.steps[index]?.instruction ?? "";
                const after = next.steps[index]?.instruction ?? "";
                const change: Change = !before ? "added" : !after ? "removed" : before === after ? "same" : "changed";
                return (
                  <li key={index} className="grid gap-2 text-sm sm:grid-cols-[2rem_1fr_1fr]">
                    <span className="font-semibold">{index + 1}</span>
                    <span className="whitespace-pre-wrap text-[#3d3f3a]">{before || "—"}</span>
                    <span className={`whitespace-pre-wrap rounded px-1 ${changeClass[change === "removed" ? "same" : change]}`}>
                      {after || "—"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className={card}>
            <h2 className="text-base font-semibold">{t("sections.appearance")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {[current, next].map((v, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <span className="text-sm font-semibold">{v ? `V${v.version_no}` : "—"}</span>
                  <div className="grid grid-cols-3 gap-2">
                    {(v?.photos ?? []).map((p) =>
                      p.url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
                        <img key={p.id} src={p.url} alt="" className="aspect-square w-full rounded-[8px] object-cover" />
                      ) : (
                        <div key={p.id} className="aspect-square w-full rounded-[8px] bg-[#eceee8]" />
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <section className={card}>
            <h2 className="text-base font-semibold">{t("impact")}</h2>
            <p className="text-sm">
              {t("costChange")}{" "}
              <span className="font-semibold tabular-nums">
                {formatMoney(currentCost?.is_complete ? currentCost.total_cost : null)} →{" "}
                {formatMoney(nextCost?.is_complete ? nextCost.total_cost : null)}
                {costDelta != null && ` (${costDelta >= 0 ? "+" : ""}${costDelta.toFixed(2)})`}
              </span>
            </p>
            <p className="text-[13px] text-[#3d3f3a]">{t("costBasis")}</p>
            {!recipe.is_prep && (
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">{t("menusAffected")}</span>
                {(menuItems ?? []).length === 0 ? (
                  <span className="text-[#3d3f3a]">{t("noMenus")}</span>
                ) : (
                  <ul className="list-disc pl-5">
                    {(menuItems ?? []).map((m) => (
                      <li key={m.menu_id}>
                        {m.menus.name} · {formatMoney(m.price)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {recipe.is_prep && (
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">{t("drinksAffected")}</span>
                {affectedDrinks.length === 0 ? (
                  <span className="text-[#3d3f3a]">{t("noDrinks")}</span>
                ) : (
                  <ul className="list-disc pl-5">
                    {affectedDrinks.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
          <CostSummary cost={nextCost} title={t("costOfVersion", { no: next.version_no })} />
          <ReviewActions
            recipeId={recipeId}
            versionId={next.id}
            menuNames={(menuItems ?? []).map((m) => m.menus.name)}
            drinkNames={affectedDrinks}
          />
        </aside>
      </div>
    </div>
  );
}

function DiffTable({
  headers,
  rows,
  changeClass,
}: {
  headers: string[];
  rows: { cells: string[]; change: Change }[];
  changeClass: Record<Change, string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead>
          <tr className="border-b border-black/15">
            {headers.map((h) => (
              <th key={h} className="py-2 pr-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-black/10 align-top">
              <td className="py-2 pr-3">{row.cells[0]}</td>
              <td className="py-2 pr-3 text-[#3d3f3a]">{row.cells[1] || "—"}</td>
              <td className={`py-2 pr-3 ${changeClass[row.change]}`}>{row.cells[2] || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Recipes">>>;

function diffFields(t: T, before: FullVersion | null, after: FullVersion) {
  const show = (v: FullVersion | null, f: (v: FullVersion) => string | null | undefined) => (v ? (f(v) ?? "") : "");
  const specs: [string, (v: FullVersion) => string | null | undefined][] = [
    [t("fields.productName"), (v) => v.product_name],
    [t("fields.purpose"), (v) => t(`purpose.${v.purpose}`)],
    [t("fields.style"), (v) => (v.style ? t(`style.${v.style}`) : "")],
    [t("fields.temperature"), (v) => (v.temperature ? t(`temp.${v.temperature}`) : "")],
    [t("fields.yield"), (v) => (v.yield_quantity != null ? `${v.yield_quantity} ${v.yield_unit ?? ""}` : "")],
    [t("fields.appearanceNotes"), (v) => v.appearance_notes],
    [t("packaging"), (v) => v.packaging.map((p) => `${p.name} × ${p.pieces}`).join(", ")],
  ];
  return specs.map(([label, f]) => ({ label, before: show(before, f), after: show(after, f) }));
}

function diffIngredients(before: FullVersion | null, after: FullVersion) {
  const keyOf = (i: FullVersion["ingredients"][number]) => i.prep_recipe_id ?? i.material_id ?? i.id;
  const amount = (i?: FullVersion["ingredients"][number]) => (i ? `${i.quantity ?? "—"} ${i.unit ?? ""}` : "");
  const rows: { name: string; before: string; after: string; change: Change }[] = after.ingredients.map((i) => {
    const old = before?.ingredients.find((o) => keyOf(o) === keyOf(i));
    const change: Change = !old ? "added" : amount(old) === amount(i) ? "same" : "changed";
    return { name: i.name, before: amount(old), after: amount(i), change };
  });
  for (const o of before?.ingredients ?? []) {
    if (!after.ingredients.some((i) => keyOf(i) === keyOf(o))) {
      rows.push({ name: o.name, before: amount(o), after: "", change: "removed" });
    }
  }
  return rows;
}
