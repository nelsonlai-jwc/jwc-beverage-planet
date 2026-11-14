// Preset return reasons; keys under Recipes.returnPresets in messages.
export const RETURN_PRESETS = [
  "drinkTypeIngredient",
  "stepUnit",
  "drinkTypeMethod",
  "unlistedIngredient",
  "unusedIngredient",
  "quantity",
  "stepOrder",
  "unclearStep",
  "missingSettings",
  "cupSize",
  "costHigh",
  "media",
] as const;

export type ReturnPreset = (typeof RETURN_PRESETS)[number];
