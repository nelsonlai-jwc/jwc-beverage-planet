import type { BeverageStyle, BeverageTemp, MeasureUnit } from "./types";

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
  // Step photo / video per step (same order as steps), from the ticked recipes only.
  step_media: (string | null)[];
  // Recipes whose finished photos and step media are brought in; empty = each keeps its own photos.
  photo_recipe_ids: string[];
};

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
    steps: c.steps.map((instruction, n) => ({ instruction, media_asset_id: c.step_media[n] ?? null })),
    photo_recipe_ids: c.photo_recipe_ids,
  };
}
