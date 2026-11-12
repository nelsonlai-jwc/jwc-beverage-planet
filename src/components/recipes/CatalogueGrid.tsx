"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  CATALOGUE_FILTERS,
  CATALOGUE_PURPOSES,
  CATALOGUE_SORT_KEYS,
  CATALOGUE_STYLES,
  CATALOGUE_TEMPS,
  CATALOGUE_TYPES,
  type CatalogueCard,
  type CatalogueFilterKey,
  type CatalogueFilters,
  type CatalogueSortDir,
  type CatalogueSortKey,
} from "@/lib/recipes/catalogue";
import { PurposeBadge, card, inputClass, primaryButton, secondaryButton } from "./ui";

const compactInput =
  "h-9 w-full min-w-0 rounded-lg border-[1.5px] border-black bg-white px-2 text-sm font-normal";

const chipBase =
  "inline-flex h-10 shrink-0 items-center rounded-lg border-[1.5px] border-black text-sm font-semibold whitespace-nowrap";

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

function compare(a: CatalogueCard, b: CatalogueCard, key: CatalogueSortKey) {
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
      return rank(CATALOGUE_STYLES, a.style) - rank(CATALOGUE_STYLES, b.style);
    case "temp":
      return rank(CATALOGUE_TEMPS, a.temperature) - rank(CATALOGUE_TEMPS, b.temperature);
  }
}

function sortRows(rows: CatalogueCard[], key: CatalogueSortKey, dir: CatalogueSortDir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * compare(a, b, key) || a.name.localeCompare(b.name));
}

// Keeps the tab and name search already in the URL; replaces only filters and sort.
function writeUrl(filters: CatalogueFilters, sort: CatalogueSortKey, dir: CatalogueSortDir) {
  const params = new URLSearchParams(window.location.search);
  for (const key of [...CATALOGUE_FILTERS, "sort", "dir"]) params.delete(key);
  for (const key of CATALOGUE_FILTERS) if (filters[key]) params.set(key, filters[key]);
  if (sort !== "name" || dir !== "asc") {
    params.set("sort", sort);
    params.set("dir", dir);
  }
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

export function CatalogueGrid({
  rows,
  outlets,
  search,
  initialFilters,
  initialSort,
  initialDir,
}: {
  rows: CatalogueCard[];
  outlets: { id: string; name: string }[];
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
    () => sortRows(rows.filter((row) => matches(row, filters)), sort, dir),
    [rows, filters, sort, dir],
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
    style: CATALOGUE_STYLES.map((v) => [v, t(`style.${v}`)]),
    temp: CATALOGUE_TEMPS.map((v) => [v, t(`temp.${v}`)]),
  };

  // What a chip shows when its filter is set (empty = not set).
  const summary = (key: CatalogueFilterKey) =>
    options[key].find(([value]) => value === filters[key])?.[1] ?? "";

  // Which pop-up is open, and where to draw it (fixed, so the scrolling chip row can't clip it).
  const [open, setOpen] = useState<CatalogueFilterKey | "sort" | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "mousedown" && popRef.current?.contains(e.target as Node)) return;
      if (e.type === "mousedown" && (e.target as HTMLElement).closest("[data-chip]")) return;
      setOpen(null);
    };
    const onResize = () => setOpen(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("scroll", onResize, true);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const toggle = (key: CatalogueFilterKey | "sort", button: HTMLElement) => {
    if (open === key) return setOpen(null);
    const rect = button.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 32);
    setAnchor({
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      top: rect.bottom + 8,
    });
    setOpen(key);
  };

  const chip = (key: CatalogueFilterKey) => {
    const value = summary(key);
    const active = value !== "";
    return (
      <span key={key} data-chip className={`${chipBase} ${active ? "bg-black text-white" : "bg-white"}`}>
        <button
          type="button"
          onClick={(e) => toggle(key, e.currentTarget.parentElement!)}
          aria-expanded={open === key}
          aria-haspopup="dialog"
          className={`flex h-full items-center gap-1.5 ${active ? "pl-3.5 pr-1.5" : "px-3.5"}`}
        >
          <span>{active ? `${labels[key]}: ${value}` : labels[key]}</span>
          {!active && (
            <span aria-hidden className="text-[10px]">
              ▼
            </span>
          )}
        </button>
        {active && (
          <button
            type="button"
            onClick={() => {
              setFilter(key, "");
              if (open === key) setOpen(null);
            }}
            aria-label={`${tf("clear")} ${labels[key]}`}
            className="flex h-full items-center pl-1 pr-3"
          >
            ✕
          </button>
        )}
      </span>
    );
  };

  const option = (selected: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-black/5"
    >
      <span aria-hidden className="w-4">
        {selected ? "✓" : ""}
      </span>
      {label}
    </button>
  );

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

      {/* One row of filter chips (scrolls sideways on phones), plus Sort by. */}
      <div className="flex items-center gap-3">
        <div className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-0.5 md:flex-wrap">
          {CATALOGUE_FILTERS.map(chip)}
        </div>
        <span data-chip>
          <button
            type="button"
            onClick={(e) => toggle("sort", e.currentTarget)}
            aria-expanded={open === "sort"}
            aria-haspopup="menu"
            className={`${chipBase} gap-1.5 bg-white px-3.5`}
          >
            <span aria-hidden>☰</span>
            {tf("sortBy")}
          </button>
        </span>
      </div>

      {open && anchor && (
        <div
          ref={popRef}
          role={open === "sort" ? "menu" : "dialog"}
          aria-label={open === "sort" ? tf("sortBy") : labels[open]}
          style={{ left: anchor.left, top: anchor.top, width: "min(18rem, calc(100vw - 2rem))" }}
          className="fixed z-50 flex flex-col gap-3 rounded-2xl border-[1.5px] border-black bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
        >
          {open === "sort" ? (
            <div className="flex flex-col">
              {CATALOGUE_SORT_KEYS.map((key) => (
                <div key={key}>{option(sort === key, labels[key], () => applySort(key, dir))}</div>
              ))}
              <div className="my-1 border-t border-black/15" />
              {option(dir === "asc", tf("ascending"), () => applySort(sort, "asc"))}
              {option(dir === "desc", tf("descending"), () => applySort(sort, "desc"))}
            </div>
          ) : (
            <>
              <span className="text-sm font-semibold">{labels[open]}</span>
              <select
                value={filters[open]}
                onChange={(e) => setFilter(open, e.target.value)}
                aria-label={labels[open]}
                className={compactInput}
              >
                <option value="">{tf("all")}</option>
                {options[open].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {filters[open] !== "" && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter(open, "");
                    setOpen(null);
                  }}
                  className="self-start text-sm underline"
                >
                  {tf("clear")}
                </button>
              )}
            </>
          )}
        </div>
      )}

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
                <span className="text-base font-semibold">{r.name}</span>
                <span className="text-sm text-[#3d3f3a]">
                  {r.outlets} · V{r.versionNo}
                </span>
                <span className="text-sm text-[#3d3f3a]">
                  {[r.style && t(`style.${r.style}`), r.temperature && t(`temp.${r.temperature}`)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
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
