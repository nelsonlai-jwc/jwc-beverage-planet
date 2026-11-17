"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  CATALOGUE_FILTERS,
  CATALOGUE_PURPOSES,
  CATALOGUE_SORT_KEYS,
  CATALOGUE_TEMPS,
  CATALOGUE_TYPES,
  type CatalogueCard,
  type CatalogueFilterKey,
  type CatalogueFilters,
  type CatalogueSortDir,
  type CatalogueSortKey,
} from "@/lib/recipes/catalogue";
import { PurposeBadge, TagList, card, inputClass, primaryButton, secondaryButton } from "./ui";
import { FilterSortBar, writeFilterSortUrl } from "./FilterSortBar";
import { RecipeName } from "./RecipeName";

const typeOf = (row: CatalogueCard) => (row.isPrep ? "PREP" : "DRINK");

function matches(row: CatalogueCard, f: CatalogueFilters) {
  if (f.outlet && !row.allOutlets && !row.outletIds.includes(f.outlet)) return false;
  if (f.type && typeOf(row) !== f.type) return false;
  if (f.purpose && row.purpose !== f.purpose) return false;
  if (f.style && row.style !== f.style) return false;
  if (f.temp && row.temperature !== f.temp) return false;
  return true;
}

// Position in a fixed list; empty values go after every set one.
const rank = <T,>(list: readonly T[], value: T | null) => (value == null ? list.length : list.indexOf(value));

function compare(a: CatalogueCard, b: CatalogueCard, key: CatalogueSortKey, styles: readonly string[]) {
  switch (key) {
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

function sortRows(rows: CatalogueCard[], key: CatalogueSortKey, dir: CatalogueSortDir, styles: readonly string[]) {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * compare(a, b, key, styles) || a.name.localeCompare(b.name));
}

const writeUrl = (filters: CatalogueFilters, sort: CatalogueSortKey, dir: CatalogueSortDir) =>
  writeFilterSortUrl(CATALOGUE_FILTERS, filters, sort, dir, sort === "name" && dir === "asc");

export function CatalogueGrid({
  rows,
  outlets,
  styles,
  search,
  initialFilters,
  initialSort,
  initialDir,
}: {
  rows: CatalogueCard[];
  outlets: { id: string; name: string }[];
  // Built-in styles, then any the Admin added on the Settings page.
  styles: string[];
  search: string;
  initialFilters: CatalogueFilters;
  initialSort: CatalogueSortKey;
  initialDir: CatalogueSortDir;
}) {
  const t = useTranslations("Recipes");
  const tf = useTranslations("Recipes.catalogueFilter");
  const [filters, setFilters] = useState(initialFilters);
  const [sort, setSort] = useState<CatalogueSortKey>(initialSort);
  const [dir, setDir] = useState<CatalogueSortDir>(initialDir);

  const shown = useMemo(
    () => sortRows(rows.filter((row) => matches(row, filters)), sort, dir, styles),
    [rows, filters, sort, dir, styles],
  );

  const setFilter = (key: CatalogueFilterKey, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    writeUrl(next, sort, dir);
  };

  const applySort = (key: CatalogueSortKey, nextDir: CatalogueSortDir) => {
    setSort(key);
    setDir(nextDir);
    writeUrl(filters, key, nextDir);
  };

  const labels: Record<CatalogueSortKey, string> = {
    name: tf("name"),
    outlet: tf("outlets"),
    type: tf("type"),
    purpose: tf("purpose"),
    style: tf("style"),
    temp: tf("temp"),
  };

  const typeLabel = (value: string) => (value === "PREP" ? t("prep") : t("drink"));

  // Options of each chip's pop-up, as [value, label].
  const options: Record<CatalogueFilterKey, [string, string][]> = {
    outlet: outlets.map((o) => [o.id, o.name]),
    type: CATALOGUE_TYPES.map((v) => [v, typeLabel(v)]),
    purpose: CATALOGUE_PURPOSES.map((v) => [v, t(`purpose.${v}`)]),
    style: styles.map((v) => [v, t(`style.${v}`)]),
    temp: CATALOGUE_TEMPS.map((v) => [v, t(`temp.${v}`)]),
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Name search reloads the page; the current filters and sort ride along. */}
      <form className="flex flex-wrap gap-2" action="">
        <input type="hidden" name="tab" value="catalogue" />
        {CATALOGUE_FILTERS.map((key) =>
          filters[key] ? <input key={key} type="hidden" name={key} value={filters[key]} /> : null,
        )}
        {(sort !== "name" || dir !== "asc") && (
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
        filterKeys={CATALOGUE_FILTERS}
        sortKeys={CATALOGUE_SORT_KEYS}
        labels={labels}
        options={options}
        filters={filters}
        onFilter={setFilter}
        sort={sort}
        dir={dir}
        onSort={applySort}
      />

      {shown.length === 0 ? (
        <p className={card}>{rows.length === 0 ? t("catalogueEmpty") : t("mineEmpty")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => (
            <li key={r.id} className={card}>
              {r.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
                <img src={r.photo} alt={r.name} className="aspect-[4/3] w-full rounded-[12px] object-cover" />
              ) : (
                <div className="aspect-[4/3] w-full rounded-[12px] bg-[#eceee8]" aria-hidden />
              )}
              <div className="flex flex-col gap-1">
                <span className="text-base font-semibold"><RecipeName name={r.name} temperature={r.isPrep ? null : r.temperature} /></span>
                <span className="text-sm text-[#3d3f3a]">
                  {r.outlets} · V{r.versionNo}
                </span>
                <span className="text-sm text-[#3d3f3a]">
                  {[r.style && t(`style.${r.style}`), r.isPrep && r.temperature && t(`temp.${r.temperature}`)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <TagList tags={r.tags} />
              <div className="flex flex-wrap items-center gap-2">
                <PurposeBadge purpose={r.purpose} />
                {r.isPrep && <span className="text-xs font-semibold">{t("prep")}</span>}
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Link href={`/recipes/${r.id}`} className={secondaryButton}>
                  {t("view")}
                </Link>
                <Link href={`/recipes/${r.id}/copy`} className={primaryButton}>
                  {t("copy")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
