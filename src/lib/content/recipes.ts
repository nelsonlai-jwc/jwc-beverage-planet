import type { FullVersion } from "@/lib/recipes/types";
import type { Localizer } from "./translations";

/** User-entered texts of a version that the SOP shows. */
export function sopTexts(version: FullVersion): (string | null)[] {
  return [
    version.product_name,
    version.appearance_notes,
    ...version.steps.map((s) => s.instruction),
    ...version.ingredients.map((i) => i.baseName),
  ];
}

/** The version with its SOP texts in the viewer's language (brands stay as they are). */
export function localizeVersion(version: FullVersion, loc: Localizer): FullVersion {
  return {
    ...version,
    product_name: loc.t(version.product_name),
    appearance_notes: loc.t(version.appearance_notes),
    steps: version.steps.map((s) => ({ ...s, instruction: loc.t(s.instruction) })),
    ingredients: version.ingredients.map((i) =>
      i.baseName ? { ...i, name: i.brand ? `${loc.t(i.baseName)} (${i.brand})` : loc.t(i.baseName) } : i,
    ),
  };
}
