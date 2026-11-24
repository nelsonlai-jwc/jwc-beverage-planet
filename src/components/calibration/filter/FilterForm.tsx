"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { inputClass, labelClass, mutedText, primaryButton, secondaryButton } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { checkRange, daysOffRoast, type RangeCheck } from "@/lib/calibration/calc";
import { filterExtractionYield, waterRatio } from "@/lib/calibration/filterCalc";
import { createClient } from "@/lib/supabase/client";
import { BeanTargetForm } from "../BeanTargetForm";
import { EquipmentSelect, OTHER, equipmentColumns } from "../EquipmentSelect";
import {
  ApplyTo,
  DotLegend,
  FormError,
  ItemTabs,
  ProductionNoField,
  productionNoProblem,
  useFinalSave,
  type SavedFinal,
  type TabStatus,
} from "../FinalParts";
import { rpmProblem, type Grinder, type Purpose, type TasteBalance } from "../types";
import { FilterBrewList } from "./FilterBrewList";
import { FILTER_TEMPS, type Brewer, type FilterBrew, type FilterRecord, type FilterTarget, type FilterTemp, type FilterValues } from "./types";

type FormState = {
  brewerId: string;
  brewerName: string;
  grinderId: string;
  grinderName: string;
  grind: string;
  rpm: string;
  roastDate: string;
};

/** The brew values of one tab (Hot or Iced). */
type BrewState = {
  dose: string;
  water: string;
  temp: string;
  bloomWater: string;
  bloomSeconds: string;
  pours: string;
  time: string;
  beverage: string;
  tds: string;
  balance: string;
  notes: string;
};

const EMPTY_BREW: BrewState = {
  dose: "",
  water: "",
  temp: "",
  bloomWater: "",
  bloomSeconds: "",
  pours: "",
  time: "",
  beverage: "",
  tds: "",
  balance: "",
  notes: "",
};
const isFilled = (brew: BrewState) => Object.values(brew).some((v) => v.trim() !== "");

const str = (value: number | string | null | undefined) => (value == null ? "" : String(value));

function fromValues(v: Partial<FilterValues> & { roast_date?: string | null }, base: FormState): FormState {
  return {
    ...base,
    grinderId: v.grinder_id ?? (v.grinder_name ? OTHER : base.grinderId),
    grinderName: v.grinder_name ?? base.grinderName,
    grind: v.grind_setting ?? "",
    rpm: str(v.grinder_rpm),
    roastDate: v.roast_date !== undefined ? str(v.roast_date) : base.roastDate,
  };
}

function brewFromValues(v: FilterValues): BrewState {
  return {
    dose: str(v.dose_g),
    water: str(v.water_g),
    temp: str(v.water_temp_c),
    bloomWater: str(v.bloom_water_g),
    bloomSeconds: str(v.bloom_seconds),
    pours: str(v.pour_count),
    time: str(v.total_time_seconds),
    beverage: str(v.beverage_g),
    tds: str(v.tds_percent),
    balance: v.taste_balance ?? "",
    notes: v.taste_notes ?? "",
  };
}

