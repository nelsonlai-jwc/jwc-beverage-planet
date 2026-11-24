import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewSurveyForm, type RecordOption, type RecipeOption } from "@/components/surveys/NewSurveyForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { addDays, malaysiaToday } from "@/lib/calibration/dates";
import { createClient } from "@/lib/supabase/server";
import { ESPRESSO_DRINKS, type SurveyDrink } from "@/lib/tasting/scale";

const NO_OUTLET = "00000000-0000-0000-0000-000000000000";
const DAILY_DAYS = 14;
const CUSTOM_DAYS = 60;

/** New survey (Admin / Manager): subject, who answers, closing time. */
export default async function NewSurveyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Surveys");
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role === "BARISTA") {
    return <p className="rounded-[20px] bg-white p-6 text-sm">{t("noPermission")}</p>;
  }

  const supabase = await createClient();
  const today = malaysiaToday();
  const outletIds = user.outlets.length ? user.outlets.map((o) => o.id) : [NO_OUTLET];
  const outletName = new Map(user.outlets.map((o) => [o.id, o.name]));
  const COLS = "id, session_id, created_at, business_date, purpose, outlet_id, coffee_bean_material_id, grinder_id, grinder_name";

  const [espDaily, espCustom, filDaily, filCustom, { data: recipes }] = await Promise.all([
    supabase
      .from("calibrations")
      .select(COLS)
      .eq("purpose", "DAILY")
      .in("outlet_id", outletIds)
      .gte("business_date", addDays(today, -DAILY_DAYS))
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("calibrations")
      .select(COLS)
      .eq("purpose", "CUSTOM")
      .eq("created_by", user.id)
      .gte("business_date", addDays(today, -CUSTOM_DAYS))
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("filter_calibrations")
      .select(`${COLS}, brewer_id, brewer_name`)
      .eq("purpose", "DAILY")
      .in("outlet_id", outletIds)
      .gte("business_date", addDays(today, -DAILY_DAYS))
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("filter_calibrations")
      .select(`${COLS}, brewer_id, brewer_name`)
      .eq("purpose", "CUSTOM")
      .eq("created_by", user.id)
      .gte("business_date", addDays(today, -CUSTOM_DAYS))
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("recipes")
      .select("id, all_outlets, current_approved_version_id, recipe_outlets(outlet_id)")
      .eq("status", "ACTIVE")
      .eq("is_prep", false)
      .not("current_approved_version_id", "is", null),
  ]);

  // Each drink tab of one save is its own record; offer one option per save (its first record).
  const firstOfSave = <T extends { session_id: string }>(rows: T[]) => {
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.session_id) && !!seen.add(r.session_id));
  };
  const espAll = [...(espDaily.data ?? []), ...(espCustom.data ?? [])];
  const espresso = firstOfSave(espAll);
  const filter = firstOfSave([...(filDaily.data ?? []), ...(filCustom.data ?? [])]);
  const saveOf = new Map(espAll.map((r) => [r.id, r.session_id]));
  const beanIds = [...new Set([...espresso, ...filter].map((r) => r.coffee_bean_material_id))];
  const grinderIds = [...new Set([...espresso, ...filter].flatMap((r) => (r.grinder_id ? [r.grinder_id] : [])))];
  const brewerIds = [...new Set(filter.flatMap((r) => (r.brewer_id ? [r.brewer_id] : [])))];
  const versionIds = (recipes ?? []).flatMap((r) => (r.current_approved_version_id ? [r.current_approved_version_id] : []));
  const espIds = espAll.map((r) => r.id);

  const [{ data: beans }, { data: grinders }, { data: brewers }, { data: versions }, { data: drinks }] =
    await Promise.all([
      beanIds.length ? supabase.from("materials").select("id, name, brand").in("id", beanIds) : { data: [] },
      grinderIds.length ? supabase.from("grinders").select("id, name").in("id", grinderIds) : { data: [] },
      brewerIds.length ? supabase.from("brewers").select("id, name").in("id", brewerIds) : { data: [] },
      versionIds.length
        ? supabase.from("recipe_versions").select("id, product_name, temperature").in("id", versionIds)
        : { data: [] },
      espIds.length
        ? supabase.from("calibration_drinks").select("calibration_id, drink_type").in("calibration_id", espIds)
        : { data: [] },
    ]);

  const beanName = new Map((beans ?? []).map((b) => [b.id, b.brand ? `${b.name} · ${b.brand}` : b.name]));
  const grinderName = new Map((grinders ?? []).map((g) => [g.id, g.name]));
  const brewerName = new Map((brewers ?? []).map((b) => [b.id, b.name]));
  const custom = t("customRecord");

  const option = (
    r: (typeof espresso)[number],
    equipment: string,
    drinkTypes: SurveyDrink[],
  ): RecordOption => ({
    id: r.id,
    outletId: r.purpose === "DAILY" ? r.outlet_id : null,
    label: [
      `${r.business_date} ${new Date(r.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" })}`,
      beanName.get(r.coffee_bean_material_id) ?? "—",
      equipment,
      r.purpose === "DAILY" ? (outletName.get(r.outlet_id ?? "") ?? "—") : custom,
    ].join(" · "),
    drinks: drinkTypes,
  });

  const espressoOptions = espresso.map((r) =>
    option(
      r,
      (r.grinder_id ? grinderName.get(r.grinder_id) : r.grinder_name) ?? "—",
      ESPRESSO_DRINKS.filter((d) =>
        (drinks ?? []).some((x) => saveOf.get(x.calibration_id) === r.session_id && x.drink_type === d),
      ),
    ),
  );
  const filterOptions = filter.map((r) =>
    option(r, (r.brewer_id ? brewerName.get(r.brewer_id) : r.brewer_name) ?? "—", ["FILTER"]),
  );
  const versionOf = new Map((versions ?? []).map((v) => [v.id, v]));
  const recipeOptions: RecipeOption[] = (recipes ?? []).flatMap((r) => {
    const v = versionOf.get(r.current_approved_version_id ?? "");
    if (!v) return [];
    return [
      {
        id: r.id,
        name: v.product_name ?? "—",
        temperature: v.temperature,
        outletIds: r.all_outlets ? null : r.recipe_outlets.map((o) => o.outlet_id),
      },
    ];
  });
  recipeOptions.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("newTitle")} note={t("newNote")} />
      <NewSurveyForm
        outlets={user.outlets}
        espresso={espressoOptions}
        filter={filterOptions}
        recipes={recipeOptions}
      />
    </div>
  );
}
