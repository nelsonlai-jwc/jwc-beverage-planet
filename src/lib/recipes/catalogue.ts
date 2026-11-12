// Shared by the recipe list page (server) and the approved catalogue grid (client).
import type { BeverageStyle, BeverageTemp, RecipePurpose } from "./types";

export type CatalogueCard = {
  id: string;
  name: string;
  isPrep: boolean;
  allOutlets: boolean;
  outletIds: string[];
  outlets: string; // display label, e.g. "KL, PJ" or "All outlets"
  versionNo: number;
  purpose: RecipePurpose;
  style: BeverageStyle | null;
  temperature: BeverageTemp | null;
  photo: string | null;
};

export const CATALOGUE_TYPES = ["DRINK", "PREP"] as const;
export const CATALOGUE_PURPOSES: RecipePurpose[] = ["RND", "OFFICIAL_RELEASE"];
export const CATALOGUE_STYLES: BeverageStyle[] = ["COFFEE", "TEA", "COCKTAIL", "MOCKTAIL", "PREP_MATERIAL"];
export const CATALOGUE_TEMPS: BeverageTemp[] = ["HOT", "COLD", "FROZEN"];

export const CATALOGUE_FILTERS = ["outlet", "type", "purpose", "style", "temp"] as const;
export type CatalogueFilterKey = (typeof CATALOGUE_FILTERS)[number];
export type CatalogueFilters = Record<CatalogueFilterKey, string>;

export const CATALOGUE_SORT_KEYS = ["name", "outlet", "type", "purpose", "style", "temp"] as const;
export type CatalogueSortKey = (typeof CATALOGUE_SORT_KEYS)[number];
export type CatalogueSortDir = "asc" | "desc";

// Filters, sort and direction are kept in the URL under these same names.
export function catalogueStateFromSearch(search: Record<string, string | undefined>) {
  const filters = Object.fromEntries(CATALOGUE_FILTERS.map((key) => [key, search[key] ?? ""])) as CatalogueFilters;
  const sort: CatalogueSortKey = (CATALOGUE_SORT_KEYS as readonly string[]).includes(search.sort ?? "")
    ? (search.sort as CatalogueSortKey)
    : "name";
  const dir: CatalogueSortDir = search.dir === "desc" ? "desc" : "asc";
  return { filters, sort, dir };
}
