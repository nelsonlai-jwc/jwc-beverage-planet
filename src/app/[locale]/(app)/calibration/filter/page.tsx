import { getTranslations, setRequestLocale } from "next-intl/server";
import { FilterBoard } from "@/components/calibration/filter/FilterBoard";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { addDays, isIsoDate, malaysiaToday } from "@/lib/calibration/dates";
import { createClient } from "@/lib/supabase/server";

const VALUE_COLUMNS = `coffee_bean_material_id, brewer_id, grinder_id, grind_setting, dose_g, water_g, water_temp_c,
  bloom_water_g, bloom_seconds, pour_count, total_time_seconds, beverage_g, tds_percent, taste_balance, taste_notes`;
const RECORD_COLUMNS = `id, ${VALUE_COLUMNS}, roast_date, deleted_at, delete_reason, updated_at, revision`;

export default async function FilterCalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; date?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("FilterCalibration");
  const tc = await getTranslations("Calibration");
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
    { data: brewers },
    { data: records },
    { data: previous },
    { data: brews },
  ] = await Promise.all([
    supabase.from("materials").select("id, name, brand").eq("is_coffee_bean", true).eq("status", "APPROVED").order("name"),
    supabase.from("coffee_bean_filter_targets").select("*"),
    supabase.from("grinders").select("id, name, brand, model, scale_type, scale_min, scale_max, is_active").eq("outlet_id", outletId).order("name"),
    supabase.from("brewers").select("id, name, brand, model, brewer_type, is_active").eq("outlet_id", outletId).order("name"),
    supabase.from("filter_calibrations").select(RECORD_COLUMNS).eq("outlet_id", outletId).eq("business_date", date),
    // The day before, for "Use yesterday's values".
    supabase
      .from("filter_calibrations")
      .select(RECORD_COLUMNS)
      .eq("outlet_id", outletId)
      .eq("business_date", addDays(date, -1))
      .is("deleted_at", null),
    supabase
      .from("filter_calibration_brews")
      .select(`id, ${VALUE_COLUMNS}, created_at`)
      .eq("outlet_id", outletId)
      .eq("business_date", date)
      .order("created_at"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={t("note")} />
      {!outlet ? (
        <p className="rounded-[20px] bg-white p-6 text-sm">{tc("noOutlet")}</p>
      ) : (
        <FilterBoard
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
          brewers={brewers ?? []}
          records={records ?? []}
          previous={previous ?? []}
          brews={brews ?? []}
        />
      )}
    </div>
  );
}
