import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ExportButtons } from "@/components/reports/ExportButtons";
import { FilterForm } from "@/components/reports/FilterForm";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cardClass, mutedText } from "@/components/ui/styles";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { RECIPE_OUTLETS, coversOutlet, outletLabel } from "@/lib/recipes/outlets";
import { isIsoDate } from "@/lib/calibration/dates";
import { toCsv } from "@/lib/reports/csv";
import { loadApprovalSnapshots } from "@/lib/reports/data";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Enums = Database["public"]["Enums"];
const styles: Enums["beverage_style"][] = ["COFFEE", "TEA", "COCKTAIL", "MOCKTAIL", "PREP_MATERIAL"];
const purposes: Enums["recipe_purpose"][] = ["RND", "OFFICIAL_RELEASE"];
const statuses: Enums["approval_status"][] = ["DRAFT", "PENDING", "APPROVED", "RETURNED", "SUPERSEDED", "ARCHIVED"];
const tastes = [
  "sour", "sweet", "bitter", "salty", "umami", "spicy", "smoky", "zesty", "funky", "earthy", "oily",
] as const;

const statusTone = {
  DRAFT: "grey",
  PENDING: "purple",
  APPROVED: "green",
  RETURNED: "orange",
  SUPERSEDED: "grey",
  ARCHIVED: "grey",
} as const;

