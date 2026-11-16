"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MeasureUnit } from "@/lib/recipes/types";

export type IngredientOption = {
  ref: string; // "m:<material id>" or "p:<prep recipe id>"
  name: string;
  brand?: string | null;
  // Material type name; Preps are grouped under their own chip.
  type?: string | null;
  typeOrder?: number | null;
  approved?: boolean;
  unit?: MeasureUnit | null;
};

const PREP = "__prep__";
const ALL = "";

// Splits text around the matched part so it can be highlighted.
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

/**
 * Ingredient field of the recipe editor: a search box plus material type chips.
 * Phone: opens as a sheet from the bottom. Desktop: opens as a dropdown under the field.
 */
export function IngredientPicker({
  value,
  label,
  letter,
  materials,
  preps,
  onChange,
}: {
  value: string;
  label: string;
  letter: string;
  materials: IngredientOption[];
  preps: IngredientOption[];
  onChange: (ref: string) => void;
}) {
  const t = useTranslations("Recipes");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState(ALL);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const all = useMemo(() => [...materials, ...preps.map((p) => ({ ...p, type: PREP }))], [materials, preps]);
  const selected = all.find((o) => o.ref === value);
  const q = query.trim();
  const matchesQuery = (o: IngredientOption) =>
    !q || o.name.toLowerCase().includes(q.toLowerCase()) || (o.brand ?? "").toLowerCase().includes(q.toLowerCase());
  const searched = all.filter(matchesQuery);
  const shown = type === ALL ? searched : searched.filter((o) => o.type === type);
  // Type chips in the order set on the Settings page, only types in use; Prep last.
  const types = useMemo(() => {
    const order = new Map<string, number>();
    for (const m of materials) if (m.type) order.set(m.type, m.typeOrder ?? Number.MAX_SAFE_INTEGER);
    const names = [...order.keys()].sort((a, b) => order.get(a)! - order.get(b)! || a.localeCompare(b));
    return preps.length ? [...names, PREP] : names;
  }, [materials, preps]);

  const show = () => {
    setQuery("");
    setType(ALL);
    setActive(0);
    setOpen(true);
  };
  const pick = (ref: string) => {
    onChange(ref);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    search.current?.focus({ preventScroll: true });
    const close = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) pick(shown[active].ref);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const chip = (key: string, text: string, count: number) => (
    <button
      key={key || "all"}
      type="button"
      onClick={() => {
        setType(key);
        setActive(0);
      }}
      aria-pressed={type === key}
      className={`shrink-0 rounded-full border-[1.5px] border-black px-3 py-1 text-sm whitespace-nowrap ${
        type === key ? "bg-black text-white" : "bg-white"
      }`}
    >
      {text} <span className={type === key ? "" : "text-[#6b6d67]"}>{count}</span>
    </button>
  );
  const typeLabel = (key: string) => (key === PREP ? t("prepChip") : key);

  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        className={`flex h-11 w-full items-center justify-between gap-2 rounded-[10px] border-[1.5px] border-black bg-white px-3 text-left text-base ${
          open ? "ring-2 ring-black" : ""
        }`}
      >
        <span className={`truncate ${selected ? "" : "text-[#6b6d67]"}`}>
          {selected
            ? `${selected.name}${selected.brand ? ` (${selected.brand})` : ""}${
                selected.approved === false ? ` (${t("notApproved")})` : ""
              }`
            : value
              ? "—"
              : t("chooseIngredient")}
        </span>
        <span aria-hidden className="text-xs">
          ▾
        </span>
      </button>

      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={t("chooseIngredientFor", { letter })}
            className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-[20px] bg-white p-4 shadow-[0_-6px_24px_rgba(0,0,0,0.2)] md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:top-full md:mt-2 md:h-auto md:max-h-[26rem] md:w-[min(34rem,calc(100vw-4rem))] md:rounded-[12px] md:border-[1.5px] md:border-black md:p-3 md:shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#ccc] md:hidden" />
            <div className="mb-3 flex items-center justify-between md:hidden">
              <span className="font-semibold">{t("chooseIngredientFor", { letter })}</span>
              <button type="button" aria-label={t("close")} onClick={() => setOpen(false)} className="text-lg">
                ✕
              </button>
            </div>
            <div className="flex h-11 items-center gap-2 rounded-[10px] border-[1.5px] border-black px-3">
              <span aria-hidden>🔍</span>
              <input
                ref={search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKey}
                placeholder={t("searchIngredient")}
                aria-label={t("searchIngredient")}
                className="min-w-0 flex-1 bg-transparent text-base outline-none"
              />
              {query && (
                <button type="button" aria-label={t("clearSearch")} onClick={() => setQuery("")}>
                  ✕
                </button>
              )}
            </div>
            <div className="my-3 flex gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
              {chip(ALL, t("allTypes"), searched.length)}
              {types.map((key) => chip(key, typeLabel(key), searched.filter((o) => o.type === key).length))}
            </div>
            <ul ref={list} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto">
              {shown.length === 0 && <li className="px-2 py-6 text-center text-sm text-[#6b6d67]">{t("noIngredientMatch")}</li>}
              {shown.map((o, i) => (
                <li
                  key={o.ref}
                  data-index={i}
                  role="option"
                  aria-selected={o.ref === value}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(o.ref)}
                  className={`flex cursor-pointer items-center justify-between gap-3 border-b border-[#eee] px-2 py-2.5 ${
                    i === active ? "bg-[#f2f2ef]" : ""
                  } ${o.ref === value ? "font-semibold" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      <Highlight text={o.name} query={q} />
                    </span>
                    <span className="block text-xs text-[#6b6d67]">
                      {o.brand ? <Highlight text={o.brand} query={q} /> : o.type === PREP ? t("prepChip") : "—"}
                      {type === ALL && o.type && o.type !== PREP ? ` · ${o.type}` : ""}
                      {o.approved === false && (
                        <span className="ml-1.5 rounded-md bg-brand-orange px-1.5 py-px text-[11px] text-black">
                          {t("notApproved")}
                        </span>
                      )}
                    </span>
                  </span>
                  {o.unit && <span className="shrink-0 rounded-md border border-[#ccc] px-1.5 text-xs">{o.unit}</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
