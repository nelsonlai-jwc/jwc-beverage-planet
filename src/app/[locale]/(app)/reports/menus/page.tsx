import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { MenuStatus } from "@/components/menus/MenuStatus";
import { ExportButtons } from "@/components/reports/ExportButtons";
import { FilterForm } from "@/components/reports/FilterForm";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cardClass, mutedText } from "@/components/ui/styles";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadRecipes } from "@/lib/menus/recipes";
import { toCsv } from "@/lib/reports/csv";
import { loadCurrentCosts } from "@/lib/reports/data";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type MenuStatusValue = Database["public"]["Enums"]["menu_status"];
const statuses: MenuStatusValue[] = ["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"];

export default async function MenuSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; status?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Reports");
  const tr = await getTranslations("Recipes");
  const tm = await getTranslations("Menus");
  const format = await getFormatter();
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role === "BARISTA") return <p className={`${cardClass} text-sm`}>{t("noAccess")}</p>;

  const query = await searchParams;
  const outlet = user.outlets.find((o) => o.id === query.outlet);
  const status = statuses.find((s) => s === query.status);
  const supabase = await createClient();

  let menuQuery = supabase
    .from("menus")
    .select("id, name, status, outlet_id, published_at, menu_items(recipe_id, price, sort_order), menu_revisions(id)")
    .in("outlet_id", outlet ? [outlet.id] : user.outlets.map((o) => o.id))
    .order("name");
  menuQuery = status ? menuQuery.eq("status", status) : menuQuery.neq("status", "ARCHIVED");
  const { data: menus } = await menuQuery;

  const recipeIds = [...new Set((menus ?? []).flatMap((m) => m.menu_items.map((i) => i.recipe_id)))];
  const [recipes, costs] = await Promise.all([
    loadRecipes(supabase, { recipeIds }),
    loadCurrentCosts(supabase, outlet?.id),
  ]);

  const outletName = new Map(user.outlets.map((o) => [o.id, o.name]));
  const money = (value: number | null) =>
    value === null ? "—" : format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percent = (value: number | null) =>
    value === null ? "—" : format.number(value, { style: "percent", maximumFractionDigits: 1 });

  const summaries = (menus ?? [])
    .map((menu) => {
      const items = [...menu.menu_items]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => {
          const recipe = recipes.get(item.recipe_id) ?? null;
          const cost = costs.get(item.recipe_id)?.cost ?? null;
          const totalCost = cost?.total_cost ?? null;
          // Data problems worth a look (ch. 15.3); never a silent zero cost (O09).
          const issues = [
            ...(recipe ? [] : ["RECIPE_NOT_APPROVED"]),
            ...(recipe && recipe.purpose !== "OFFICIAL_RELEASE" ? ["NOT_OFFICIAL_RELEASE"] : []),
            ...(recipe && totalCost === null ? ["COST_INCOMPLETE"] : []),
          ];
          return {
            name: recipe?.productName ?? "—",
            style: recipe?.style ?? null,
            temperature: recipe?.temperature ?? null,
            price: item.price,
            cost: totalCost,
            costRate: totalCost !== null ? totalCost / item.price : null,
            issues,
          };
        });
      const styleCounts = new Map<string, number>();
      for (const item of items) {
        if (item.style) styleCounts.set(item.style, (styleCounts.get(item.style) ?? 0) + 1);
      }
      return {
        id: menu.id,
        name: menu.name,
        status: menu.status,
        outlet: outletName.get(menu.outlet_id) ?? "",
        hasPending: menu.menu_revisions !== null,
        items,
        styles: [...styleCounts].map(([s, n]) => `${tr(`style.${s}`)} ${n}`).join(" · "),
      };
    })
    .sort((a, b) => a.outlet.localeCompare(b.outlet) || a.name.localeCompare(b.name));

  const all = t("all");
  const csv = toCsv(
    [
      [t("csv.report"), t("menus.title")],
      [t("csv.currency"), "MYR"],
      [t("csv.basis"), t("cost.basisCurrent")],
      [
        t("csv.filters"),
        `${t("filters.outlet")}: ${outlet?.name ?? all}; ${t("filters.status")}: ${status ? tm(`status.${status}`) : t("menus.notArchived")}`,
      ],
      [t("csv.generatedAt"), format.dateTime(new Date(), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" })],
    ],
    [
      t("columns.outlet"), t("columns.menu"), t("columns.menuStatus"), t("columns.drink"), t("columns.style"),
      t("columns.temp"), t("columns.price"), t("columns.cost"), t("columns.costRate"), t("columns.issues"),
    ],
    summaries.flatMap((menu) =>
      (menu.items.length ? menu.items : [null]).map((item) => [
        menu.outlet, menu.name, tm(`status.${menu.status}`),
        item?.name ?? "", item?.style ? tr(`style.${item.style}`) : "",
        item?.temperature ? tr(`temp.${item.temperature}`) : "",
        item ? item.price.toFixed(2) : "",
        item?.cost != null ? item.cost.toFixed(2) : "",
        item?.costRate != null ? (item.costRate * 100).toFixed(1) + "%" : "",
        item ? item.issues.map((i) => t(`issues.${i}`)).join("; ") : "",
      ]),
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <ReportHeader title={t("menus.title")} note={t("menus.note")} />
      <FilterForm
        filters={[
          {
            name: "outlet", label: t("filters.outlet"), type: "select", value: outlet?.id ?? "",
            options: [{ value: "", label: all }, ...user.outlets.map((o) => ({ value: o.id, label: o.name }))],
          },
          {
            name: "status", label: t("filters.status"), type: "select", value: status ?? "",
            options: [
              { value: "", label: t("menus.notArchived") },
              ...statuses.map((s) => ({ value: s, label: tm(`status.${s}`) })),
            ],
          },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={mutedText}>{t("menus.costExplain")}</p>
        <ExportButtons csv={csv} filename="menu-summary.csv" printable />
      </div>

      {summaries.length === 0 ? (
        <p className={`${cardClass} text-sm`}>{t("empty")}</p>
      ) : (
        summaries.map((menu) => (
          <section key={menu.id} className={`${cardClass} flex flex-col gap-3 break-inside-avoid`} aria-label={menu.name}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{menu.name}</h2>
              <MenuStatus status={menu.status} />
              {menu.hasPending && <StatusBadge tone="purple">{tm("pendingChanges")}</StatusBadge>}
            </div>
            <p className={mutedText}>
              {[menu.outlet, t("menus.drinkCount", { count: menu.items.length }), menu.styles]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {menu.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className={mutedText}>
                    <tr>
                      <th className="py-2 pr-3 font-normal">{t("columns.drink")}</th>
                      <th className="py-2 pr-3 font-normal">{t("columns.style")}</th>
                      <th className="py-2 pr-3 font-normal">{t("columns.temp")}</th>
                      <th className="py-2 pr-3 text-right font-normal">{t("columns.price")}</th>
                      <th className="py-2 pr-3 text-right font-normal">{t("columns.cost")}</th>
                      <th className="py-2 pr-3 text-right font-normal">{t("columns.costRate")}</th>
                      <th className="py-2 font-normal">{t("columns.issues")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    {menu.items.map((item, index) => (
                      <tr key={index}>
                        <td className="py-2 pr-3 font-semibold">{item.name}</td>
                        <td className="py-2 pr-3">{item.style ? tr(`style.${item.style}`) : "—"}</td>
                        <td className="py-2 pr-3">{item.temperature ? tr(`temp.${item.temperature}`) : "—"}</td>
                        <td className="py-2 pr-3 text-right">{money(item.price)}</td>
                        <td className="py-2 pr-3 text-right">{money(item.cost)}</td>
                        <td className="py-2 pr-3 text-right">{percent(item.costRate)}</td>
                        <td className="py-2">
                          {item.issues.map((issue) => (
                            <span key={issue} className="block text-[13px] font-semibold text-[#c4161c]">
                              {t(`issues.${issue}`)}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
