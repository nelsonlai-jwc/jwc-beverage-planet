import type { BeverageStyle, BeverageTemp, FullVersion, MeasureUnit } from "./types";

// Same rule as private.recipe_name_key: case and spacing do not matter.
export function recipeNameKey(name: string | null | undefined) {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// One ingredient across the compared recipes: a raw material or a Prep recipe.
export function ingredientKey(i: { material_id: string | null; prep_recipe_id: string | null }) {
  return i.prep_recipe_id ? `p:${i.prep_recipe_id}` : `m:${i.material_id}`;
}

export type SyncOption = { key: string; name: string };

// The unified content written to every picked recipe (public.sync_recipes).
export type SyncContent = {
  style: BeverageStyle | null;
  temperature: BeverageTemp | null;
  yield_quantity: number | null;
  yield_unit: MeasureUnit | null;
  cup_type: string;
  serving_size: string;
  garnish: string;
  change_summary: string;
  ingredients: { key: string; quantity: number | null; unit: MeasureUnit | null; notes: string }[];
  steps: string[];
};

export function contentFromVersion(v: FullVersion): SyncContent {
  return {
    style: v.style,
    temperature: v.temperature,
    yield_quantity: v.yield_quantity,
    yield_unit: v.yield_unit,
    cup_type: v.cup_type ?? "",
    serving_size: v.serving_size ?? "",
    garnish: v.garnish ?? "",
    change_summary: "",
    ingredients: v.ingredients.map((i) => ({ key: ingredientKey(i), quantity: i.quantity, unit: i.unit, notes: i.notes ?? "" })),
    steps: v.steps.map((s) => s.instruction),
  };
}

// The payload public.sync_recipes reads.
export function contentPayload(c: SyncContent) {
  return {
    style: c.style,
    temperature: c.temperature,
    yield_quantity: c.yield_quantity,
    yield_unit: c.yield_unit,
    cup_type: c.cup_type,
    serving_size: c.serving_size,
    garnish: c.garnish,
    change_summary: c.change_summary,
    ingredients: c.ingredients.map((i) => ({
      material_id: i.key.startsWith("m:") ? i.key.slice(2) : null,
      prep_recipe_id: i.key.startsWith("p:") ? i.key.slice(2) : null,
      quantity: i.quantity,
      unit: i.unit,
      notes: i.notes,
    })),
    steps: c.steps.map((instruction) => ({ instruction })),
  };
}