export default async function RndReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    outlet?: string; from?: string; to?: string; person?: string;
    style?: string; purpose?: string; status?: string;
  }>;
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
  const purpose = purposes.find((p) => p === query.purpose);
  const status = statuses.find((s) => s === query.status);
  const from = isIsoDate(query.from) ? query.from : "";
  const to = isIsoDate(query.to) ? query.to : "";
  const supabase = await createClient();

  const { data: people } = await supabase.rpc("report_version_people");
  const personName = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const person = personName.has(query.person ?? "") ? query.person : undefined;

  // Only recipes made for the caller's own outlets (ch. 5).
  const outletIds = outlet ? [outlet.id] : user.outlets.map((o) => o.id);
  const { data: allRecipes } = await supabase.from("recipes").select(`id, ${RECIPE_OUTLETS}`);
  const recipes = (allRecipes ?? []).filter((r) => outletIds.some((id) => coversOutlet(r, id)));
  const recipeOutlet = new Map(recipes.map((r) => [r.id, outletLabel(r, user.outlets, tr("allOutletsOption"))]));

  let versionQuery = supabase
    .from("recipe_versions")
    .select(
      `id, recipe_id, version_no, status, product_name, purpose, style, change_summary, tasting_notes,
       created_by, submitted_by, created_at, submitted_at, approved_at,
       taste_sour, taste_sweet, taste_bitter, taste_salty, taste_umami, taste_spicy,
       taste_smoky, taste_zesty, taste_funky, taste_earthy, taste_oily`,
    )
    .in("recipe_id", [...recipeOutlet.keys()])
    .order("created_at", { ascending: false });
  if (style) versionQuery = versionQuery.eq("style", style);
  if (purpose) versionQuery = versionQuery.eq("purpose", purpose);
  if (status) versionQuery = versionQuery.eq("status", status);
  const { data: allVersions } = recipeOutlet.size ? await versionQuery : { data: [] };

  // Created or submitted within the range (Malaysia dates).
  const myDate = (value: string | null) =>
    value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value)) : null;
  const inRange = (value: string | null) => {
    const d = myDate(value);
    return !!d && (!from || d >= from) && (!to || d <= to);
  };
  const versions = (allVersions ?? []).filter(
    (v) =>
      (!from && !to ? true : inRange(v.created_at) || inRange(v.submitted_at)) &&
      (!person || v.created_by === person || v.submitted_by === person),
  );

  // Approval snapshots for these versions and for earlier versions of the same
  // recipes, so each version can be compared with the one before it.
  const { data: siblings } = versions.length
    ? await supabase
        .from("recipe_versions")
        .select("id, recipe_id, version_no")
        .in("recipe_id", [...new Set(versions.map((v) => v.recipe_id))])
    : { data: [] };
  const snapshots = await loadApprovalSnapshots(supabase, (siblings ?? []).map((s) => s.id));
  const previousCost = (recipeId: string, versionNo: number) => {
    const earlier = (siblings ?? [])
      .filter((s) => s.recipe_id === recipeId && s.version_no < versionNo && snapshots.get(s.id)?.totalCost != null)
      .sort((a, b) => b.version_no - a.version_no)[0];
    return earlier ? { versionNo: earlier.version_no, cost: snapshots.get(earlier.id)!.totalCost! } : null;
  };

  const date = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur" }) : "—";
  const money = (value: number) => format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rows = versions.map((v) => {
    const cost = snapshots.get(v.id)?.totalCost ?? null;
    const previous = cost !== null ? previousCost(v.recipe_id, v.version_no) : null;
    const scores = tastes
      .map((key) => ({ key, value: v[`taste_${key}`] }))
      .filter((s): s is { key: (typeof tastes)[number]; value: number } => s.value !== null);
    return {
      ...v,
      outlet: recipeOutlet.get(v.recipe_id) ?? "",
      author: personName.get(v.created_by) ?? "—",
      cost,
      previous,
      change: previous && cost !== null ? cost - previous.cost : null,
      flavour: scores.length
        ? scores.map((s) => `${tr(`taste.${s.key}`)} ${s.value}`).join(" · ")
        : t("rnd.notAssessed"),
    };
  });

  const all = t("all");
  const select = (name: string, label: string, value: string, options: { value: string; label: string }[]) => ({
    name, label, type: "select" as const, value, options: [{ value: "", label: all }, ...options],
  });

  const csv = toCsv(
    [
      [t("csv.report"), t("rnd.title")],
      [t("csv.currency"), "MYR"],
      [t("csv.basis"), t("rnd.basis")],
      [
        t("csv.filters"),
        [
          `${t("filters.outlet")}: ${outlet?.name ?? all}`,
          `${t("filters.from")}: ${from || all}`,
          `${t("filters.to")}: ${to || all}`,
          `${t("filters.person")}: ${person ? personName.get(person) : all}`,
          `${t("filters.style")}: ${style ? tr(`style.${style}`) : all}`,
          `${t("filters.purpose")}: ${purpose ? tr(`purpose.${purpose}`) : all}`,
          `${t("filters.status")}: ${status ? tr(`status.${status}`) : all}`,
        ].join("; "),
      ],
      [t("csv.generatedAt"), format.dateTime(new Date(), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" })],
    ],
    [
      t("columns.recipe"), t("columns.version"), t("columns.outlet"), t("columns.status"), t("columns.purpose"),
      t("columns.style"), t("columns.author"), t("columns.created"), t("columns.submitted"), t("columns.approved"),
      t("columns.changeSummary"), t("columns.tastingNotes"), t("columns.flavour"),
      t("columns.approvalCost"), t("columns.costChange"),
    ],
    rows.map((r) => [
      r.product_name ?? "", `V${r.version_no}`, r.outlet, tr(`status.${r.status}`), tr(`purpose.${r.purpose}`),
      r.style ? tr(`style.${r.style}`) : "", r.author, myDate(r.created_at), myDate(r.submitted_at),
      myDate(r.approved_at), r.change_summary ?? "", r.tasting_notes ?? "", r.flavour,
      r.cost === null ? "" : r.cost.toFixed(2),
      r.change === null ? "" : `${r.change >= 0 ? "+" : ""}${r.change.toFixed(2)} (vs V${r.previous!.versionNo})`,
    ]),
  );

  return (
    <div className="flex flex-col gap-6">
      <ReportHeader title={t("rnd.title")} note={t("rnd.note")} />
      <FilterForm
        filters={[
          select("outlet", t("filters.outlet"), outlet?.id ?? "", user.outlets.map((o) => ({ value: o.id, label: o.name }))),
          { name: "from", label: t("filters.from"), type: "date", value: from },
          { name: "to", label: t("filters.to"), type: "date", value: to },
          select("person", t("filters.person"), person ?? "", (people ?? []).map((p) => ({ value: p.id, label: p.full_name }))),
          select("style", t("filters.style"), style ?? "", styles.map((s) => ({ value: s, label: tr(`style.${s}`) }))),
          select("purpose", t("filters.purpose"), purpose ?? "", purposes.map((p) => ({ value: p, label: tr(`purpose.${p}`) }))),
          select("status", t("filters.status"), status ?? "", statuses.map((s) => ({ value: s, label: tr(`status.${s}`) }))),
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={mutedText}>{t("rnd.costExplain")}</p>
        <ExportButtons csv={csv} filename="rnd-report.csv" />
      </div>

      {rows.length === 0 ? (
        <p className={`${cardClass} text-sm`}>{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id} className={`${cardClass} flex flex-col gap-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">
                  {r.product_name ?? "—"} <span className="font-normal text-[#3d3f3a]">V{r.version_no}</span>
                </span>
                <StatusBadge tone={statusTone[r.status]}>{tr(`status.${r.status}`)}</StatusBadge>
                <StatusBadge tone="grey">{tr(`purpose.${r.purpose}`)}</StatusBadge>
              </div>
              <p className={mutedText}>
                {[r.outlet, r.style && tr(`style.${r.style}`), r.author].filter(Boolean).join(" · ")}
              </p>
              <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className={mutedText}>{t("columns.created")}</dt>
                  <dd>{date(r.created_at)}</dd>
                </div>
                <div>
                  <dt className={mutedText}>{t("columns.submitted")}</dt>
                  <dd>{date(r.submitted_at)}</dd>
                </div>
                <div>
                  <dt className={mutedText}>{t("columns.approved")}</dt>
                  <dd>{date(r.approved_at)}</dd>
                </div>
              </dl>
              {r.change_summary && (
                <p className="text-sm">
                  <span className="font-semibold">{t("columns.changeSummary")}：</span>
                  {r.change_summary}
                </p>
              )}
              {r.tasting_notes && (
                <p className="text-sm">
                  <span className="font-semibold">{t("columns.tastingNotes")}：</span>
                  {r.tasting_notes}
                </p>
              )}
              <p className="text-sm">
                <span className="font-semibold">{t("columns.flavour")}：</span>
                {r.flavour}
              </p>
              <p className="text-sm">
                <span className="font-semibold">{t("columns.approvalCost")}：</span>
                {r.cost === null ? t("rnd.noSnapshot") : `MYR ${money(r.cost)}`}
                {r.change !== null && (
                  <span className={r.change > 0 ? "font-semibold text-[#c4161c]" : "font-semibold"}>
                    {" "}
                    ({r.change >= 0 ? "+" : ""}
                    {money(r.change)} {t("rnd.vsVersion", { version: r.previous!.versionNo })})
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
