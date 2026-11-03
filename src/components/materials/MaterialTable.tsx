"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  MATERIAL_STATUSES,
  PARAMS,
  SORT_KEYS,
  type MaterialFilters,
  type MaterialRow,
  type SortDir,
  type SortKey,
} from "@/lib/materials/table";
import { StatusBadge } from "./ui";

const CHIPS = ["name", "brand", "type", "pack", "cost", "status", "updated"] as const;
type ChipKey = (typeof CHIPS)[number];

const compactInput =
  "h-9 w-full min-w-0 rounded-lg border-[1.5px] border-black bg-white px-2 text-sm font-normal";

function toNumber(value: string) {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function matches(row: MaterialRow, f: MaterialFilters) {
  if (f.name && !row.name.toLowerCase().includes(f.name.trim().toLowerCase())) return false;
  if (f.brand && row.brandKey !== f.brand) return false;
  if (f.type && row.typeId !== f.type) return false;
  // No status chosen keeps the old default: archived items stay hidden.
  if (f.status ? row.status !== f.status : row.status === "ARCHIVED") return false;
  if (f.packUnit && row.packUnit !== f.packUnit) return false;
  const packMin = toNumber(f.packMin);
  const packMax = toNumber(f.packMax);
  if (packMin != null && (row.packQuantity == null || row.packQuantity < packMin)) return false;
  if (packMax != null && (row.packQuantity == null || row.packQuantity > packMax)) return false;
  const costMin = toNumber(f.costMin);
  const costMax = toNumber(f.costMax);
  if (costMin != null && (row.unitCostValue == null || row.unitCostValue < costMin)) return false;
  if (costMax != null && (row.unitCostValue == null || row.unitCostValue > costMax)) return false;
  if (f.from && row.updatedDay < f.from) return false;
  if (f.to && row.updatedDay > f.to) return false;
  return true;
}

function compare(a: MaterialRow, b: MaterialRow, key: SortKey) {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "brand":
      return a.brand.localeCompare(b.brand);
    case "type":
      return a.type.localeCompare(b.type);
    case "status":
      return MATERIAL_STATUSES.indexOf(a.status) - MATERIAL_STATUSES.indexOf(b.status);
    case "updated":
      return a.updatedAt.localeCompare(b.updatedAt);
    case "cost":
      return (a.unitCostValue ?? 0) - (b.unitCostValue ?? 0);
  }
}

function sortRows(rows: MaterialRow[], key: SortKey, dir: SortDir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    // Materials without an approved price always go last.
    if (key === "cost" && (a.unitCostValue == null) !== (b.unitCostValue == null)) {
      return a.unitCostValue == null ? 1 : -1;
    }
    return sign * compare(a, b, key) || a.name.localeCompare(b.name);
  });
}

