// Server-side loading shared by the Calibration table and the New calibration page.
import type { createClient } from "@/lib/supabase/server";
import type { FilterRecord } from "./filter/types";
import type { CalibrationRecord, FinalUse } from "./types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const FINAL_BASE = "id, purpose, outlet_id, business_date, created_by, created_at, roast_date, production_no, deleted_at, delete_reason, revision";
export const ESPRESSO_VALUES = `coffee_bean_material_id, grinder_id, grinder_name, espresso_machine_id, machine_name,
  grind_setting, grinder_rpm, water_temp_c, pressure_bar, preinfusion_seconds, basket_g,
  dose_g, yield_g, extraction_time_seconds, tds_percent, taste_balance, taste_notes`;
export const FILTER_VALUES = `coffee_bean_material_id, brewer_id, brewer_name, grinder_id, grinder_name, grind_setting, grinder_rpm,
  dose_g, water_g, water_temp_c, bloom_water_g, bloom_seconds, pour_count, total_time_seconds, beverage_g, tds_percent,
  taste_balance, taste_notes`;
export const ESPRESSO_COLUMNS = `${FINAL_BASE}, ${ESPRESSO_VALUES}`;
export const FILTER_COLUMNS = `${FINAL_BASE}, ${FILTER_VALUES}`;
export const SHOT_COLUMNS = `id, created_at, drink_type, ${ESPRESSO_VALUES}`;
export const BREW_COLUMNS = `id, created_at, temperature, ${FILTER_VALUES}`;
export const GRINDER_COLUMNS = "id, name, brand, model, scale_type, scale_min, scale_max, rpm_adjustable, rpm_min, rpm_max, is_active";
export const MACHINE_COLUMNS = "id, name, brand, model, default_water_temp_c, default_pressure_bar, is_active";
export const BREWER_COLUMNS = "id, name, brand, model, brewer_type, is_active";
export const NO_OUTLET = "00000000-0000-0000-0000-000000000000";

type EspressoRow = Omit<CalibrationRecord, "uses" | "purpose"> & { purpose: string };
type FilterRow = Omit<FilterRecord, "uses" | "purpose"> & { purpose: string };

/** Adds each record's ticked items (and which of them a newer Final replaced). */
export async function withUses(
  supabase: Supabase,
  espresso: EspressoRow[],
  filter: FilterRow[],
): Promise<{ espresso: CalibrationRecord[]; filter: FilterRecord[] }> {
  const espIds = espresso.map((r) => r.id);
  const filIds = filter.map((r) => r.id);
  const [{ data: drinks }, { data: temps }] = await Promise.all([
    espIds.length
      ? supabase.from("calibration_drinks").select("id, calibration_id, drink_type, superseded_by, superseded_at").in("calibration_id", espIds)
      : { data: [] },
    filIds.length
      ? supabase
          .from("filter_calibration_uses")
          .select("id, filter_calibration_id, temperature, superseded_by, superseded_at")
          .in("filter_calibration_id", filIds)
      : { data: [] },
  ]);
  const usesOf = new Map<string, FinalUse[]>();
  const add = (record: string, use: FinalUse) => usesOf.set(record, [...(usesOf.get(record) ?? []), use]);
  for (const d of drinks ?? []) add(d.calibration_id, { id: d.id, item: d.drink_type, superseded_by: d.superseded_by, superseded_at: d.superseded_at });
  for (const u of temps ?? [])
    add(u.filter_calibration_id, { id: u.id, item: u.temperature, superseded_by: u.superseded_by, superseded_at: u.superseded_at });
  return {
    espresso: espresso.map((r) => ({ ...r, purpose: r.purpose as CalibrationRecord["purpose"], uses: usesOf.get(r.id) ?? [] })),
    filter: filter.map((r) => ({ ...r, purpose: r.purpose as FilterRecord["purpose"], uses: usesOf.get(r.id) ?? [] })),
  };
}

/** A Final still counts when it is not deleted and at least one ticked item was not replaced. */
export const isCurrent = (r: { deleted_at: string | null; uses: FinalUse[] }) =>
  !r.deleted_at && r.uses.some((u) => !u.superseded_by);
