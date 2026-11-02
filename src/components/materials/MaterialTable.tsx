"use client";

import { useMemo, useState } from "react";
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
import { StatusBadge, inputClass, secondaryButtonClass } from "./ui";

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
  const [panelOpen, setPanelOpen] = useState(false);

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

  // The same controls are used in the desktop header row and the phone filter panel.
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

  const desktop = controls(compactInput);
  const phone = controls(inputClass);
  const activeCount = Object.values(filters).filter(Boolean).length;

  const header = (key: SortKey, align: "left" | "right" = "left") => {
    const active = sort === key;
    return (
      <th
        className={`px-3 py-3 font-semibold ${align === "right" ? "text-right" : ""}`}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => clickHeader(key)}
          className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}
        >
          {sortLabels[key]}
          <span aria-hidden className={active ? "" : "opacity-30"}>
            {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
      </th>
    );
  };

  const empty = <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("empty")}</p>;

  return (
    <div className="flex flex-col gap-4">
      {/* Phone: sort dropdown plus a filter panel, since cards have no header. */}
      <div className="flex flex-col gap-3 md:hidden">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <select
            value={`${sort}:${dir}`}
            onChange={(e) => {
              const [key, nextDir] = e.target.value.split(":") as [SortKey, SortDir];
              applySort(key, nextDir);
            }}
            aria-label={t("tableFilter.sortBy")}
            className={inputClass}
          >
            {SORT_KEYS.flatMap((key) =>
              (["asc", "desc"] as const).map((d) => (
                <option key={`${key}:${d}`} value={`${key}:${d}`}>
                  {t("tableFilter.sortBy")}: {sortLabels[key]} {d === "asc" ? "↑" : "↓"}
                </option>
              )),
            )}
          </select>
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
            className={secondaryButtonClass}
          >
            {t("filter")}
            {activeCount > 0 && (
              <span className="ml-2 rounded-full bg-black px-2 text-xs text-white">{activeCount}</span>
            )}
          </button>
        </div>
        {panelOpen && (
          <div className="flex flex-col gap-3 rounded-[20px] bg-white p-4">
            {(
              [
                ["name", t("name")],
                ["brand", t("brand")],
                ["type", t("type")],
                ["pack", t("mainPack")],
                ["cost", t("unitCost")],
                ["status", t("statusLabel")],
                ["updated", t("updated")],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{label}</span>
                {phone[key]}
              </div>
            ))}
          </div>
        )}
        {shown.length === 0 ? (
          empty
        ) : (
          <ul className="flex flex-col gap-3">
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
        )}
      </div>

      {/* Desktop: click a header to sort, filter in the row under it. */}
      <div className="hidden overflow-x-auto rounded-[20px] bg-white md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-black/15 text-[#3d3f3a]">
            <tr>
              {header("name")}
              {header("brand")}
              {header("type")}
              <th className="px-3 py-3 font-semibold">{t("mainPack")}</th>
              {header("cost", "right")}
              {header("status")}
              {header("updated")}
            </tr>
            <tr className="align-top">
              <td className="px-3 pb-3">{desktop.name}</td>
              <td className="px-3 pb-3">{desktop.brand}</td>
              <td className="px-3 pb-3">{desktop.type}</td>
              <td className="w-36 px-3 pb-3">{desktop.pack}</td>
              <td className="w-44 px-3 pb-3">{desktop.cost}</td>
              <td className="px-3 pb-3">{desktop.status}</td>
              <td className="w-40 px-3 pb-3">{desktop.updated}</td>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-[#3d3f3a]">
                  {t("empty")}
                </td>
              </tr>
            )}
            {shown.map((row) => (
              <tr key={row.id} className="border-b border-black/10 last:border-0">
                <td className="px-3 py-3">
                  <Link href={`/raw-materials/${row.id}`} className="font-semibold underline">
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-3">{row.brand}</td>
                <td className="px-3 py-3">{row.type}</td>
                <td className="px-3 py-3">
                  {row.pack}
                  {row.extraPacks > 0 && <span className="text-[#3d3f3a]"> +{row.extraPacks}</span>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.unitCost ?? <span className="text-[#3d3f3a]">{t("noApprovedCost")}</span>}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">{row.updated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
