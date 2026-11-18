import { getTranslations, setRequestLocale } from "next-intl/server";
import { CalibrationBoard } from "@/components/calibration/CalibrationBoard";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { addDays, isIsoDate, malaysiaToday } from "@/lib/calibration/dates";
import { createClient } from "@/lib/supabase/server";

const RECORD_COLUMNS = `id, coffee_bean_material_id, grinder_id, espresso_machine_id, dose_g, yield_g,
  extraction_time_seconds, grind_setting, water_temp_c, pressure_bar, preinfusion_seconds, basket_g,
  tds_percent, roast_date, taste_balance, taste_notes, deleted_at, delete_reason, updated_at, revision`;

export default async function CalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; date?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Calibration");
  const user = await getCurrentUser();
  if (!user) return null;
  const query = await searchParams;

  const today = malaysiaToday();
  const outlet = user.outlets.find((o) => o.id === query.outlet) ?? user.outlets[0];
  const date = isIsoDate(query.date) && query.date <= today ? query.date : today;
  const canManage = user.role !== "BARISTA";
  // Barista: today only. Manager/Admin: the last 7 days (O13).
  const editable = canManage ? date >= addDays(today, -7) : date === today;

  const supabase = await createClient();
  const outletId = outlet?.id ?? "00000000-0000-0000-0000-000000000000";
  const [
    { data: beans },
    { data: targets },
    { data: grinders },
    { data: machines },
    { data: records },
    { data: previous },
    { data: shots },
  ] = await Promise.all([
    supabase.from("materials").select("id, name, brand").eq("is_coffee_bean", true).eq("status", "APPROVED").order("name"),
    supabase.from("coffee_bean_targets").select("*"),
    supabase.from("grinders").select("id, name, brand, model, scale_type, scale_min, scale_max, is_active").eq("outlet_id", outletId).order("name"),
    supabase
      .from("espresso_machines")
      .select("id, name, brand, model, default_water_temp_c, default_pressure_bar, is_active")
      .eq("outlet_id", outletId)
      .order("name"),
    supabase.from("calibrations").select(RECORD_COLUMNS).eq("outlet_id", outletId).eq("business_date", date),
    // The day before, for "Use yesterday's values".
    supabase
      .from("calibrations")
      .select(RECORD_COLUMNS)
      .eq("outlet_id", outletId)
      .eq("business_date", addDays(date, -1))
      .is("deleted_at", null),
    supabase
      .from("calibration_shots")
      .select(
        `id, coffee_bean_material_id, grinder_id, espresso_machine_id, dose_g, yield_g, extraction_time_seconds,
         grind_setting, water_temp_c, pressure_bar, preinfusion_seconds, basket_g, tds_percent, taste_balance,
         taste_notes, created_at`,
      )
      .eq("outlet_id", outletId)
      .eq("business_date", date)
      .order("created_at"),
  ]);

  const recordIds = (records ?? []).map((r) => r.id);
  const { data: surveys } = recordIds.length
    ? await supabase
        .from("tasting_surveys")
        .select("id, calibration_id, token, serves_espresso, serves_milk, milk_espresso_g, milk_ml, closes_at, closed_at, max_responses, revision")
        .in("calibration_id", recordIds)
    : { data: [] };
  const surveyIds = (surveys ?? []).map((s) => s.id);
  const { data: responses } = surveyIds.length
    ? await supabase
        .from("tasting_responses")
        .select("id, survey_id, drink, visual, taste_balance, tactile, flavor, flavor_tags, milk_amount, comment, hidden, created_at")
        .in("survey_id", surveyIds)
        .order("created_at")
    : { data: [] };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={t("note")} />
      {!outlet ? (
        <p className="rounded-[20px] bg-white p-6 text-sm">{t("noOutlet")}</p>
      ) : (
        <CalibrationBoard
          key={`${outlet.id}-${date}`}
          outlets={user.outlets}
          outletId={outlet.id}
          date={date}
          today={today}
          editable={editable}
          canManage={canManage}
          beans={(beans ?? []).map((bean) => ({
            id: bean.id,
            name: bean.brand ? `${bean.name} · ${bean.brand}` : bean.name,
          }))}
          targets={targets ?? []}
          grinders={grinders ?? []}
          machines={machines ?? []}
          records={records ?? []}
          previous={previous ?? []}
          shots={shots ?? []}
          surveys={surveys ?? []}
          responses={responses ?? []}
        />
      )}
    </div>
  );
}
