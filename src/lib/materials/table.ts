// Shared by the raw material list page (server) and its table (client).
import type { ApprovalStatus } from "@/components/materials/ui";

export const MATERIAL_STATUSES: ApprovalStatus[] = ["DRAFT", "PENDING", "APPROVED", "RETURNED", "ARCHIVED"];

export type MaterialRow = {
  id: string;
  name: string;
  brand: string;
  brandKey: string;
  typeId: string;
  type: string;
  status: ApprovalStatus;
  updated: string;
  updatedDay: string; // yyyy-mm-dd, for the date filter
  updatedAt: string;
  pack: string;
  packQuantity: number | null;
  packUnit: string;
  extraPacks: number;
  unitCost: string | null;
  unitCostValue: number | null;
};

export type MaterialFilters = {
  name: string;
  brand: string;
  type: string;
  packUnit: string;
  packMin: string;
  packMax: string;
  costMin: string;
  costMax: string;
  status: string;
  from: string;
  to: string;
};

export const SORT_KEYS = ["name", "brand", "type", "cost", "status", "updated"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

// URL parameter for each filter, so a refreshed or shared link shows the same list.
export const PARAMS: Record<keyof MaterialFilters, string> = {
  name: "name",
  brand: "brand",
  type: "type",
  packUnit: "unit",
  packMin: "packMin",
  packMax: "packMax",
  costMin: "costMin",
  costMax: "costMax",
  status: "status",
  from: "from",
  to: "to",
};

export function filtersFromSearch(search: Record<string, string | undefined>): MaterialFilters {
  const entries = Object.entries(PARAMS).map(([key, param]) => [key, search[param] ?? ""]);
  return Object.fromEntries(entries) as MaterialFilters;
}
