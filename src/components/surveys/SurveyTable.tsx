"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  useOutletPrefix,
  useSubjectBadge,
  useSubjectLabel,
  type SurveyInfo,
} from "@/components/surveys/SurveyForm";
import type { SurveyRow } from "@/components/surveys/SurveyList";
import { cardClass, mutedText, smallButton } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";

// "Surveys you run" as a table: filter chips above, ▲▼ sorting in the header,
// and a Sort by menu with two-line rows on phones (same look as the Raw Material table).

const CHIPS = ["name", "type", "audience", "outlet", "status", "date"] as const;
type ChipKey = (typeof CHIPS)[number];
const SORT_KEYS = ["name", "date", "status", "answers"] as const;
type SortKey = (typeof SORT_KEYS)[number];
type SortDir = "asc" | "desc";
const TYPES = ["ESPRESSO", "FILTER", "RECIPE", "CUSTOM"] as const;

type Filters = {
  name: string;
  type: string;
  audience: string;
  outlet: string;
  status: string;
  from: string;
  to: string;
};
const EMPTY: Filters = { name: "", type: "", audience: "", outlet: "", status: "", from: "", to: "" };

const chipFields: Record<ChipKey, (keyof Filters)[]> = {
  name: ["name"],
  type: ["type"],
  audience: ["audience"],
  outlet: ["outlet"],
  status: ["status"],
  date: ["from", "to"],
};

const compactInput =
  "h-9 w-full min-w-0 rounded-lg border border-black/35 bg-white px-2 text-sm font-normal";
const chipBase =
  "inline-flex h-8 shrink-0 items-center rounded-full border border-black/70 text-[13px] font-semibold whitespace-nowrap";

const outletsOf = (info: SurveyInfo) =>
  info.outlets?.length ? info.outlets : info.outlet ? [info.outlet] : [];
const typeOf = (info: SurveyInfo) => (info.title ? "CUSTOM" : info.subject_type);

