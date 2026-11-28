"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CATALOGUE_PURPOSES, CATALOGUE_TEMPS, CATALOGUE_TYPES } from "@/lib/recipes/catalogue";
import {
  MINE_FILTERS,
  MINE_SORT_KEYS,
  MINE_STATUSES,
  isDefaultMineSort,
  type MineCard,
  type MineFilterKey,
  type MineFilters,
  type MineSortKey,
} from "@/lib/recipes/mine";
import { ArchiveRecipeButton, DeleteDraftRecipeButton } from "./RecipeRemove";
import { FilterSortBar, writeFilterSortUrl, type SortDir } from "./FilterSortBar";
import { StatusBadge, TagList, card, inputClass, secondaryButton, smallButton } from "./ui";
import { RecipeName } from "./RecipeName";
import { BulkActions } from "./BulkActions";

const typeOf = (row: MineCard) => (row.isPrep ? "PREP" : "DRINK");

function matches(row: MineCard, f: MineFilters) {
  if (f.outlet && !row.allOutlets && !row.outletIds.includes(f.outlet)) return false;
  // Archived recipes show only when that status is chosen.
  if (f.status === "ARCHIVED") {
    if (!row.archived) return false;
  } else {
    if (row.archived) return false;
    if (f.status === "APPROVED" && (row.open || row.approvedNo == null)) return false;
    if (f.status && f.status !== "APPROVED" && row.open?.status !== f.status) return false;
  }
  if (f.type && typeOf(row) !== f.type) return false;
  if (f.purpose && row.purpose !== f.purpose) return false;
  if (f.style && row.style !== f.style) return false;
  if (f.temp && row.temperature !== f.temp) return false;
  return true;
}

// Position in a fixed list; empty values go after every set one.
const rank = <T,>(list: readonly T[], value: T | null) => (value == null ? list.length : list.indexOf(value));

function compare(a: MineCard, b: MineCard, key: MineSortKey, styles: readonly string[]) {
  switch (key) {
    case "updated":
      return a.updatedAt.localeCompare(b.updatedAt);
    case "name":
      return a.name.localeCompare(b.name);
    case "outlet":
      return a.outlets.localeCompare(b.outlets);
    case "type":
      return rank(CATALOGUE_TYPES, typeOf(a)) - rank(CATALOGUE_TYPES, typeOf(b));
    case "purpose":
      return rank(CATALOGUE_PURPOSES, a.purpose) - rank(CATALOGUE_PURPOSES, b.purpose);
    case "style":
      return rank(styles, a.style) - rank(styles, b.style);
    case "temp":
      return rank(CATALOGUE_TEMPS, a.temperature) - rank(CATALOGUE_TEMPS, b.temperature);
  }
}

function sortRows(rows: MineCard[], key: MineSortKey, dir: SortDir, styles: readonly string[]) {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * compare(a, b, key, styles) || a.name.localeCompare(b.name));
}

const writeUrl = (filters: MineFilters, sort: MineSortKey, dir: SortDir) =>
  writeFilterSortUrl(MINE_FILTERS, filters, sort, dir, isDefaultMineSort(sort, dir));

