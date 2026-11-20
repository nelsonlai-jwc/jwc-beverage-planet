export type TasteBalance = "SOUR" | "BALANCED" | "BITTER";

/** DAILY: the outlet's record. CUSTOM: a personal record (creator and Super Admin only). */
export type Purpose = "DAILY" | "CUSTOM";

export type DrinkType = "BLACK_HOT" | "BLACK_ICED" | "MILK_HOT" | "MILK_ICED";
export const DRINK_TYPES: DrinkType[] = ["BLACK_HOT", "BLACK_ICED", "MILK_HOT", "MILK_ICED"];

/** Espresso extraction values of a Final or a test shot. */
export type EspressoValues = {
  dose_g: number;
  yield_g: number;
  extraction_time_seconds: number;
  tds_percent: number | null;
  taste_balance: string | null;
  taste_notes: string | null;
};

/** Grinder and machine settings of a Final or a test shot. */
export type SharedValues = {
  coffee_bean_material_id: string;
  grinder_id: string | null;
  grinder_name: string | null;
  espresso_machine_id: string | null;
  machine_name: string | null;
  grind_setting: string;
  grinder_rpm: number | null;
  water_temp_c: number | null;
  pressure_bar: number | null;
  preinfusion_seconds: number | null;
  basket_g: number | null;
};

/** One ticked item of a Final (a drink type, or Hot / Iced for filter); superseded when a newer Final took it. */
export type FinalUse = { id: string; item: string; superseded_by: string | null; superseded_at: string | null };

/** Fields every Final has, espresso or filter. */
export type FinalBase = {
  id: string;
  purpose: Purpose;
  outlet_id: string | null;
  business_date: string;
  created_by: string;
  created_at: string;
  roast_date: string | null;
  production_no: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  revision: number;
  uses: FinalUse[];
};

export type CalibrationRecord = SharedValues & EspressoValues & FinalBase;

export type CalibrationShot = SharedValues & EspressoValues & { id: string; created_at: string };

/** Production number of a bag, e.g. PR-47481. */
export const PRODUCTION_NO = /^PR-\d{5}$/;

export type Bean = { id: string; name: string; brand: string | null };

export type BeanTarget = {
  material_id: string;
  drink_type: string;
  dose_min_g: number;
  dose_max_g: number;
  yield_min_g: number;
  yield_max_g: number;
  time_min_seconds: number;
  time_max_seconds: number;
  revision: number;
};

export type Grinder = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  scale_type: string;
  scale_min: number | null;
  scale_max: number | null;
  rpm_adjustable: boolean;
  rpm_min: number | null;
  rpm_max: number | null;
  is_active: boolean;
};

export type Machine = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  default_water_temp_c: number | null;
  default_pressure_bar: number | null;
  is_active: boolean;
};

/** Speed check for a grinder with adjustable RPM: blank is fine, else a whole number in range. */
export function rpmProblem(grinder: Grinder | undefined, value: string): boolean {
  if (!grinder?.rpm_adjustable || grinder.rpm_min == null || grinder.rpm_max == null || !value.trim()) return false;
  const n = Number(value);
  return !Number.isInteger(n) || n < grinder.rpm_min || n > grinder.rpm_max;
}

/** Name of a record's grinder, machine or brewer: a Settings item or a typed-in name. */
export function equipmentName(id: string | null, typed: string | null, names: Map<string, string>): string {
  return id ? (names.get(id) ?? "—") : (typed ?? "—");
}
