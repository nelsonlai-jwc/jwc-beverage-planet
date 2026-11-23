"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { errorText, inputClass, labelClass, mutedText, primaryButton, secondaryButton } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { PRODUCTION_NO, type Purpose } from "./types";

export type FinalKind = "ESPRESSO" | "FILTER";

/** A current Final that a new one would replace for one ticked item. */
type Conflict = { useId: string; item: string; createdBy: string; createdAt: string; grind: string };

/** Label of a ticked item: a drink type (espresso) or Hot / Iced (filter). */
export function useItemLabel() {
  const t = useTranslations("Calibration");
  return (kind: FinalKind, item: string) => (kind === "ESPRESSO" ? t(`drink.${item}`) : t(`temp.${item}`));
}

/**
 * Tabs for the drinks a Final is for, with the open tab's panel attached below.
 * Each tab has its own values and saves as its own Final.
 */
export function ItemTabs({
  kind,
  items,
  value,
  summary,
  onChange,
  children,
  idPrefix = "tab",
  shortcuts = true,
}: {
  kind: FinalKind;
  items: string[];
  value: string;
  /** Short values of each filled tab; a tab without one is not filled and is not saved. */
  summary: Partial<Record<string, string>>;
  onChange: (item: string) => void;
  children: React.ReactNode;
  /** Unique per page when several tab sets show at once (the list of Finals). */
  idPrefix?: string;
  /** Keys 1, 2, 3… switch tabs; off where several tab sets show at once. */
  shortcuts?: boolean;
}) {
  const t = useTranslations("Calibration");
  const label = useItemLabel();

  // Keys 1, 2, 3… open the tabs, except while typing in a field.
  useEffect(() => {
    if (!shortcuts) return;
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const item = items[Number(e.key) - 1];
      if (/^[1-9]$/.test(e.key) && item) {
        e.preventDefault();
        onChange(item);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, onChange, shortcuts]);

  return (
    <div className="min-w-0 rounded-[10px] border border-black/15 bg-white">
      <div role="tablist" aria-label={t("tabsLabel")} className="grid grid-cols-2 rounded-t-[9px] bg-[#f5f5f3] sm:flex">
        {items.map((item, index) => {
          const on = value === item;
          const text = summary[item];
          return (
            <button
              key={item}
              id={`${idPrefix}-${item}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`${idPrefix}-panel`}
              aria-keyshortcuts={shortcuts ? String(index + 1) : undefined}
              onClick={() => onChange(item)}
              className={`group relative flex h-[50px] min-w-0 flex-col items-start justify-center gap-0.5 border-t-2 border-r border-b border-r-black/15 px-3 text-left first:rounded-tl-[9px] sm:px-4 ${
                on ? "border-t-black border-b-transparent bg-white" : "border-t-transparent border-b-black/15 hover:bg-white/60"
              }`}
            >
              <span className={`flex max-w-full items-center gap-1.5 text-[14px] leading-5 ${on ? "text-black" : "text-[#4d4d4d]"}`}>
                <span aria-hidden className={`size-2.5 shrink-0 rounded-[2px] ${text ? "bg-brand-green" : "bg-black/20"}`} />
                <span className="truncate">{label(kind, item)}</span>
              </span>
              <span className="max-w-full truncate text-[12px] leading-4 text-[#6b6d67]">{text ?? t("tabEmpty")}</span>
              {/* Hover hint with the key, like Supabase. */}
              {shortcuts && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-full left-1/2 z-10 mt-1.5 hidden -translate-x-1/2 items-center gap-1.5 rounded-md bg-black px-2 py-1 text-[12px] whitespace-nowrap text-white sm:group-hover:flex"
                >
                  {t("switchTo", { name: label(kind, item) })}
                  <kbd className="rounded border border-white/30 px-1 font-sans text-[11px]">{index + 1}</kbd>
                </span>
              )}
            </button>
          );
        })}
        <div aria-hidden className="hidden flex-1 rounded-tr-[9px] border-b border-black/15 sm:block" />
      </div>
      <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-${value}`} className="flex flex-col gap-3 p-3 sm:p-4">
        {children}
      </div>
    </div>
  );
}

/** Copy the open tab's values to another tab: a dropdown and an "Apply to" button. */
export function ApplyTo({
  kind,
  items,
  current,
  onApply,
}: {
  kind: FinalKind;
  items: string[];
  current: string;
  onApply: (item: string) => void;
}) {
  const t = useTranslations("Calibration");
  const label = useItemLabel();
  const others = items.filter((x) => x !== current);
  const [target, setTarget] = useState(others[0] ?? "");
  const chosen = others.includes(target) ? target : others[0];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 sm:max-w-60">
          <select aria-label={t("applyToLabel")} value={chosen} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
            {others.map((x) => (
              <option key={x} value={x}>
                {label(kind, x)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={secondaryButton} onClick={() => chosen && onApply(chosen)}>
          {t("applyTo")}
        </button>
      </div>
      <p className={mutedText}>{t("applyToHint")}</p>
    </div>
  );
}

export const productionNoProblem = (value: string) => !!value.trim() && !PRODUCTION_NO.test(value.trim());

/** Production number of the bag (optional), e.g. PR-47481; a wrong format shows in red. */
export function ProductionNoField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const t = useTranslations("Calibration");
  const bad = productionNoProblem(value);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {t("productionNo")}
      </label>
      <input
        id={id}
        value={value}
        maxLength={20}
        autoCapitalize="characters"
        placeholder="PR-47481"
        aria-invalid={bad}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className={`${inputClass} ${bad ? "border-[#c4161c]" : ""}`}
      />
      <span className={bad ? "text-[13px] font-semibold text-[#c4161c]" : mutedText}>
        {bad ? t("productionNoInvalid") : t("productionNoHint")}
      </span>
    </div>
  );
}

/** The current daily Finals that a new Final for these items would replace. */
async function currentFinals(
  kind: FinalKind,
  key: { outletId: string; date: string; beanId: string; grinderId: string },
  items: string[],
): Promise<Conflict[] | null> {
  const supabase = createClient();
  const base = { purpose: "DAILY", outlet_id: key.outletId, business_date: key.date, coffee_bean_material_id: key.beanId, grinder_id: key.grinderId };
  let uses: { id: string; item: string; record: string }[];
  if (kind === "ESPRESSO") {
    const { data, error } = await supabase
      .from("calibration_drinks")
      .select("id, drink_type, calibration_id")
      .match(base)
      .is("superseded_by", null)
      .eq("record_deleted", false)
      .in("drink_type", items);
    if (error) return null;
    uses = (data ?? []).map((u) => ({ id: u.id, item: u.drink_type, record: u.calibration_id }));
  } else {
    const { data, error } = await supabase
      .from("filter_calibration_uses")
      .select("id, temperature, filter_calibration_id")
      .match(base)
      .is("superseded_by", null)
      .eq("record_deleted", false)
      .in("temperature", items);
    if (error) return null;
    uses = (data ?? []).map((u) => ({ id: u.id, item: u.temperature, record: u.filter_calibration_id }));
  }
  if (uses.length === 0) return [];
  const ids = [...new Set(uses.map((u) => u.record))];
  const { data: records } = await supabase
    .from(kind === "ESPRESSO" ? "calibrations" : "filter_calibrations")
    .select("id, created_by, created_at, grind_setting")
    .in("id", ids);
  const people = [...new Set((records ?? []).map((r) => r.created_by))];
  const { data: profiles } = people.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", people)
    : { data: [] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));
  const recordOf = new Map((records ?? []).map((r) => [r.id, r]));
  return uses.map((u) => {
    const r = recordOf.get(u.record);
    return {
      useId: u.id,
      item: u.item,
      createdBy: (r && nameOf.get(r.created_by)) ?? "—",
      createdAt: r?.created_at ?? "",
      grind: r?.grind_setting ?? "—",
    };
  });
}

/** One Final to save: a record and the drink(s) it is for. */
export type FinalToSave = { record: Record<string, unknown>; items: string[] };

/** Editing: new values for a Final of the session (revision guards against edits meanwhile). */
export type FinalUpdate = { id: string; revision: number; record: Record<string, unknown> };

type Pending = { finals: FinalToSave[]; updates: FinalUpdate[]; conflicts: Conflict[] };

/**
 * Saves one or more Finals together (all or none). Daily Finals first look for current Finals of
 * the same bean, grinder and drinks; when there are any, the person sees them and must agree
 * before they are replaced.
 */
export function useFinalSave({
  kind,
  purpose,
  outletId,
  date,
  session,
  onSaved,
}: {
  kind: FinalKind;
  purpose: Purpose;
  outletId: string | null;
  date: string;
  /** Editing this session: its Finals are updated and empty tabs are added to it. */
  session?: string;
  onSaved: () => void;
}) {
  const t = useTranslations("Calibration");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const allItems = (finals: FinalToSave[]) => finals.flatMap((f) => f.items);

  async function check(finals: FinalToSave[]): Promise<Conflict[] | null> {
    if (purpose !== "DAILY" || !outletId || finals.length === 0) return [];
    // Bean and grinder are shared by every tab.
    const record = finals[0].record;
    return currentFinals(
      kind,
      { outletId, date, beanId: String(record.coffee_bean_material_id), grinderId: String(record.grinder_id) },
      allItems(finals),
    );
  }

  async function save(finals: FinalToSave[], updates: FinalUpdate[], conflicts: Conflict[]) {
    setBusy(true);
    setError(null);
    const p_finals = finals.map((f) => ({
      record: { ...f.record, purpose, outlet_id: outletId, business_date: date },
      uses: f.items,
      replace: conflicts.filter((c) => f.items.includes(c.item)).map((c) => c.useId),
    }));
    const supabase = createClient();
    const { error: saveError } = session
      ? await supabase.rpc(kind === "ESPRESSO" ? "edit_espresso_calibrations" : "edit_filter_calibrations", {
          p_session: session,
          p_updates: updates,
          p_finals,
        } as never)
      : await supabase.rpc(kind === "ESPRESSO" ? "save_espresso_calibrations" : "save_filter_calibrations", { p_finals } as never);
    if (saveError) {
      // 40001 / 23505: someone saved a Final for the same drink (or edited this one) meanwhile.
      if (saveError.code === "40001" || saveError.code === "23505") {
        const now = await check(finals);
        setBusy(false);
        setError(session && !now?.length ? t("conflict") : t("changedMeanwhile"));
        if (now?.length) setPending({ finals, updates, conflicts: now });
        return;
      }
      if (saveError.code === "42501" && session) {
        setBusy(false);
        setError(t("editNotAllowed"));
        return;
      }
      setBusy(false);
      setError(t("saveFailed"));
      return;
    }
    setBusy(false);
    setPending(null);
    toast("saved");
    onSaved();
  }

  async function submit(finals: FinalToSave[], updates: FinalUpdate[] = []) {
    if (busy || finals.length + updates.length === 0) return;
    setBusy(true);
    setError(null);
    const conflicts = await check(finals);
    if (conflicts === null) {
      setBusy(false);
      setError(t("saveFailed"));
      return;
    }
    if (conflicts.length) {
      setBusy(false);
      setPending({ finals, updates, conflicts });
      return;
    }
    await save(finals, updates, []);
  }

  const warning = pending ? (
    <ReplaceWarning
      kind={kind}
      conflicts={pending.conflicts}
      busy={busy}
      onConfirm={() => save(pending.finals, pending.updates, pending.conflicts)}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { busy, setBusy, error, setError, submit, warning, pending: !!pending };
}

function ReplaceWarning({
  kind,
  conflicts,
  busy,
  onConfirm,
  onCancel,
}: {
  kind: FinalKind;
  conflicts: Conflict[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Calibration");
  const format = useFormatter();
  const label = useItemLabel();
  return (
    <div role="alertdialog" aria-label={t("replaceTitle")} className="flex flex-col gap-3 rounded-[12px] border-[1.5px] border-black bg-brand-orange/30 p-4">
      <p className="text-sm font-semibold">{t("replaceTitle")}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {conflicts.map((c) => (
          <li key={c.useId}>
            {t("replaceLine", {
              item: label(kind, c.item),
              name: c.createdBy,
              time: c.createdAt
                ? format.dateTime(new Date(c.createdAt), { timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" })
                : "—",
              grind: c.grind,
            })}
          </li>
        ))}
      </ul>
      <p className={mutedText}>{t("replaceNote")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onConfirm} className={primaryButton}>
          {busy ? t("saving") : t("replaceConfirm")}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={secondaryButton}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

export function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className={errorText}>
      {error}
    </p>
  ) : null;
}