function writeUrl(filters: MaterialFilters, sort: SortKey, dir: SortDir) {
  const params = new URLSearchParams();
  for (const [key, param] of Object.entries(PARAMS)) {
    const value = filters[key as keyof MaterialFilters];
    if (value) params.set(param, value);
  }
  if (sort !== "name" || dir !== "asc") {
    params.set("sort", sort);
    params.set("dir", dir);
  }
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

export function MaterialTable({
  rows,
  types,
  brands,
  units,
  initialFilters,
  initialSort,
  initialDir,
}: {
  rows: MaterialRow[];
  types: { id: string; name: string }[];
  brands: { key: string; label: string }[];
  units: string[];
  initialFilters: MaterialFilters;
  initialSort: SortKey;
  initialDir: SortDir;
}) {
  const t = useTranslations("RawMaterials");
  const [filters, setFilters] = useState(initialFilters);
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [dir, setDir] = useState<SortDir>(initialDir);

  const shown = useMemo(
    () => sortRows(rows.filter((row) => matches(row, filters)), sort, dir),
    [rows, filters, sort, dir],
  );

  const setFilter = (key: keyof MaterialFilters, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    writeUrl(next, sort, dir);
  };

  const applySort = (key: SortKey, nextDir: SortDir) => {
    setSort(key);
    setDir(nextDir);
    writeUrl(filters, key, nextDir);
  };

  const clickHeader = (key: SortKey) =>
    applySort(key, sort === key && dir === "asc" ? "desc" : "asc");

  const sortLabels: Record<SortKey, string> = {
    name: t("name"),
    brand: t("brand"),
    type: t("type"),
    cost: t("unitCost"),
    status: t("statusLabel"),
    updated: t("updated"),
  };

  const range = (minKey: keyof MaterialFilters, maxKey: keyof MaterialFilters, label: string, cls: string) => (
    <div className="flex gap-1.5">
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={filters[minKey]}
        onChange={(e) => setFilter(minKey, e.target.value)}
        placeholder={t("tableFilter.min")}
        aria-label={`${label} ${t("tableFilter.min")}`}
        className={cls}
      />
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={filters[maxKey]}
        onChange={(e) => setFilter(maxKey, e.target.value)}
        placeholder={t("tableFilter.max")}
        aria-label={`${label} ${t("tableFilter.max")}`}
        className={cls}
      />
    </div>
  );

  // Filter controls shown in each chip's pop-up.
  const controls = (cls: string) => ({
    name: (
      <input
        type="search"
        value={filters.name}
        onChange={(e) => setFilter("name", e.target.value)}
        placeholder={t("tableFilter.contains")}
        aria-label={t("name")}
        className={cls}
      />
    ),
    brand: (
      <select value={filters.brand} onChange={(e) => setFilter("brand", e.target.value)} aria-label={t("brand")} className={cls}>
        <option value="">{t("tableFilter.all")}</option>
        {brands.map((brand) => (
          <option key={brand.key} value={brand.key}>
            {brand.label}
          </option>
        ))}
      </select>
    ),
    type: (
      <select value={filters.type} onChange={(e) => setFilter("type", e.target.value)} aria-label={t("type")} className={cls}>
        <option value="">{t("tableFilter.all")}</option>
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </select>
    ),
    pack: (
      <div className="flex flex-col gap-1.5">
        <select
          value={filters.packUnit}
          onChange={(e) => setFilter("packUnit", e.target.value)}
          aria-label={`${t("mainPack")} ${t("tableFilter.unit")}`}
          className={cls}
        >
          <option value="">{t("tableFilter.allUnits")}</option>
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
        {range("packMin", "packMax", t("mainPack"), cls)}
      </div>
    ),
    cost: range("costMin", "costMax", t("unitCost"), cls),
    status: (
      <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)} aria-label={t("statusLabel")} className={cls}>
        <option value="">{t("allStatuses")}</option>
        {MATERIAL_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`status.${value}`)}
          </option>
        ))}
      </select>
    ),
    updated: (
      <div className="flex flex-col gap-1.5">
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilter("from", e.target.value)}
          aria-label={`${t("updated")} ${t("tableFilter.from")}`}
          title={t("tableFilter.from")}
          className={cls}
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilter("to", e.target.value)}
          aria-label={`${t("updated")} ${t("tableFilter.to")}`}
          title={t("tableFilter.to")}
          className={cls}
        />
      </div>
    ),
  });

  const inputs = controls(compactInput);

  // Which chip's pop-up is open, and where to draw it (fixed, so the scrolling chip row can't clip it).
  const [open, setOpen] = useState<ChipKey | "sort" | null>(null);
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

  const toggle = (key: ChipKey | "sort", button: HTMLElement) => {
    if (open === key) return setOpen(null);
    const rect = button.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 32);
    setAnchor({
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      top: rect.bottom + 8,
    });
    setOpen(key);
  };

  const rangeText = (min: string, max: string) =>
    min && max ? `${min}–${max}` : min ? `≥ ${min}` : max ? `≤ ${max}` : "";

  // What a chip shows when its filter is set (empty = not set).
  const summary: Record<ChipKey, string> = {
    name: filters.name.trim(),
    brand: brands.find((b) => b.key === filters.brand)?.label ?? "",
    type: types.find((type) => type.id === filters.type)?.name ?? "",
    pack: [filters.packUnit, rangeText(filters.packMin, filters.packMax)].filter(Boolean).join(" · "),
    cost: rangeText(filters.costMin, filters.costMax) && `RM ${rangeText(filters.costMin, filters.costMax)}`,
    status: filters.status ? t(`status.${filters.status}`) : "",
    updated: rangeText(filters.from, filters.to),
  };

  const chipFields: Record<ChipKey, (keyof MaterialFilters)[]> = {
    name: ["name"],
    brand: ["brand"],
    type: ["type"],
    pack: ["packUnit", "packMin", "packMax"],
    cost: ["costMin", "costMax"],
    status: ["status"],
    updated: ["from", "to"],
  };

  const clearChip = (key: ChipKey) => {
    const next = { ...filters };
    for (const field of chipFields[key]) next[field] = "";
    setFilters(next);
    writeUrl(next, sort, dir);
    if (open === key) setOpen(null);
  };

  const chipLabels: Record<ChipKey, string> = {
    name: t("name"),
    brand: t("brand"),
    type: t("type"),
    pack: t("mainPack"),
    cost: t("unitCost"),
    status: t("statusLabel"),
    updated: t("updated"),
  };

  const chipBase =
    "inline-flex h-10 shrink-0 items-center rounded-lg border-[1.5px] border-black text-sm font-semibold whitespace-nowrap";

  const chip = (key: ChipKey) => {
    const value = summary[key];
    const active = value !== "";
    return (
      <span
        key={key}
        data-chip
        className={`${chipBase} ${active ? "bg-black text-white" : "bg-white"}`}
      >
        <button
          type="button"
          onClick={(e) => toggle(key, e.currentTarget.parentElement!)}
          aria-expanded={open === key}
          aria-haspopup="dialog"
          className={`flex h-full items-center gap-1.5 ${active ? "pl-3.5 pr-1.5" : "px-3.5"}`}
        >
          <span>{active ? `${chipLabels[key]}: ${value}` : chipLabels[key]}</span>
          {!active && (
            <span aria-hidden className="text-[10px]">
              ▼
            </span>
          )}
        </button>
        {active && (
          <button
            type="button"
            onClick={() => clearChip(key)}
            aria-label={`${t("tableFilter.clear")} ${chipLabels[key]}`}
            className="flex h-full items-center pl-1 pr-3"
          >
            ✕
          </button>
        )}
      </span>
    );
  };

  const sortIcon = (
    <span
      aria-hidden
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-black"
    >
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );

  // Desktop header: click to sort; only the sorted column shows the round arrow.
  const header = (key: SortKey, align: "left" | "right" = "left") => {
    const active = sort === key;
    return (
      <th
        className={`px-5 py-3 font-semibold ${align === "right" ? "text-right" : ""}`}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => clickHeader(key)}
          className={`inline-flex h-7 items-center gap-1.5 ${active ? "text-black" : "hover:text-black"}`}
        >
          {sortLabels[key]}
          {active && sortIcon}
        </button>
      </th>
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
      {/* One row of filter chips (scrolls sideways on phones), plus Sort on phones. */}
      <div className="flex items-center gap-3">
        <div className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-0.5 md:flex-wrap">
          {CHIPS.map(chip)}
        </div>
        <span data-chip className="md:hidden">
          <button
            type="button"
            onClick={(e) => toggle("sort", e.currentTarget)}
            aria-expanded={open === "sort"}
            aria-haspopup="menu"
            className={`${chipBase} gap-1.5 bg-white px-3.5`}
          >
            <span aria-hidden>☰</span>
            {t("tableFilter.sortBy")}
          </button>
        </span>
      </div>

      {open && anchor && (
        <div
          ref={popRef}
          role={open === "sort" ? "menu" : "dialog"}
          aria-label={open === "sort" ? t("tableFilter.sortBy") : chipLabels[open]}
          style={{ left: anchor.left, top: anchor.top, width: "min(18rem, calc(100vw - 2rem))" }}
          className="fixed z-50 flex flex-col gap-3 rounded-2xl border-[1.5px] border-black bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
        >
          {open === "sort" ? (
            <div className="flex flex-col">
              {SORT_KEYS.map((key) => (
                <div key={key}>{option(sort === key, sortLabels[key], () => applySort(key, dir))}</div>
              ))}
              <div className="my-1 border-t border-black/15" />
              {option(dir === "asc", t("tableFilter.ascending"), () => applySort(sort, "asc"))}
              {option(dir === "desc", t("tableFilter.descending"), () => applySort(sort, "desc"))}
            </div>
          ) : (
            <>
              <span className="text-sm font-semibold">{chipLabels[open]}</span>
              {inputs[open]}
              {summary[open] !== "" && (
                <button type="button" onClick={() => clearChip(open)} className="self-start text-sm underline">
                  {t("tableFilter.clear")}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("empty")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {shown.map((row) => (
              <li key={row.id}>
                <Link href={`/raw-materials/${row.id}`} className="flex flex-col gap-2 rounded-[20px] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-semibold">{row.name}</span>
                      <span className="text-sm text-[#3d3f3a]">
                        {row.brand} · {row.type}
                      </span>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
                    <span>
                      {row.pack}
                      {row.extraPacks > 0 && ` +${row.extraPacks}`}
                    </span>
                    <span className="font-semibold tabular-nums">{row.unitCost ?? t("noApprovedCost")}</span>
                  </div>
                  <span className="text-xs text-[#3d3f3a]">
                    {t("updated")} {row.updated}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-[20px] bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/15 text-[#3d3f3a]">
                <tr>
                  {header("name")}
                  {header("brand")}
                  {header("type")}
                  <th className="px-5 py-3 font-semibold">{t("mainPack")}</th>
                  {header("cost", "right")}
                  {header("status")}
                  {header("updated")}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} className="border-b border-black/10 last:border-0">
                    <td className="px-5 py-3">
                      <Link href={`/raw-materials/${row.id}`} className="font-semibold underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{row.brand}</td>
                    <td className="px-5 py-3">{row.type}</td>
                    <td className="px-5 py-3">
                      {row.pack}
                      {row.extraPacks > 0 && <span className="text-[#3d3f3a]"> +{row.extraPacks}</span>}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {row.unitCost ?? <span className="text-[#3d3f3a]">{t("noApprovedCost")}</span>}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">{row.updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
