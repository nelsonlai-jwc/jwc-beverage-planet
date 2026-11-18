import { getTranslations } from "next-intl/server";
import { CalibrationBoard } from "@/components/calibration/CalibrationBoard";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { addDays, isIsoDate, malaysiaToday } from "@/lib/calibration/dates";
import { createClient } from "@/lib/supabase/server";
import type { CalibrationRecord, DrinkValues, Purpose } from "./types";

const RECORD_COLUMNS = `id, business_date, created_by, coffee_bean_material_id, grinder_id, grinder_name,
  espresso_machine_id, machine_name, grind_setting, water_temp_c, pressure_bar, preinfusion_seconds, basket_g,
  roast_date, deleted_at, delete_reason, updated_at, revision`;
const SHOT_COLUMNS = `id, coffee_bean_material_id, grinder_id, grinder_name, espresso_machine_id, machine_name,
  drink_type, dose_g, yield_g, extraction_time_seconds, grind_setting, water_temp_c, pressure_bar,
  preinfusion_seconds, basket_g, tds_percent, taste_balance, taste_notes, created_at`;
const GRINDER_COLUMNS = "id, outlet_id, name, brand, model, scale_type, scale_min, scale_max, is_active";
const MACHINE_COLUMNS = "id, outlet_id, name, brand, model, default_water_temp_c, default_pressure_bar, is_active";
const NO_OUTLET = "00000000-0000-0000-0000-000000000000";

