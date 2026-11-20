"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
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

/** Chips to tick the drinks a Final applies to. */
export function AppliesTo({
  kind,
  items,
  value,
  onChange,
}: {
  kind: FinalKind;
  items: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const t = useTranslations("Calibration");
  const label = useItemLabel();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">{t("appliesTo")}</legend>
      <p className={mutedText}>{t("appliesToHint")}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const on = value.includes(item);
          return (
            <button
              key={item}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onChange(on ? value.filter((x) => x !== item) : items.filter((x) => x === item || value.includes(x)))}
              className={`inline-flex h-9 items-center rounded-full border-[1.5px] px-4 text-sm font-semibold ${
                on ? "border-black bg-black text-white" : "border-black/40 bg-white"
              }`}
            >
              {on ? "✓ " : ""}
              {label(kind, item)}
            </button>
          );
        })}
      </div>
    </fieldset>
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

type Pending = { record: Record<string, unknown>; items: string[]; conflicts: Conflict[] };

/**
 * Saves a Final. A daily Final first looks for current Finals of the same bean, grinder and
 * ticked items; when there are any, the person sees them and must agree before they are replaced.
 */
export function useFinalSave({
  kind,
  purpose,
  outletId,
  date,
  onSaved,
}: {
  kind: FinalKind;
  purpose: Purpose;
  outletId: string | null;
  date: string;
  onSaved: () => void;
}) {
  const t = useTranslations("Calibration");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  async function check(record: Record<string, unknown>, items: string[]): Promise<Conflict[] | null> {
    if (purpose !== "DAILY" || !outletId) return [];
    return currentFinals(
      kind,
      { outletId, date, beanId: String(record.coffee_bean_material_id), grinderId: String(record.grinder_id) },
      items,
    );
  }

  async function save(record: Record<string, unknown>, items: string[], replace: string[]) {
    setBusy(true);
    setError(null);
    const args = { p_record: { ...record, purpose, outlet_id: outletId, business_date: date }, p_uses: items, p_replace: replace };
    const { error: saveError } = await createClient().rpc(
      kind === "ESPRESSO" ? "save_espresso_calibration" : "save_filter_calibration",
      args as never,
    );
    if (saveError) {
      // 40001 / 23505: someone saved a Final for the same item meanwhile. Show the new situation.
      if (saveError.code === "40001" || saveError.code === "23505") {
        const conflicts = await check(record, items);
        setBusy(false);
        setError(t("changedMeanwhile"));
        if (conflicts?.length) setPending({ record, items, conflicts });
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

  async function submit(record: Record<string, unknown>, items: string[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const conflicts = await check(record, items);
    if (conflicts === null) {
      setBusy(false);
      setError(t("saveFailed"));
      return;
    }
    if (conflicts.length) {
      setBusy(false);
      setPending({ record, items, conflicts });
      return;
    }
    await save(record, items, []);
  }

  const warning = pending ? (
    <ReplaceWarning
      kind={kind}
      conflicts={pending.conflicts}
      busy={busy}
      onConfirm={() => save(pending.record, pending.items, pending.conflicts.map((c) => c.useId))}
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
