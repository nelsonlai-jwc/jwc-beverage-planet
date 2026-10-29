import type { Outlet, Viewer } from "./types";

// Select fragment for a recipe's outlets: `...${RECIPE_OUTLETS}` in a recipes select.
export const RECIPE_OUTLETS = "all_outlets, recipe_outlets(outlet_id)";

export type RecipeOutlets = { all_outlets: boolean; recipe_outlets: { outlet_id: string }[] };

export function coversOutlet(recipe: RecipeOutlets, outletId: string) {
  return recipe.all_outlets || recipe.recipe_outlets.some((o) => o.outlet_id === outletId);
}

// Same rule as private.can_manage_recipe: Admin, or a Manager of every outlet of the recipe.
export function canManageRecipe(viewer: Viewer, recipe: RecipeOutlets) {
  if (viewer.role === "ADMIN") return true;
  return (
    viewer.role === "MANAGER" &&
    !recipe.all_outlets &&
    recipe.recipe_outlets.length > 0 &&
    recipe.recipe_outlets.every((o) => viewer.managedOutletIds.includes(o.outlet_id))
  );
}

// "All outlets", or the outlet names in Settings order.
export function outletLabel(recipe: RecipeOutlets, outlets: Outlet[], allLabel: string) {
  if (recipe.all_outlets) return allLabel;
  return outlets
    .filter((o) => coversOutlet(recipe, o.id))
    .map((o) => o.name)
    .join(", ") || "—";
}
