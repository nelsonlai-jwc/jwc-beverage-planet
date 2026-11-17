"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { rememberRecipeList } from "@/lib/recipes/listMemory";

// Filter chips + "Sort by" menu shared by the recipe list tabs (Approved catalogue, My outlets).

const compactInput =
  "h-9 w-full min-w-0 rounded-lg border border-black/35 bg-white px-2 text-sm font-normal";

const chipBase =
  "inline-flex h-8 shrink-0 items-center rounded-full border border-black/70 text-[13px] font-semibold whitespace-nowrap";

export type SortDir = "asc" | "desc";

// Keeps the tab and name search already in the URL; replaces only filters and sort.
// Sort and direction are left out while they are the tab's default.
export function writeFilterSortUrl(
  filterKeys: readonly string[],
  filters: Record<string, string>,
  sort: string,
  dir: SortDir,
  isDefaultSort: boolean,
) {
  const params = new URLSearchParams(window.location.search);
  for (const key of [...filterKeys, "sort", "dir"]) params.delete(key);
  for (const key of filterKeys) if (filters[key]) params.set(key, filters[key]);
  if (!isDefaultSort) {
    params.set("sort", sort);
    params.set("dir", dir);
  }
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  rememberRecipeList();
}

export function FilterSortBar<F extends string, S extends string>({
  filterKeys,
  sortKeys,
  labels,
  options,
  filters,
  onFilter,
  sort,
  dir,
  onSort,
}: {
  filterKeys: readonly F[];
  sortKeys: readonly S[];
  labels: Record<F | S, string>;
  // Options of each chip's pop-up, as [value, label].
  options: Record<F, [string, string][]>;
  filters: Record<F, string>;
  onFilter: (key: F, value: string) => void;
  sort: S;
  dir: SortDir;
  onSort: (key: S, dir: SortDir) => void;
}) {
  const tf = useTranslations("Recipes.catalogueFilter");

  // What a chip shows when its filter is set (empty = not set).
  const summary = (key: F) => options[key].find(([value]) => value === filters[key])?.[1] ?? "";

  // Which pop-up is open, and where to draw it (fixed, so the scrolling chip row can't clip it).
  const [open, setOpen] = useState<F | "sort" | null>(null);
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

  const toggle = (key: F | "sort", button: HTMLElement) => {
    if (open === key) return setOpen(null);
    const rect = button.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 32);
    setAnchor({
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      top: rect.bottom + 8,
    });
    setOpen(key);
  };

  const chip = (key: F) => {
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
              onFilter(key, "");
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
    <>
      {/* One row of filter chips (scrolls sideways on phones), plus Sort by. */}
      <div className="flex flex-wrap gap-1.5">
        <div className="contents">
          {filterKeys.map(chip)}
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
              {sortKeys.map((key) => (
                <div key={key}>{option(sort === key, labels[key], () => onSort(key, dir))}</div>
              ))}
              <div className="my-1 border-t border-black/15" />
              {option(dir === "asc", tf("ascending"), () => onSort(sort, "asc"))}
              {option(dir === "desc", tf("descending"), () => onSort(sort, "desc"))}
            </div>
          ) : (
            <>
              <span className="text-sm font-semibold">{labels[open]}</span>
              <select
                value={filters[open]}
                onChange={(e) => onFilter(open, e.target.value)}
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
                    onFilter(open, "");
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
    </>
  );
}