/** Espresso Calibration, Daily (outlet records) or Custom (personal records). */
export async function EspressoCalibrationPage({
  purpose,
  searchParams,
}: {
  purpose: Purpose;
  searchParams: { outlet?: string; date?: string };
}) {
  const t = await getTranslations("Calibration");
  const user = await getCurrentUser();
  if (!user) return null;
  const custom = purpose === "CUSTOM";

  const today = malaysiaToday();
  const outlet = custom ? null : (user.outlets.find((o) => o.id === searchParams.outlet) ?? user.outlets[0]);
  const date = isIsoDate(searchParams.date) && searchParams.date <= today ? searchParams.date : today;
  const canManage = user.role !== "BARISTA";
  // Daily: Barista today only, Manager/Admin the last 7 days (O13). Custom: any date.
  const editable = custom || (canManage ? date >= addDays(today, -7) : date === today);

  const supabase = await createClient();
  const outletId = outlet?.id ?? NO_OUTLET;
  const records = supabase.from("calibrations").select(RECORD_COLUMNS);
  const shotRows = supabase.from("calibration_shots").select(SHOT_COLUMNS);
  const [
    { data: beans },
    { data: targets },
    { data: grinders },
    { data: machines },
    { data: outlets },
    { data: rows },
    { data: previousRows },
    { data: shots },
  ] = await Promise.all([
    supabase.from("materials").select("id, name, brand").eq("is_coffee_bean", true).eq("status", "APPROVED").order("name"),
    supabase.from("coffee_bean_targets").select("*"),
    custom
      ? supabase.from("grinders").select(GRINDER_COLUMNS).order("name")
      : supabase.from("grinders").select(GRINDER_COLUMNS).eq("outlet_id", outletId).order("name"),
    custom
      ? supabase.from("espresso_machines").select(MACHINE_COLUMNS).order("name")
      : supabase.from("espresso_machines").select(MACHINE_COLUMNS).eq("outlet_id", outletId).order("name"),
    supabase.from("outlets").select("id, name"),
    custom
      ? records.eq("purpose", "CUSTOM").eq("business_date", date).order("created_at")
      : records.eq("purpose", "DAILY").eq("outlet_id", outletId).eq("business_date", date),
    // Values to reuse: yesterday's daily records, or my latest custom record of each bean.
    custom
      ? supabase
          .from("calibrations")
          .select(RECORD_COLUMNS)
          .eq("purpose", "CUSTOM")
          .eq("created_by", user.id)
          .lt("business_date", date)
          .is("deleted_at", null)
          .order("business_date", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(100)
      : supabase
          .from("calibrations")
          .select(RECORD_COLUMNS)
          .eq("purpose", "DAILY")
          .eq("outlet_id", outletId)
          .eq("business_date", addDays(date, -1))
          .is("deleted_at", null),
    custom
      ? shotRows.eq("purpose", "CUSTOM").eq("created_by", user.id).eq("business_date", date).order("created_at")
      : shotRows.eq("purpose", "DAILY").eq("outlet_id", outletId).eq("business_date", date).order("created_at"),
  ]);

  const recordIds = [...(rows ?? []), ...(previousRows ?? [])].map((r) => r.id);
  const { data: drinkRows } = recordIds.length
    ? await supabase
        .from("calibration_drinks")
        .select("calibration_id, drink_type, dose_g, yield_g, extraction_time_seconds, tds_percent, taste_balance, taste_notes")
        .in("calibration_id", recordIds)
    : { data: [] };
  const drinksOf = new Map<string, DrinkValues[]>();
  for (const { calibration_id, ...d } of drinkRows ?? []) {
    drinksOf.set(calibration_id, [...(drinksOf.get(calibration_id) ?? []), d]);
  }
  const withDrinks = (list: typeof rows): CalibrationRecord[] =>
    (list ?? []).map((r) => ({ ...r, drinks: drinksOf.get(r.id) ?? [] }));

  const todayIds = (rows ?? []).map((r) => r.id);
  const { data: surveys } =
    !custom && todayIds.length
      ? await supabase
          .from("tasting_surveys")
          .select("id, calibration_id, token, serves_espresso, serves_milk, milk_espresso_g, milk_ml, closes_at, closed_at, max_responses, revision")
          .in("calibration_id", todayIds)
      : { data: [] };
  const surveyIds = (surveys ?? []).map((s) => s.id);
  const { data: responses } = surveyIds.length
    ? await supabase
        .from("tasting_responses")
        .select("id, survey_id, drink, visual, taste_balance, tactile, flavor, flavor_tags, milk_amount, comment, hidden, created_at")
        .in("survey_id", surveyIds)
        .order("created_at")
    : { data: [] };

  // Custom: equipment of every outlet, so the outlet goes in the name.
  const outletNames = new Map((outlets ?? []).map((o) => [o.id, o.name]));
  const named = <T extends { name: string; outlet_id: string }>(list: T[] | null) =>
    (list ?? []).map((x) => (custom ? { ...x, name: `${x.name} · ${outletNames.get(x.outlet_id) ?? "—"}` } : x));

  const creators = custom ? [...new Set((rows ?? []).map((r) => r.created_by).filter((id) => id !== user.id))] : [];
  const { data: people } = creators.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", creators)
    : { data: [] };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={custom ? t("customTitle") : t("title")} note={custom ? t("customNote") : t("note")} />
      {!custom && !outlet ? (
        <p className="rounded-[20px] bg-white p-6 text-sm">{t("noOutlet")}</p>
      ) : (
        <CalibrationBoard
          key={`${outlet?.id ?? "custom"}-${date}`}
          purpose={purpose}
          userId={user.id}
          outlets={user.outlets}
          outletId={outlet?.id ?? null}
          date={date}
          today={today}
          editable={editable}
          canManage={canManage}
          beans={(beans ?? []).map((bean) => ({
            id: bean.id,
            name: bean.brand ? `${bean.name} · ${bean.brand}` : bean.name,
          }))}
          targets={targets ?? []}
          grinders={named(grinders)}
          machines={named(machines)}
          records={withDrinks(rows)}
          previous={withDrinks(previousRows)}
          shots={shots ?? []}
          surveys={surveys ?? []}
          responses={responses ?? []}
          creatorNames={new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]))}
        />
      )}
    </div>
  );
}
