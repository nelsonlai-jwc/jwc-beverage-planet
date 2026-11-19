import { getTranslations } from "next-intl/server";
import { FilterBoard } from "@/components/calibration/filter/FilterBoard";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { addDays, isIsoDate, malaysiaToday } from "@/lib/calibration/dates";
import { createClient } from "@/lib/supabase/server";
import type { Purpose } from "../types";

const VALUE_COLUMNS = `coffee_bean_material_id, brewer_id, brewer_name, grinder_id, grinder_name, grind_setting, dose_g,
  water_g, water_temp_c, bloom_water_g, bloom_seconds, pour_count, total_time_seconds, beverage_g, tds_percent,
  taste_balance, taste_notes`;
const RECORD_COLUMNS = `id, business_date, created_by, ${VALUE_COLUMNS}, roast_date, deleted_at, delete_reason, updated_at, revision`;
const NO_OUTLET = "00000000-0000-0000-0000-000000000000";

/** Filter Calibration, Daily (outlet records) or Custom (personal records). */
export async function FilterCalibrationPage({
  purpose,
  searchParams,
}: {
  purpose: Purpose;
  searchParams: { outlet?: string; date?: string };
}) {
  const t = await getTranslations("FilterCalibration");
  const tc = await getTranslations("Calibration");
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
  const grinderColumns = "id, name, brand, model, scale_type, scale_min, scale_max, is_active";
  const brewerColumns = "id, name, brand, model, brewer_type, is_active";
  const [
    { data: beans },
    { data: targets },
    { data: grinders },
    { data: brewers },
    { data: outletEquipment },
    { data: records },
    { data: previous },
    { data: brews },
  ] = await Promise.all([
    supabase.from("materials").select("id, name, brand").eq("is_coffee_bean", true).eq("status", "APPROVED").order("name"),
    supabase.from("coffee_bean_filter_targets").select("*"),
    supabase.from("grinders").select(grinderColumns).order("name"),
    supabase.from("brewers").select(brewerColumns).order("name"),
    supabase.from("outlet_equipment").select("grinder_id, espresso_machine_id, brewer_id").eq("outlet_id", outletId),
    custom
      ? supabase.from("filter_calibrations").select(RECORD_COLUMNS).eq("purpose", "CUSTOM").eq("business_date", date).order("created_at")
      : supabase
          .from("filter_calibrations")
          .select(RECORD_COLUMNS)
          .eq("purpose", "DAILY")
          .eq("outlet_id", outletId)
          .eq("business_date", date),
    // Values to reuse: yesterday's daily records, or my latest custom record of each bean.
    custom
      ? supabase
          .from("filter_calibrations")
          .select(RECORD_COLUMNS)
          .eq("purpose", "CUSTOM")
          .eq("created_by", user.id)
          .lt("business_date", date)
          .is("deleted_at", null)
          .order("business_date", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(100)
      : supabase
          .from("filter_calibrations")
          .select(RECORD_COLUMNS)
          .eq("purpose", "DAILY")
          .eq("outlet_id", outletId)
          .eq("business_date", addDays(date, -1))
          .is("deleted_at", null),
    custom
      ? supabase
          .from("filter_calibration_brews")
          .select(`id, ${VALUE_COLUMNS}, created_at`)
          .eq("purpose", "CUSTOM")
          .eq("created_by", user.id)
          .eq("business_date", date)
          .order("created_at")
      : supabase
          .from("filter_calibration_brews")
          .select(`id, ${VALUE_COLUMNS}, created_at`)
          .eq("purpose", "DAILY")
          .eq("outlet_id", outletId)
          .eq("business_date", date)
          .order("created_at"),
  ]);

  // Custom: any equipment. Daily: only what the outlet uses (Outlet Equipment) can be chosen;
  // the rest stays in the list, like disabled equipment, so older records keep their names.
  const usedIds = new Set(
    (outletEquipment ?? []).flatMap((e) => [e.grinder_id, e.espresso_machine_id, e.brewer_id].filter(Boolean)),
  );
  const usable = <T extends { id: string; is_active: boolean }>(list: T[] | null) =>
    (list ?? []).map((x) => (custom ? x : { ...x, is_active: x.is_active && usedIds.has(x.id) }));

  const creators = custom ? [...new Set((records ?? []).map((r) => r.created_by).filter((id) => id !== user.id))] : [];
  const { data: people } = creators.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", creators)
    : { data: [] };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={custom ? t("customTitle") : t("title")} note={custom ? tc("customNote") : t("note")} />
      {!custom && !outlet ? (
        <p className="rounded-[20px] bg-white p-6 text-sm">{tc("noOutlet")}</p>
      ) : (
        <FilterBoard
          key={`${outlet?.id ?? "custom"}-${date}`}
          purpose={purpose}
          userId={user.id}
          creatorNames={new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]))}
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
          grinders={usable(grinders)}
          brewers={usable(brewers)}
          records={records ?? []}
          previous={previous ?? []}
          brews={brews ?? []}
        />
      )}
    </div>
  );
}
