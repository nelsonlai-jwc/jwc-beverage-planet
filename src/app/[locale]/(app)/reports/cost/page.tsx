import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { CostLines, type CostNode } from "@/components/reports/CostLines";
import { ExportButtons } from "@/components/reports/ExportButtons";
import { FilterForm } from "@/components/reports/FilterForm";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cardClass, mutedText } from "@/components/ui/styles";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { fromLiveLines, fromSnapshotLines } from "@/lib/reports/costTree";
import { toCsv } from "@/lib/reports/csv";
import { loadApprovalSnapshots, loadCurrentCosts, loadSellingPrices } from "@/lib/reports/data";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Style = Database["public"]["Enums"]["beverage_style"];
const styles: Style[] = ["COFFEE", "TEA", "COCKTAIL", "MOCKTAIL", "PREP_MATERIAL"];

export default async function CostReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; menu?: string; style?: string; basis?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Reports");
  const tr = await getTranslations("Recipes");
  const format = await getFormatter();
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role === "BARISTA") return <p className={`${cardClass} text-sm`}>{t("noAccess")}</p>;

  const query = await searchParams;
  const outlet = user.outlets.find((o) => o.id === query.outlet);
  const style = styles.find((s) => s === query.style);
  const basis = query.basis === "snapshot" ? "snapshot" : "current";
  const supabase = await createClient();
  const outletIds = outlet ? [outlet.id] : user.outlets.map((o) => o.id);

  const { data: menus } = await supabase
    .from("menus")
    .select("id, name, outlet_id, menu_items(recipe_id)")
    .in("outlet_id", outletIds)
    .neq("status", "ARCHIVED")
    .order("name");
  const menu = menus?.find((m) => m.id === query.menu);

  const { data: recipes } = await supabase
    .from("recipes")
    .select("id, outlet_id, current_approved_version_id")
    .eq("status", "ACTIVE")
    .not("current_approved_version_id", "is", null)
    .in("outlet_id", outletIds);
  const versionIds = (recipes ?? []).flatMap((r) =>
    r.current_approved_version_id ? [r.current_approved_version_id] : [],
  );
  const { data: versions } = versionIds.length
    ? await supabase
        .from("recipe_versions")
        .select("id, recipe_id, version_no, product_name, style")
        .in("id", versionIds)
    : { data: [] };
  const versionByRecipe = new Map((versions ?? []).map((v) => [v.recipe_id, v]));

  const [current, snapshots, prices] = await Promise.all([
    basis === "current" ? loadCurrentCosts(supabase, outlet?.id) : Promise.resolve(null),
    basis === "snapshot" ? loadApprovalSnapshots(supabase, versionIds, true) : Promise.resolve(null),
    loadSellingPrices(supabase),
  ]);

  const outletName = new Map(user.outlets.map((o) => [o.id, o.name]));
  const menuRecipes = menu ? new Set(menu.menu_items.map((i) => i.recipe_id)) : null;

  const rows = (recipes ?? [])
    .map((recipe) => {
      const version = versionByRecipe.get(recipe.id);
      if (!version) return null;
      // Prep Material is listed only when its style is chosen.
      if (style ? version.style !== style : version.style === "PREP_MATERIAL") return null;
      if (menuRecipes && !menuRecipes.has(recipe.id)) return null;

      let totalCost: number | null = null;
      let reasons: string[] = [];
      let lines: CostNode[] = [];
      let calculatedAt: string | null = null;
      if (current) {
        const entry = current.get(recipe.id);
        totalCost = entry?.cost.total_cost ?? null;
        reasons = entry ? [...new Set(entry.cost.incomplete_reasons.map((r) => r.code))] : ["UNKNOWN"];
        lines = entry ? fromLiveLines(entry.cost.lines) : [];
      } else {
        const snapshot = snapshots?.get(version.id);
        totalCost = snapshot?.totalCost ?? null;
        reasons = snapshot ? [] : ["NO_SNAPSHOT"];
        lines = snapshot ? fromSnapshotLines(snapshot.lines) : [];
        calculatedAt = snapshot?.calculatedAt ?? null;
      }
      const price = prices.get(recipe.id) ?? null;
      const margin = totalCost !== null && price !== null ? price - totalCost : null;
      const costRate = totalCost !== null && price ? totalCost / price : null;
      return {
        id: recipe.id,
        name: version.product_name ?? "—",
        outlet: outletName.get(recipe.outlet_id) ?? "",
        versionNo: version.version_no,
        style: version.style,
        totalCost,
        reasons,
        lines,
        calculatedAt,
        price,
        margin,
        costRate,
      };
    })
    .filter((row) => row !== null)
    .sort((a, b) => a.outlet.localeCompare(b.outlet) || a.name.localeCompare(b.name));

  const money = (value: number | null) =>
    value === null ? "—" : format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percent = (value: number | null) =>
    value === null ? "—" : format.number(value, { style: "percent", maximumFractionDigits: 1 });
  const dateTime = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });
  const basisLabel = basis === "current" ? t("cost.basisCurrent") : t("cost.basisSnapshot");
  const all = t("all");

  const csv = toCsv(
    [
      [t("csv.report"), t("cost.title")],
      [t("csv.currency"), "MYR"],
      [t("csv.basis"), basisLabel],
      [
        t("csv.filters"),
        [
          `${t("filters.outlet")}: ${outlet?.name ?? all}`,
          `${t("filters.menu")}: ${menu?.name ?? all}`,
          `${t("filters.style")}: ${style ? tr(`style.${style}`) : all}`,
        ].join("; "),
      ],
      [t("csv.generatedAt"), dateTime(new Date().toISOString())],
    ],
    [
      t("columns.drink"), t("columns.outlet"), t("columns.version"), t("columns.style"),
      t("columns.cost"), t("columns.price"), t("columns.margin"), t("columns.costRate"), t("columns.status"),
    ],
    rows.map((row) => [
      row.name, row.outlet, `V${row.versionNo}`, row.style ? tr(`style.${row.style}`) : "",
      row.totalCost === null ? "" : row.totalCost.toFixed(2),
      row.price === null ? "" : row.price.toFixed(2),
      row.margin === null ? "" : row.margin.toFixed(2),
      row.costRate === null ? "" : (row.costRate * 100).toFixed(1) + "%",
      row.totalCost === null ? row.reasons.map((r) => t(`reasons.${r}`)).join("; ") : t("cost.complete"),
    ]),
  );

  return (
    <div className="flex flex-col gap-6">
      <ReportHeader title={t("cost.title")} note={t("cost.note")} />
      <FilterForm
        filters={[
          {
            name: "basis", label: t("filters.basis"), type: "select", value: basis,
            options: [
              { value: "current", label: t("cost.basisCurrent") },
              { value: "snapshot", label: t("cost.basisSnapshot") },
            ],
          },
          {
            name: "outlet", label: t("filters.outlet"), type: "select", value: outlet?.id ?? "",
            options: [{ value: "", label: all }, ...user.outlets.map((o) => ({ value: o.id, label: o.name }))],
          },
          {
            name: "menu", label: t("filters.menu"), type: "select", value: menu?.id ?? "",
            options: [
              { value: "", label: all },
              ...(menus ?? []).map((m) => ({
                value: m.id,
                label: outlet ? m.name : `${m.name} · ${outletName.get(m.outlet_id) ?? ""}`,
              })),
            ],
          },
          {
            name: "style", label: t("filters.style"), type: "select", value: style ?? "",
            options: [
              { value: "", label: t("cost.allDrinks") },
              ...styles.map((s) => ({ value: s, label: tr(`style.${s}`) })),
            ],
          },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={mutedText}>
          {basis === "current" ? t("cost.currentExplain") : t("cost.snapshotExplain")}
        </p>
        <ExportButtons csv={csv} filename="cost-report.csv" />
      </div>

      {rows.length === 0 ? (
        <p className={`${cardClass} text-sm`}>{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <details className={`${cardClass} group`}>
                <summary className="flex cursor-pointer list-none flex-col gap-3 md:flex-row md:items-center">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">
                      {row.name} <span className="font-normal text-[#3d3f3a]">V{row.versionNo}</span>
                    </span>
                    <span className={mutedText}>
                      {[row.outlet, row.style && tr(`style.${row.style}`)].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4 md:w-[460px]">
                    <div>
                      <dt className={mutedText}>{t("columns.cost")}</dt>
                      <dd className={row.totalCost === null ? "font-semibold text-[#c4161c]" : "font-semibold"}>
                        {row.totalCost === null ? t("cost.incomplete") : money(row.totalCost)}
                      </dd>
                    </div>
                    <div>
                      <dt className={mutedText}>{t("columns.price")}</dt>
                      <dd className="font-semibold">{money(row.price)}</dd>
                    </div>
                    <div>
                      <dt className={mutedText}>{t("columns.margin")}</dt>
                      <dd className="font-semibold">{money(row.margin)}</dd>
                    </div>
                    <div>
                      <dt className={mutedText}>{t("columns.costRate")}</dt>
                      <dd className="font-semibold">{percent(row.costRate)}</dd>
                    </div>
                  </dl>
                  <span className="text-sm underline group-open:hidden print:hidden">{t("showLines")}</span>
                  <span className="hidden text-sm underline group-open:inline print:hidden">{t("hideLines")}</span>
                </summary>
                <div className="mt-3 flex flex-col gap-2 border-t border-black/10 pt-3">
                  {row.totalCost === null && (
                    <div className="flex flex-wrap gap-2">
                      {row.reasons.map((reason) => (
                        <StatusBadge key={reason} tone="red">
                          {t(`reasons.${reason}`)}
                        </StatusBadge>
                      ))}
                    </div>
                  )}
                  {row.calculatedAt && (
                    <p className={mutedText}>{t("cost.snapshotAt", { date: dateTime(row.calculatedAt) })}</p>
                  )}
                  <CostLines lines={row.lines} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