export function MineList({
  rows,
  outlets,
  styles,
  search,
  initialFilters,
  initialSort,
  initialDir,
  isAdmin,
}: {
  rows: MineCard[];
  outlets: { id: string; name: string }[];
  // Built-in styles, then any the Admin added on the Settings page.
  styles: string[];
  search: string;
  initialFilters: MineFilters;
  initialSort: MineSortKey;
  initialDir: SortDir;
  isAdmin: boolean;
}) {
  const t = useTranslations("Recipes");
  const tf = useTranslations("Recipes.catalogueFilter");
  const [filters, setFilters] = useState(initialFilters);
  const [sort, setSort] = useState<MineSortKey>(initialSort);
  const [dir, setDir] = useState<SortDir>(initialDir);
  // Select mode: tick recipes, then act on all of them from the bar at the bottom.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const shown = useMemo(
    () => sortRows(rows.filter((row) => matches(row, filters)), sort, dir, styles),
    [rows, filters, sort, dir, styles],
  );

  // Archived recipes can't be copied or deleted, so they can't be selected.
  const selectable = shown.filter((r) => !r.archived);
  const selected = rows.filter((r) => picked.has(r.id) && !r.archived);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.id));
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  const setFilter = (key: MineFilterKey, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    writeUrl(next, sort, dir);
  };

  const applySort = (key: MineSortKey, nextDir: SortDir) => {
    setSort(key);
    setDir(nextDir);
    writeUrl(filters, key, nextDir);
  };

  const labels: Record<MineSortKey | MineFilterKey, string> = {
    updated: tf("updated"),
    name: tf("name"),
    outlet: tf("outlets"),
    status: t("statusLabel"),
    type: tf("type"),
    purpose: tf("purpose"),
    style: tf("style"),
    temp: tf("temp"),
  };

  const typeLabel = (value: string) => (value === "PREP" ? t("prep") : t("drink"));

  // Options of each chip's pop-up, as [value, label].
  const options: Record<MineFilterKey, [string, string][]> = {
    outlet: outlets.map((o) => [o.id, o.name]),
    status: MINE_STATUSES.map((v) => [v, t(`status.${v}`)]),
    type: CATALOGUE_TYPES.map((v) => [v, typeLabel(v)]),
    purpose: CATALOGUE_PURPOSES.map((v) => [v, t(`purpose.${v}`)]),
    style: styles.map((v) => [v, t(`style.${v}`)]),
    temp: CATALOGUE_TEMPS.map((v) => [v, t(`temp.${v}`)]),
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Name search reloads the page; the current filters and sort ride along. */}
      <form className="flex flex-wrap gap-2" action="">
        {MINE_FILTERS.map((key) =>
          filters[key] ? <input key={key} type="hidden" name={key} value={filters[key]} /> : null,
        )}
        {!isDefaultMineSort(sort, dir) && (
          <>
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="dir" value={dir} />
          </>
        )}
        <label className="min-w-0 flex-1 basis-56">
          <span className="sr-only">{t("search")}</span>
          <input name="q" defaultValue={search} placeholder={t("search")} className={inputClass} />
        </label>
        <button className={secondaryButton}>{t("apply")}</button>
      </form>

      <FilterSortBar
        filterKeys={MINE_FILTERS}
        sortKeys={MINE_SORT_KEYS}
        labels={labels}
        options={options}
        filters={filters}
        onFilter={setFilter}
        sort={sort}
        dir={dir}
        onSort={applySort}
      />

      <div className="flex flex-wrap items-center gap-2">
        {!selecting ? (
          <button type="button" className={smallButton} onClick={() => setSelecting(true)} disabled={!selectable.length}>
            {t("bulk.select")}
          </button>
        ) : (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              className="size-5 accent-black"
              checked={allPicked}
              onChange={() =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  for (const r of selectable) {
                    if (allPicked) next.delete(r.id);
                    else next.add(r.id);
                  }
                  return next;
                })
              }
            />
            {t("bulk.selectAll", { count: selectable.length })}
          </label>
        )}
      </div>

      {shown.length === 0 ? (
        <p className={card}>{t("mineEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((r) => (
            <li
              key={r.id}
              className={`${card} relative gap-2 hover:ring-2 hover:ring-black ${selecting && picked.has(r.id) ? "ring-2 ring-black" : ""} ${selecting && r.archived ? "opacity-60" : ""}`}
            >
              {/* In select mode a tap anywhere on the card ticks it instead of opening it. */}
              {selecting && !r.archived && (
                <label className="absolute inset-0 z-20 cursor-pointer rounded-[20px]">
                  <span className="sr-only">{r.name}</span>
                  <input
                    type="checkbox"
                    className="absolute left-4 top-4 size-5 accent-black sm:left-5 sm:top-5"
                    checked={picked.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </label>
              )}
              <span className={`flex flex-wrap items-center justify-between gap-2 ${selecting ? "pl-8" : ""}`}>
                {/* The link covers the whole card; the delete control sits above it. */}
                <Link href={`/recipes/${r.id}`} className="text-base font-semibold after:absolute after:inset-0 after:rounded-[20px]">
                  <RecipeName name={r.name} temperature={r.isPrep ? null : r.temperature} />
                </Link>
                <span className="flex flex-wrap gap-1.5">
                  {r.archived && <StatusBadge status="ARCHIVED" />}
                  {r.approvedNo != null && !r.archived && <StatusBadge status="APPROVED" />}
                  {r.open && <StatusBadge status={r.open.status} />}
                </span>
              </span>
              <TagList tags={r.tags} />
              <span className="flex flex-wrap items-center justify-between gap-2">
                {/* min-w-0 + flex-1: long text wraps itself instead of pushing the buttons to a new line. */}
                <span className="min-w-0 flex-1 text-sm text-[#3d3f3a]">
                  {r.outlets} · {r.isPrep ? t("prep") : t("drink")}
                  {r.approvedNo != null && ` · ${t("approvedVersion", { no: r.approvedNo })}`}
                  {r.open && ` · ${t("openVersion", { no: r.open.versionNo })}`}
                </span>
                {!r.archived && !selecting && (
                  <span className="relative z-10 ml-auto flex flex-wrap items-center justify-end gap-2 has-[[role=dialog]]:basis-full">
                    {r.archivePending && <span className="text-sm font-semibold">{t("archive.pendingTitle")}</span>}
                    {/* Copies the version this card shows: the one in progress, else the approved one. */}
                    <Link
                      href={r.open ? `/recipes/${r.id}/copy?version=${r.open.id}` : `/recipes/${r.id}/copy`}
                      className={smallButton}
                    >
                      {t("copy")}
                    </Link>
                    {!r.archivePending &&
                      r.canManage &&
                      (r.neverSubmitted ? (
                        <DeleteDraftRecipeButton recipeId={r.id} />
                      ) : (
                        <ArchiveRecipeButton recipeId={r.id} mode={r.archiveMode} compact />
                      ))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {selecting && (
        <>
          {/* Room for the bar, so it never covers the last card. */}
          <div aria-hidden className="h-16" />
          <BulkActions selected={selected} isAdmin={isAdmin} outlets={outlets} onCancel={stopSelecting} />
        </>
      )}
    </div>
  );
}
