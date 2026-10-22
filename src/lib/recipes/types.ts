import type { Database, Json } from "@/types/database";

type PublicTables = Database["public"]["Tables"];

export type Role = Database["public"]["Enums"]["user_role"];
export type ApprovalStatus = Database["public"]["Enums"]["approval_status"];
export type BeverageStyle = Database["public"]["Enums"]["beverage_style"];
export type BeverageTemp = Database["public"]["Enums"]["beverage_temp"];
export type MeasureUnit = Database["public"]["Enums"]["measure_unit"];
export type RecipePurpose = Database["public"]["Enums"]["recipe_purpose"];

export type RecipeRow = PublicTables["recipes"]["Row"];
export type VersionRow = PublicTables["recipe_versions"]["Row"];
export type IngredientRow = PublicTables["recipe_ingredients"]["Row"];
export type PackagingRow = PublicTables["recipe_packaging"]["Row"];
export type StepRow = PublicTables["recipe_steps"]["Row"];

export const STYLES: BeverageStyle[] = ["COFFEE", "TEA", "COCKTAIL", "MOCKTAIL"];
export const TEMPS: BeverageTemp[] = ["HOT", "COLD", "FROZEN"];
export const UNITS: MeasureUnit[] = ["g", "ml"];
export const TASTES = [
  "sour",
  "sweet",
  "bitter",
  "salty",
  "umami",
  "spicy",
  "smoky",
  "zesty",
  "funky",
  "earthy",
  "oily",
] as const;
export type Taste = (typeof TASTES)[number];

export type Viewer = {
  id: string;
  role: Role;
  // Outlets the viewer can edit recipes for (all outlets for an Admin).
  managedOutletIds: string[];
};

export type Outlet = { id: string; name: string };

export type Photo = { id: string; url: string | null };

// One version with everything needed to show or edit it.
export type FullVersion = VersionRow & {
  ingredients: (IngredientRow & { name: string; isPrep: boolean })[];
  packaging: (PackagingRow & { name: string })[];
  steps: StepRow[];
  photos: Photo[];
};

// Field-level problem returned by submit_recipe_version / approve.
export type ValidationError = { code: string; field: string; line?: number };

// Shape of public.calculate_recipe_cost (raw-material track).
export type CostLine = {
  line_type: "MATERIAL" | "PREP" | "PACKAGING";
  ingredient_id?: string;
  display_name: string;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  line_cost: number | null;
  children?: CostLine[];
};
export type CostResult = {
  total_cost: number | null;
  is_complete: boolean;
  incomplete_reasons: { code: string; line_id?: string; message?: string }[];
  lines: CostLine[];
};

export function asCost(value: Json | null): CostResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as unknown as CostResult;
}