export function SurveyTable({ rows }: { rows: SurveyRow[] }) {
  const t = useTranslations("Surveys");
  const tf = useTranslations("RawMaterials.tableFilter");
  const format = useFormatter();
  const subject = useSubjectLabel();
  const badge = useSubjectBadge();
  const outletPrefix = useOutletPrefix();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<SortDir>("desc");

  const time = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuala_Lumpur",
    });
  const statusText = (r: SurveyRow) =>
    r.info.open ? t("openUntil", { time: time(r.info.closes_at) }) : t("closed");

  const outletNames = useMemo(
    () => [...new Set(rows.flatMap((r) => outletsOf(r.info)))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const shown = useMemo(() => {
    const name = filters.name.trim().toLowerCase();
    const kept = rows.filter((r) => {
      if (name && !subject(r.info).toLowerCase().includes(name)) return false;
      if (filters.type && typeOf(r.info) !== filters.type) return false;
      if (filters.audience && r.info.audience !== filters.audience) return false;
      if (filters.outlet && !outletsOf(r.info).includes(filters.outlet)) return false;
      if (filters.status && (filters.status === "open") !== r.info.open) return false;
      if (filters.from && r.info.date < filters.from) return false;
      if (filters.to && r.info.date > filters.to) return false;
      return true;
    });
    const sign = dir === "asc" ? 1 : -1;
    const compare = (a: SurveyRow, b: SurveyRow) => {
      switch (sort) {
        case "name":
          return subject(a.info).localeCompare(subject(b.info));
        case "date":
          return a.info.date.localeCompare(b.info.date);
        case "status":
          return Number(b.info.open) - Number(a.info.open);
        case "answers":
          return a.answers - b.answers;
      }
    };
    // Rows arrive newest first, so ties keep the newest on top.
    return [...kept].sort((a, b) => sign * compare(a, b));
  }, [rows, filters, sort, dir, subject]);

  const setFilter = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const applySort = (key: SortKey, nextDir: SortDir) => {
    setSort(key);
    setDir(nextDir);
  };

  const labels: Record<ChipKey | SortKey, string> = {
    name: t("table.name"),
    type: t("table.type"),
    audience: t("audienceLabel"),
    outlet: t("outlet"),
    status: t("table.status"),
    date: t("table.date"),
    answers: t("table.answers"),
  };

  const select = (key: keyof Filters, options: [string, string][]) => (
    <select
      value={filters[key]}
      onChange={(e) => setFilter(key, e.target.value)}
      aria-label={labels[key as ChipKey]}
      className={compactInput}
    >
      <option value="">{tf("all")}</option>
      {options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );

  const typeLabel = (type: string) => t(`subject.${type}`);
  const inputs: Record<ChipKey, React.ReactNode> = {
    name: (
      <input
        type="search"
        value={filters.name}
        onChange={(e) => setFilter("name", e.target.value)}
        placeholder={tf("contains")}
        aria-label={labels.name}
        className={compactInput}
      />
    ),
    type: select("type", TYPES.map((v) => [v, typeLabel(v)])),
    audience: select("audience", (["OUTLET", "PUBLIC"] as const).map((v) => [v, t(`audience.${v}`)])),
    outlet: select("outlet", outletNames.map((n) => [n, n])),
    status: select("status", [
      ["open", t("table.open")],
      ["closed", t("closed")],
    ]),
    date: (
      <div className="flex flex-col gap-1.5">
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilter("from", e.target.value)}
          aria-label={`${labels.date} ${tf("from")}`}
          title={tf("from")}
          className={compactInput}
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilter("to", e.target.value)}
          aria-label={`${labels.date} ${tf("to")}`}
          title={tf("to")}
          className={compactInput}
        />
      </div>
    ),
  };

  const rangeText = (min: string, max: string) =>
    min && max ? `${min}–${max}` : min ? `≥ ${min}` : max ? `≤ ${max}` : "";
  const summary: Record<ChipKey, string> = {
    name: filters.name.trim(),
    type: filters.type ? typeLabel(filters.type) : "",
    audience: filters.audience ? t(`audience.${filters.audience}`) : "",
    outlet: filters.outlet,
    status: filters.status === "open" ? t("table.open") : filters.status === "closed" ? t("closed") : "",
    date: rangeText(filters.from, filters.to),
  };

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

  const clearChip = (key: ChipKey) => {
    setFilters((f) => {
      const next = { ...f };
      for (const field of chipFields[key]) next[field] = "";
      return next;
    });
    if (open === key) setOpen(null);
  };

  const chip = (key: ChipKey) => {
    const value = summary[key];
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
            onClick={() => clearChip(key)}
            aria-label={`${tf("clear")} ${labels[key]}`}
            className="flex h-full items-center pl-1 pr-3"
          >
            ✕
          </button>
        )}
      </span>
    );
  };

  // Desktop header: the name toggles the sort; a faint ▲▼ pair next to it sorts directly.
  const header = (key: SortKey, align: "left" | "right" = "left") => {
    const active = sort === key;
    const arrow = (d: SortDir) => {
      const on = active && dir === d;
      return (
        <button
          type="button"
          onClick={() => applySort(key, d)}
          aria-label={`${labels[key]} ${tf(d === "asc" ? "ascending" : "descending")}`}
          aria-pressed={on}
          className={`flex h-3 w-4 items-center justify-center text-[9px] leading-none ${on ? "text-black" : "text-black/25 hover:text-black/60"}`}
        >
          {d === "asc" ? "▲" : "▼"}
        </button>
      );
    };
    return (
      <th
        className={`px-4 py-3 font-semibold ${align === "right" ? "text-right" : ""}`}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <span className={`inline-flex h-7 items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
          <button
            type="button"
            onClick={() => applySort(key, active && dir === "asc" ? "desc" : "asc")}
            className={active ? "text-black" : undefined}
          >
            {labels[key]}
          </button>
          <span className="flex flex-col">
            {arrow("asc")}
            {arrow("desc")}
          </span>
        </span>
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

  const plainTh = "px-4 py-3 font-semibold";

  return (
    <div className="flex flex-col gap-4">
      {/* One row of filter chips, plus Sort by on phones. */}
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map(chip)}
        <span data-chip className="xl:hidden">
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
              {SORT_KEYS.map((key) => (
                <div key={key}>{option(sort === key, labels[key], () => applySort(key, dir))}</div>
              ))}
              <div className="my-1 border-t border-black/15" />
              {option(dir === "asc", tf("ascending"), () => applySort(sort, "asc"))}
              {option(dir === "desc", tf("descending"), () => applySort(sort, "desc"))}
            </div>
          ) : (
            <>
              <span className="text-sm font-semibold">{labels[open]}</span>
              {inputs[open]}
              {summary[open] !== "" && (
                <button type="button" onClick={() => clearChip(open)} className="self-start text-sm underline">
                  {tf("clear")}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className={`${cardClass} text-sm`}>{rows.length === 0 ? t("noRun") : t("table.noMatch")}</p>
      ) : (
        <>
          {/* Phones and tablets: two compact lines per survey. */}
          <ul className="flex flex-col divide-y divide-black/10 overflow-hidden rounded-[20px] bg-white xl:hidden">
            {shown.map((r) => (
              <li key={r.id}>
                <Link href={`/surveys/${r.id}`} className="flex flex-col gap-0.5 px-4 py-3">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-semibold">{subject(r.info)}</span>
                    <span className="shrink-0 text-sm tabular-nums">
                      {t("answers", { count: r.answers })}
                    </span>
                  </span>
                  <span className={`${mutedText} text-xs`}>
                    {badge(r.info)} · {t(`audience.${r.info.audience}`)} · {outletPrefix(r.info)}
                    {r.info.date} · {statusText(r)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: full table. */}
          <div className="hidden overflow-hidden rounded-[20px] bg-white xl:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/15 text-[#3d3f3a]">
                <tr>
                  <th className={plainTh}>{labels.type}</th>
                  {header("name")}
                  <th className={plainTh}>{labels.audience}</th>
                  <th className={plainTh}>{labels.outlet}</th>
                  {header("date")}
                  {header("status")}
                  {header("answers", "right")}
                  <th className={plainTh}>
                    <span className="sr-only">{t("results")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b border-black/10 last:border-0">
                    <td className="px-4 py-3 whitespace-nowrap">{badge(r.info)}</td>
                    <td className="px-4 py-3">
                      <Link href={`/surveys/${r.id}`} className="font-semibold underline">
                        {subject(r.info)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{t(`audience.${r.info.audience}`)}</td>
                    <td className="px-4 py-3">{outletsOf(r.info).join(t("outletSeparator")) || "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">{r.info.date}</td>
                    <td className="px-4 py-3">{statusText(r)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.answers}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/surveys/${r.id}`} className={smallButton}>
                        {t("results")}
                      </Link>
                    </td>
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