function optionalNumber(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const rangeMark: Record<RangeCheck, string> = { LOW: "↓", OK: "✓", HIGH: "↑" };

/** Filter: dial in with test brews in Hot / Iced tabs, then set each tab as its own Final. */
export function FilterForm({
  purpose,
  outletId,
  date,
  beanId,
  brewers,
  grinders,
  target,
  previous,
  brews,
  brewerNames,
  canManage,
  edit,
  onDone,
}: {
  purpose: Purpose;
  /** Daily records only. */
  outletId: string | null;
  date: string;
  beanId: string;
  brewers: Brewer[];
  grinders: Grinder[];
  target: FilterTarget | undefined;
  /** Earlier Finals of this bean to reuse, newest first: daily yesterday's, custom my last ones. */
  previous: FilterRecord[];
  /** Test brews of this bean today. */
  brews: FilterBrew[];
  brewerNames: Map<string, string>;
  canManage: boolean;
  /** Editing a saved session: its current Finals (one per tab). */
  edit?: { session: string; records: FilterRecord[] };
  onDone: () => void;
}) {
  const t = useTranslations("Calibration");
  const tf = useTranslations("FilterCalibration");
  const router = useRouter();
  const custom = purpose === "CUSTOM";
  // Editing: the saved Final of each tab.
  const recordOf = new Map<string, FilterRecord>();
  for (const r of edit?.records ?? []) for (const u of r.uses) if (!u.superseded_by && !recordOf.has(u.item)) recordOf.set(u.item, r);
  const [editSaved] = useState(() =>
    edit ? { session: edit.session, saved: new Map<string, SavedFinal>([...recordOf].map(([x, r]) => [x, { id: r.id, revision: r.revision }])) } : undefined,
  );
  const final = useFinalSave({ kind: "FILTER", purpose, outletId, date, edit: editSaved });
  const { busy, setBusy, error, setError } = final;
  const first = edit?.records[0];
  const [editTarget, setEditTarget] = useState(false);
  const [tab, setTab] = useState<FilterTemp>(() => FILTER_TEMPS.find((x) => recordOf.has(x)) ?? "HOT");
  const [tabs, setTabs] = useState<Record<FilterTemp, BrewState>>(() => {
    const start: Record<FilterTemp, BrewState> = { HOT: EMPTY_BREW, ICED: EMPTY_BREW };
    for (const [x, r] of recordOf) start[x as FilterTemp] = brewFromValues(r);
    return start;
  });
  const [productionNo, setProductionNo] = useState(first?.production_no ?? "");
  const [form, setForm] = useState<FormState>(() => {
    const blank: FormState = {
      brewerId: brewers.find((b) => b.is_active)?.id ?? (custom ? OTHER : ""),
      brewerName: "",
      grinderId: grinders.find((g) => g.is_active)?.id ?? (custom ? OTHER : ""),
      grinderName: "",
      grind: "",
      rpm: "",
      roastDate: "",
    };
    // Editing: the saved values, with the saved brewer.
    return first
      ? { ...fromValues(first, blank), brewerId: first.brewer_id ?? (first.brewer_name ? OTHER : ""), brewerName: first.brewer_name ?? "" }
      : blank;
  });
  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const brew = tabs[tab];
  const setBrew = (key: keyof BrewState) => (e: { target: { value: string } }) => setTabs({ ...tabs, [tab]: { ...brew, [key]: e.target.value } });
  const filled = FILTER_TEMPS.filter((x) => isFilled(tabs[x]));
  const summary = Object.fromEntries(
    filled.map((x) => {
      const b = tabs[x];
      return [x, [b.dose && b.water ? `${b.dose} g : ${b.water} g` : b.dose ? `${b.dose} g` : "", b.time ? `${b.time} s` : ""].filter(Boolean).join(" · ") || "…"];
    }),
  );
  // Only this tab's test brews; brews saved before tabs have no temperature and are not shown here.
  const tabBrews = brews.filter((b) => b.temperature === tab);
  // Dots: green once Final, yellow with test brews.
  const status: Partial<Record<string, TabStatus>> = {};
  for (const x of FILTER_TEMPS) {
    if (final.saved.has(x)) status[x] = "FINAL";
    else if (brews.some((y) => y.temperature === x)) status[x] = "SHOTS";
  }
  const tabIsFinal = final.saved.has(tab);

  const grinder = grinders.find((g) => g.id === form.grinderId);
  // Earlier Finals to reuse: custom my last ones, daily yesterday's of this grinder.
  const reusable = custom ? previous : previous.filter((r) => r.grinder_id === form.grinderId);
  const prev = reusable[0];
  const dose = Number(brew.dose);
  const water = Number(brew.water);
  const time = Number(brew.time);
  const ratio = waterRatio(dose, water);
  const ey = filterExtractionYield(dose, Number(brew.beverage) || null, Number(brew.tds) || null);
  const age = daysOffRoast(form.roastDate || null, date);
  const grindNumber = Number(form.grind);
  const grindOutOfRange =
    !!form.grind.trim() &&
    grinder?.scale_min != null &&
    grinder?.scale_max != null &&
    Number.isFinite(grindNumber) &&
    (grindNumber < grinder.scale_min || grindNumber > grinder.scale_max);
  // Speed only for a Settings grinder with adjustable RPM.
  const rpmGrinder = grinder?.rpm_adjustable ? grinder : undefined;
  const rpmOutOfRange = rpmProblem(rpmGrinder, form.rpm);

  /** Use earlier Finals: equipment of the newest, and each temperature's values into its tab. */
  function useEarlier() {
    if (!prev) return;
    setForm(fromValues(prev, form));
    const next = { ...tabs };
    for (const x of FILTER_TEMPS) {
      const r = reusable.find((f) => f.uses.some((u) => u.item === x));
      if (r) next[x] = brewFromValues(r);
    }
    setTabs(next);
  }

  /** One tab's values with the shared settings, or null after showing why they are not valid. */
  function values(x: FilterTemp): (FilterValues & { roast_date: string | null }) | null {
    const s = tabs[x];
    const dose = Number(s.dose);
    const water = Number(s.water);
    const time = Number(s.time);
    const optional = {
      water_temp_c: optionalNumber(s.temp),
      bloom_water_g: optionalNumber(s.bloomWater),
      bloom_seconds: optionalNumber(s.bloomSeconds),
      pour_count: optionalNumber(s.pours),
      beverage_g: optionalNumber(s.beverage),
      tds_percent: optionalNumber(s.tds),
    };
    const b = equipmentColumns(form.brewerId, form.brewerName);
    const g = equipmentColumns(form.grinderId, form.grinderName);
    if (!(dose > 0 && water > 0 && time > 0) || !form.grind.trim() || (!b.id && !b.name) || (!g.id && !g.name)) {
      setTab(x);
      setError(tf("invalid"));
      return null;
    }
    const { water_temp_c: temp, pour_count: pours, tds_percent: tds, beverage_g: beverage } = optional;
    if (
      Object.values(optional).some((v) => v === undefined || (v !== null && v < 0)) ||
      (temp != null && (temp < 70 || temp > 100)) ||
      (pours != null && (pours < 1 || pours > 20 || !Number.isInteger(pours))) ||
      (tds != null && (tds <= 0 || tds > 25)) ||
      (beverage != null && beverage <= 0)
    ) {
      setTab(x);
      setError(tf("invalidOptional"));
      return null;
    }
    if (form.roastDate && form.roastDate > date) {
      setError(t("roastFuture"));
      return null;
    }
    if (rpmOutOfRange && rpmGrinder) {
      setError(t("rpmOutOfRange", { min: rpmGrinder.rpm_min ?? 0, max: rpmGrinder.rpm_max ?? 0 }));
      return null;
    }
    return {
      coffee_bean_material_id: beanId,
      brewer_id: b.id,
      brewer_name: b.name,
      grinder_id: g.id,
      grinder_name: g.name,
      grind_setting: form.grind.trim(),
      grinder_rpm: rpmGrinder && form.rpm.trim() ? Number(form.rpm) : null,
      dose_g: dose,
      water_g: water,
      water_temp_c: temp ?? null,
      bloom_water_g: optional.bloom_water_g ?? null,
      bloom_seconds: optional.bloom_seconds ?? null,
      pour_count: pours ?? null,
      total_time_seconds: time,
      beverage_g: beverage ?? null,
      tds_percent: tds ?? null,
      taste_balance: s.balance || null,
      taste_notes: s.notes.trim() || null,
      roast_date: form.roastDate || null,
    };
  }

  /** Set the open tab as its Final (only this tab). */
  async function saveFinal(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy || final.pending) return;
    if (!isFilled(brew)) {
      setError(t("needShotValues"));
      return;
    }
    const v = values(tab);
    if (!v) return;
    if (productionNoProblem(productionNo)) {
      setError(t("productionNoInvalid"));
      return;
    }
    await final.submitTab(tab, { ...v, production_no: productionNo.trim() || null });
  }

  async function saveBrew() {
    if (busy) return;
    const v = values(tab);
    if (!v) return;
    setBusy(true);
    setError(null);
    const { roast_date: _roast, ...row } = v;
    void _roast;
    const { error: insertError } = await createClient()
      .from("filter_calibration_brews")
      .insert({ ...row, temperature: tab, purpose, outlet_id: outletId, business_date: date });
    setBusy(false);
    if (insertError) {
      setError(t("saveFailed"));
      return;
    }
    toast("saved");
    router.refresh();
  }

  const hint = (value: number | null, min: number, max: number, label: string) => {
    const check = value != null ? checkRange(value, min, max) : null;
    return (
      <span className={check && check !== "OK" ? "font-semibold text-[#c4161c]" : ""}>
        {label} {check ? rangeMark[check] : ""}
      </span>
    );
  };

  const numberField = (key: keyof BrewState, label: string, opts: { required?: boolean; step?: string; hint?: React.ReactNode } = {}) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`fc-${key}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`fc-${key}`}
        type="number"
        inputMode="decimal"
        min="0"
        step={opts.step ?? "any"}
        required={opts.required}
        value={brew[key]}
        onChange={setBrew(key)}
        className={inputClass}
      />
      {opts.hint && <span className={mutedText}>{opts.hint}</span>}
    </div>
  );

  return (
    <form onSubmit={saveFinal} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">{t("bagTitle")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="fc-roast" className={labelClass}>
              {t("roastDate")}
            </label>
            <input id="fc-roast" type="date" max={date} value={form.roastDate} onChange={set("roastDate")} className={inputClass} />
            {age != null && age >= 0 && <span className={mutedText}>{t("daysOffRoast", { days: age })}</span>}
          </div>
          <ProductionNoField id="fc-production" value={productionNo} onChange={setProductionNo} />
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <EquipmentSelect
          id="fc-brewer"
          label={tf("brewer")}
          options={brewers}
          value={form.brewerId}
          typed={form.brewerName}
          allowOther={custom}
          onChange={(value, typed) => setForm({ ...form, brewerId: value, brewerName: typed })}
        />
        <EquipmentSelect
          id="fc-grinder"
          label={t("grinder")}
          options={grinders}
          value={form.grinderId}
          typed={form.grinderName}
          allowOther={custom}
          disabled={!!edit}
          onChange={(value, typed) => setForm({ ...form, grinderId: value, grinderName: typed })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="fc-grind" className={labelClass}>
              {t("grind")}
            </label>
            <input id="fc-grind" required maxLength={50} inputMode="decimal" value={form.grind} onChange={set("grind")} className={inputClass} />
            {grinder?.scale_min != null && grinder?.scale_max != null && (
              <span className={grindOutOfRange ? "text-[13px] font-semibold text-[#c4161c]" : mutedText}>
                {grindOutOfRange
                  ? t("grindOutOfRange", { min: grinder.scale_min, max: grinder.scale_max })
                  : t("grindRange", { min: grinder.scale_min, max: grinder.scale_max })}
              </span>
            )}
          </div>
          {rpmGrinder && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="fc-rpm" className={labelClass}>
                {t("rpm")}
              </label>
              <input
                id="fc-rpm"
                type="number"
                inputMode="numeric"
                step="1"
                min={rpmGrinder.rpm_min ?? undefined}
                max={rpmGrinder.rpm_max ?? undefined}
                value={form.rpm}
                onChange={set("rpm")}
                className={inputClass}
              />
              <span className={rpmOutOfRange ? "text-[13px] font-semibold text-[#c4161c]" : mutedText}>
                {rpmOutOfRange
                  ? t("rpmOutOfRange", { min: rpmGrinder.rpm_min ?? 0, max: rpmGrinder.rpm_max ?? 0 })
                  : t("rpmRange", { min: rpmGrinder.rpm_min ?? 0, max: rpmGrinder.rpm_max ?? 0 })}
              </span>
            </div>
          )}
      </div>

      {prev && !edit && (
        <button type="button" className={`${secondaryButton} self-start`} onClick={useEarlier}>
          {custom ? t("useLast") : t("useYesterday")}
        </button>
      )}

      <ItemTabs kind="FILTER" items={FILTER_TEMPS} value={tab} summary={summary} status={status} onChange={(x) => setTab(x as FilterTemp)}>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold">{tf("recipe")}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {numberField("dose", t("doseG"), {
              required: true,
              hint: target ? hint(dose || null, target.dose_min_g, target.dose_max_g, t("targetRange", { min: target.dose_min_g, max: target.dose_max_g, unit: "g" })) : undefined,
            })}
            {numberField("water", tf("waterG"), {
              required: true,
              hint: target
                ? hint(ratio, target.ratio_min, target.ratio_max, tf("targetRatio", { min: target.ratio_min, max: target.ratio_max }))
                : undefined,
            })}
            {numberField("temp", tf("waterTempC"))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span>
              <span className={mutedText}>{t("ratio")}: </span>
              <span className="font-semibold">{ratio ? `1:${ratio}` : "—"}</span>
            </span>
            {canManage && (
              <button type="button" className="text-[13px] underline" onClick={() => setEditTarget(!editTarget)}>
                {target ? t("editTarget") : t("setTarget")}
              </button>
            )}
          </div>
          {editTarget && <BeanTargetForm beanId={beanId} target={target} filter onClose={() => setEditTarget(false)} />}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold">{tf("pouring")}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {numberField("bloomWater", tf("bloomWaterG"))}
            {numberField("bloomSeconds", tf("bloomS"))}
            {numberField("pours", tf("pours"), { step: "1" })}
            {numberField("time", tf("totalTimeS"), {
              required: true,
              hint: target
                ? hint(time || null, target.time_min_seconds, target.time_max_seconds, t("targetRange", { min: target.time_min_seconds, max: target.time_max_seconds, unit: "s" }))
                : undefined,
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold">{t("beanAndTaste")}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {numberField("beverage", tf("beverageG"))}
            {numberField("tds", t("tdsPercent"), { hint: ey != null ? t("eyValue", { value: ey }) : tf("eyHint") })}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={labelClass}>{t("tasteBalance")}</span>
            <div role="radiogroup" aria-label={t("tasteBalance")} className="flex flex-wrap gap-2">
              {(["SOUR", "BALANCED", "BITTER"] as TasteBalance[]).map((b) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={brew.balance === b}
                  onClick={() => setTabs({ ...tabs, [tab]: { ...brew, balance: brew.balance === b ? "" : b } })}
                  className={`inline-flex h-9 items-center rounded-full border-[1.5px] px-4 text-sm font-semibold ${
                    brew.balance === b ? "border-black bg-black text-white" : "border-black/40 bg-white"
                  }`}
                >
                  {t(`balance.${b}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fc-notes" className={labelClass}>
              {t("tasteNotes")}
            </label>
            <textarea
              id="fc-notes"
              rows={2}
              maxLength={1000}
              value={brew.notes}
              onChange={setBrew("notes")}
              className="rounded-[10px] border-[1.5px] border-black px-3.5 py-2.5 text-base"
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-3">
          <button type="button" disabled={busy} onClick={saveBrew} className={`${secondaryButton} self-start`}>
            {tf("saveBrew")}
          </button>
          <p className={mutedText}>{tf("brewHint")}</p>
          {tabBrews.length > 0 && (
            <FilterBrewList
              brews={tabBrews}
              brewerNames={brewerNames}
              onUse={(b) => {
                setForm(fromValues(b, { ...form, brewerId: b.brewer_id ?? OTHER, brewerName: b.brewer_name ?? "" }));
                setTabs({ ...tabs, [tab]: brewFromValues(b) });
              }}
            />
          )}
          <ApplyTo kind="FILTER" items={FILTER_TEMPS} current={tab} onApply={(x) => setTabs({ ...tabs, [x]: { ...brew } })} />
          <div className="flex flex-col gap-2 border-t border-black/10 pt-3">
            <FormError error={error} />
            {final.warning}
            {!final.pending && (
              <button type="submit" disabled={busy} className={`${primaryButton} self-start`}>
                {busy ? t("saving") : t(tabIsFinal ? "updateFinalTab" : "setFinalTab", { drink: t(`temp.${tab}`) })}
              </button>
            )}
            <DotLegend kind="FILTER" />
          </div>
        </div>
      </ItemTabs>

      <button type="button" onClick={onDone} className={`${secondaryButton} self-start`}>
        {t("done")}
      </button>
    </form>
  );
}
