"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { mutedText } from "@/components/ui/styles";
import type { Bean } from "./types";

const ALL = "";
const RECENT = "__recent__";
const NO_BRAND = "__none__";

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-brand-green">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/** Pick a coffee bean: search by name or brand, chips for recently used beans and for each brand. */
export function BeanPicker({ beans, recent, onPick }: { beans: Bean[]; recent: string[]; onPick: (id: string) => void }) {
  const t = useTranslations("Calibration");
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState(recent.length ? RECENT : ALL);
  const q = query.trim().toLowerCase();
  const recentSet = useMemo(() => new Set(recent), [recent]);
  const brands = useMemo(
    () => [...new Set(beans.map((b) => b.brand || NO_BRAND))].sort((a, b) => (a === NO_BRAND ? 1 : b === NO_BRAND ? -1 : a.localeCompare(b))),
    [beans],
  );
  const searched = beans.filter((b) => !q || b.name.toLowerCase().includes(q) || (b.brand ?? "").toLowerCase().includes(q));
  const inChip = (b: Bean, key: string) =>
    key === ALL ? true : key === RECENT ? recentSet.has(b.id) : (b.brand || NO_BRAND) === key;
  const shown = searched.filter((b) => inChip(b, chip));

  const chipButton = (key: string, text: string) => (
    <button
      key={key || "all"}
      type="button"
      aria-pressed={chip === key}
      onClick={() => setChip(key)}
      className={`shrink-0 rounded-full border-[1.5px] border-black px-3 py-1 text-sm whitespace-nowrap ${
        chip === key ? "bg-black text-white" : "bg-white"
      }`}
    >
      {text} <span className={chip === key ? "" : "text-[#6b6d67]"}>{searched.filter((b) => inChip(b, key)).length}</span>
    </button>
  );

  if (beans.length === 0) return <p className="text-sm">{t("noBeans")}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-11 items-center gap-2 rounded-[10px] border-[1.5px] border-black px-3">
        <span aria-hidden>🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchBean")}
          aria-label={t("searchBean")}
          className="min-w-0 flex-1 bg-transparent text-base outline-none"
        />
        {query && (
          <button type="button" aria-label={t("clearSearch")} onClick={() => setQuery("")}>
            ✕
          </button>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
        {recent.length > 0 && chipButton(RECENT, t("recentBeans"))}
        {chipButton(ALL, t("allBeans"))}
        {brands.map((brand) => chipButton(brand, brand === NO_BRAND ? t("noBrand") : brand))}
      </div>
      <ul role="listbox" aria-label={t("bean")} className="max-h-[50dvh] overflow-y-auto rounded-[12px] border border-black/15">
        {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-[#6b6d67]">{t("noBeanMatch")}</li>}
        {shown.map((b) => (
          <li
            key={b.id}
            role="option"
            aria-selected={false}
            onClick={() => onPick(b.id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(b.id)}
            tabIndex={0}
            className="flex cursor-pointer items-center justify-between gap-3 border-b border-[#eee] px-3 py-2.5 last:border-0 hover:bg-[#f2f2ef] focus:bg-[#f2f2ef] focus:outline-none"
          >
            <span className="min-w-0">
              <span className="block font-semibold">
                <Highlight text={b.name} query={q} />
              </span>
              <span className={`block ${mutedText}`}>{b.brand ? <Highlight text={b.brand} query={q} /> : "—"}</span>
            </span>
            {recentSet.has(b.id) && <span className="shrink-0 rounded-md border border-[#ccc] px-1.5 text-xs">{t("recentTag")}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
