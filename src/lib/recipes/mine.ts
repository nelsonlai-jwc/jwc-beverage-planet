// Filters and sort of the "My outlets" recipe tab, shared by the page (server) and MineList (client).
import type { ApprovalStatus, BeverageStyle, BeverageTemp, RecipePurpose } from "./types";

export type MineCard = {
  id: string;
  name: string;
  tags: string[];
  archived: boolean;
  isPrep: boolean;
  allOutlets: boolean;
  outletIds: string[];
  outlets: string; // display label, e.g. "KL, PJ" or "All outlets"
  updatedAt: string;
  approvedNo: number | null;
  open: { id: string; status: ApprovalStatus; versionNo: number } | null;
  // Of the version the card shows: the one in progress, else the approved one.
  purpose: RecipePurpose | null;
  style: BeverageStyle | null;
  temperature: BeverageTemp | null;
  neverSubmitted: boolean;
  canManage: boolean;
  archivePending: boolean;
  archiveMode: "archive" | "request";
};

export const MINE_STATUSES = ["DRAFT", "PENDING", "RETURNED", "APPROVED", "ARCHIVED"] as const;

export const MINE_FILTERS = ["outlet", "status", "type", "purpose", "style", "temp"] as const;
export type MineFilterKey = (typeof MINE_FILTERS)[number];
export type MineFilters = Record<MineFilterKey, string>;

export const MINE_SORT_KEYS = ["updated", "name", "outlet", "type", "purpose", "style", "temp"] as const;
export type MineSortKey = (typeof MINE_SORT_KEYS)[number];

// Default: last updated first, the order this tab always had.
export const isDefaultMineSort = (sort: MineSortKey, dir: "asc" | "desc") => sort === "updated" && dir === "desc";

// Filters, sort and direction are kept in the URL under these same names.
export function mineStateFromSearch(search: Record<string, string | undefined>) {
  const filters = Object.fromEntries(MINE_FILTERS.map((key) => [key, search[key] ?? ""])) as MineFilters;
  const sort: MineSortKey = (MINE_SORT_KEYS as readonly string[]).includes(search.sort ?? "")
    ? (search.sort as MineSortKey)
    : "updated";
  const dir: "asc" | "desc" = search.dir === "asc" || search.dir === "desc" ? search.dir : sort === "updated" ? "desc" : "asc";
  return { filters, sort, dir };
}
