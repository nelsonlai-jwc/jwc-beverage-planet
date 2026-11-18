export type TasteBalance = "SOUR" | "BALANCED" | "BITTER";

/** DAILY: the outlet's record. CUSTOM: a personal record (creator and Super Admin only). */
export type Purpose = "DAILY" | "CUSTOM";

export type DrinkType = "BLACK_HOT" | "BLACK_ICED" | "MILK_HOT" | "MILK_ICED";
export const DRINK_TYPES: DrinkType[] = ["BLACK_HOT", "BLACK_ICED", "MILK_HOT", "MILK_ICED"];

/** Extraction values of one drink type. */
export type DrinkValues = {
  drink_type: string;
  dose_g: number;
  yield_g: number;
  extraction_time_seconds: number;
  tds_percent: number | null;
  taste_balance: string | null;
  taste_notes: string | null;
};

/** Grinder and machine settings shared by every drink of a record. */
export type SharedValues = {
  coffee_bean_material_id: string;
  grinder_id: string | null;
  grinder_name: string | null;
  espresso_machine_id: string | null;
  machine_name: string | null;
  grind_setting: string;
  water_temp_c: number | null;
  pressure_bar: number | null;
  preinfusion_seconds: number | null;
  basket_g: number | null;
};

export type CalibrationRecord = SharedValues & {
  id: string;
  business_date: string;
  created_by: string;
  roast_date: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  updated_at: string;
  revision: number;
  drinks: DrinkValues[];
};

export type CalibrationShot = SharedValues & DrinkValues & { id: string; created_at: string };

export type Bean = { id: string; name: string };

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

/** Name of a record's grinder, machine or brewer: a Settings item or a typed-in name. */
export function equipmentName(id: string | null, typed: string | null, names: Map<string, string>): string {
  return id ? (names.get(id) ?? "—") : (typed ?? "—");
}
