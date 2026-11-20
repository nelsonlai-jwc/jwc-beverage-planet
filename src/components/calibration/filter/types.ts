import type { FinalBase } from "../types";

export type FilterValues = {
  coffee_bean_material_id: string;
  brewer_id: string | null;
  brewer_name: string | null;
  grinder_id: string | null;
  grinder_name: string | null;
  grind_setting: string;
  grinder_rpm: number | null;
  dose_g: number;
  water_g: number;
  water_temp_c: number | null;
  bloom_water_g: number | null;
  bloom_seconds: number | null;
  pour_count: number | null;
  total_time_seconds: number;
  beverage_g: number | null;
  tds_percent: number | null;
  taste_balance: string | null;
  taste_notes: string | null;
};

export type FilterRecord = FilterValues & FinalBase & { brewer_id: string | null };

export type FilterBrew = FilterValues & { id: string; created_at: string };

export type FilterTarget = {
  material_id: string;
  dose_min_g: number;
  dose_max_g: number;
  ratio_min: number;
  ratio_max: number;
  time_min_seconds: number;
  time_max_seconds: number;
  revision: number;
};

export type Brewer = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  brewer_type: string;
  is_active: boolean;
};

export type FilterTemp = "HOT" | "ICED";
export const FILTER_TEMPS: FilterTemp[] = ["HOT", "ICED"];
