import type { FullVersion } from "./types";
import type { SopData } from "@/components/recipes/SopView";

// Outlets run on Malaysia time (O13), whatever the server's zone is.
export function formatDateTime(iso: string | null | undefined, locale: string) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(iso));
}

export function toSopData(version: FullVersion, updatedAt?: string): SopData {
  return {
    productName: version.product_name,
    style: version.style,
    temperature: version.temperature,
    versionNo: version.version_no,
    updatedAt,
    yieldQuantity: version.yield_quantity,
    yieldUnit: version.yield_unit,
    appearanceNotes: version.appearance_notes,
    ingredients: version.ingredients.map((i) => ({
      key: i.id,
      name: i.name,
      isPrep: i.isPrep,
      quantity: i.quantity,
      unit: i.unit,
    })),
    steps: version.steps.map((s) => ({ key: s.id, instruction: s.instruction })),
    photos: version.photos,
  };
}
