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
import { AppliesTo, FormError, ProductionNoField, productionNoProblem, useFinalSave } from "../FinalParts";
import { rpmProblem, type Grinder, type Purpose, type TasteBalance } from "../types";
import { FilterBrewList } from "./FilterBrewList";
import { FILTER_TEMPS, type Brewer, type FilterBrew, type FilterRecord, type FilterTarget, type FilterValues } from "./types";

type FormState = {
  brewerId: string;
  brewerName: string;
  grinderId: string;
  grinderName: string;
  grind: string;
  rpm: string;
  dose: string;
  water: string;
  temp: string;
  bloomWater: string;
  bloomSeconds: string;
  pours: string;
  time: string;
  beverage: string;
  tds: string;
  roastDate: string;
  balance: string;
  notes: string;
};

const str = (value: number | string | null | undefined) => (value == null ? "" : String(value));

function fromValues(v: Partial<FilterValues> & { roast_date?: string | null }, base: FormState): FormState {
  return {
    ...base,
    grinderId: v.grinder_id ?? (v.grinder_name ? OTHER : base.grinderId),
    grinderName: v.grinder_name ?? base.grinderName,
    grind: v.grind_setting ?? "",
    rpm: str(v.grinder_rpm),
    dose: str(v.dose_g),
    water: str(v.water_g),
    temp: str(v.water_temp_c),
    bloomWater: str(v.bloom_water_g),
    bloomSeconds: str(v.bloom_seconds),
    pours: str(v.pour_count),
    time: str(v.total_time_seconds),
    beverage: str(v.beverage_g),
    tds: str(v.tds_percent),
    roastDate: v.roast_date !== undefined ? str(v.roast_date) : base.roastDate,
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

/** Filter: dial in with test brews, then save a Final ticked Hot and / or Iced. */
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
  onDone: () => void;
}) {
  const t = useTranslations("Calibration");
  const tf = useTranslations("FilterCalibration");
  const router = useRouter();
  const custom = purpose === "CUSTOM";
  const final = useFinalSave({ kind: "FILTER", purpose, outletId, date, onSaved: onDone });
  const { busy, setBusy, error, setError } = final;
  const [editTarget, setEditTarget] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const [productionNo, setProductionNo] = useState("");
  const [form, setForm] = useState<FormState>(() => ({
    brewerId: brewers.find((b) => b.is_active)?.id ?? (custom ? OTHER : ""),
    brewerName: "",
    grinderId: grinders.find((g) => g.is_active)?.id ?? (custom ? OTHER : ""),
    grinderName: "",
    grind: "",
    rpm: "",
    dose: "",
    water: "",
    temp: "",
    bloomWater: "",
    bloomSeconds: "",
    pours: "",
    time: "",
    beverage: "",
    tds: "",
    roastDate: "",
    balance: "",
    notes: "",
  }));
  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const grinder = grinders.find((g) => g.id === form.grinderId);
  const prev = custom ? previous[0] : previous.find((r) => r.grinder_id === form.grinderId);
  const dose = Number(form.dose);
  const water = Number(form.water);
  const time = Number(form.time);
  const ratio = waterRatio(dose, water);
  const ey = filterExtractionYield(dose, Number(form.beverage) || null, Number(form.tds) || null);
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

  function values(): (FilterValues & { roast_date: string | null }) | null {
    const optional = {
      water_temp_c: optionalNumber(form.temp),
      bloom_water_g: optionalNumber(form.bloomWater),
      bloom_seconds: optionalNumber(form.bloomSeconds),
      pour_count: optionalNumber(form.pours),
      beverage_g: optionalNumber(form.beverage),
      tds_percent: optionalNumber(form.tds),
    };
    const b = equipmentColumns(form.brewerId, form.brewerName);
    const g = equipmentColumns(form.grinderId, form.grinderName);
    if (!(dose > 0 && water > 0 && time > 0) || !form.grind.trim() || (!b.id && !b.name) || (!g.id && !g.name)) {
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
      taste_balance: form.balance || null,
      taste_notes: form.notes.trim() || null,
      roast_date: form.roastDate || null,
    };
  }

  async function saveFinal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const v = values();
    if (!v) return;
    if (productionNoProblem(productionNo)) {
      setError(t("productionNoInvalid"));
      return;
    }
    if (items.length === 0) {
      setError(t("needAppliesTo"));
      return;
    }
    await final.submit({ ...v, production_no: productionNo.trim() || null }, items);
  }

  async function saveBrew() {
    if (busy) return;
    const v = values();
    if (!v) return;
    setBusy(true);
    setError(null);
    const { roast_date: _roast, ...brew } = v;
    void _roast;
    const { error: insertError } = await createClient()
      .from("filter_calibration_brews")
      .insert({ ...brew, purpose, outlet_id: outletId, business_date: date });
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

  const numberField = (key: keyof FormState, label: string, opts: { required?: boolean; step?: string; hint?: React.ReactNode } = {}) => (
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
        value={form[key]}
        onChange={set(key)}
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
          onChange={(value, typed) => setForm({ ...form, grinderId: value, grinderName: typed })}
        />
      </div>

      {prev && (
        <button type="button" className={`${secondaryButton} self-start`} onClick={() => setForm(fromValues(prev, form))}>
          {custom ? t("useLast") : t("useYesterday")}
        </button>
      )}

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
                aria-checked={form.balance === b}
                onClick={() => setForm({ ...form, balance: form.balance === b ? "" : b })}
                className={`inline-flex h-9 items-center rounded-full border-[1.5px] px-4 text-sm font-semibold ${
                  form.balance === b ? "border-black bg-black text-white" : "border-black/40 bg-white"
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
            value={form.notes}
            onChange={set("notes")}
            className="rounded-[10px] border-[1.5px] border-black px-3.5 py-2.5 text-base"
          />
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        <button type="button" disabled={busy} onClick={saveBrew} className={`${secondaryButton} self-start`}>
          {tf("saveBrew")}
        </button>
        <p className={mutedText}>{tf("brewHint")}</p>
        {brews.length > 0 && (
          <FilterBrewList
            brews={brews}
            brewerNames={brewerNames}
            onUse={(brew) => setForm(fromValues(brew, { ...form, brewerId: brew.brewer_id ?? OTHER, brewerName: brew.brewer_name ?? "" }))}
          />
        )}
      </div>

      <AppliesTo kind="FILTER" items={FILTER_TEMPS} value={items} onChange={setItems} />

      <FormError error={error} />
      {final.warning}
      {!final.pending && (
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? t("saving") : t("saveFinal")}
          </button>
          <button type="button" onClick={onDone} className={secondaryButton}>
            {t("cancel")}
          </button>
        </div>
      )}
    </form>
  );
}
