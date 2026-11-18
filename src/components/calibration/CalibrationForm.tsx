"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { errorText, inputClass, labelClass, mutedText, primaryButton, secondaryButton } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { brewRatio, checkRange, daysOffRoast, extractionYield, type RangeCheck } from "@/lib/calibration/calc";
import { createClient } from "@/lib/supabase/client";
import { ShotList } from "./ShotList";
import type { BeanTarget, CalibrationRecord, CalibrationShot, Grinder, Machine, ShotValues, TasteBalance } from "./types";

type FormState = {
  grinderId: string;
  machineId: string;
  dose: string;
  yield: string;
  time: string;
  grind: string;
  temp: string;
  pressure: string;
  preinfusion: string;
  basket: string;
  tds: string;
  roastDate: string;
  balance: string;
  notes: string;
};

const str = (value: number | string | null | undefined) => (value == null ? "" : String(value));

function fromValues(values: Partial<ShotValues> & { roast_date?: string | null }, base: FormState): FormState {
  return {
    ...base,
    machineId: values.espresso_machine_id ?? base.machineId,
    dose: str(values.dose_g),
    yield: str(values.yield_g),
    time: str(values.extraction_time_seconds),
    grind: values.grind_setting ?? "",
    temp: str(values.water_temp_c),
    pressure: str(values.pressure_bar),
    preinfusion: str(values.preinfusion_seconds),
    basket: str(values.basket_g),
    tds: str(values.tds_percent),
    roastDate: values.roast_date !== undefined ? str(values.roast_date) : base.roastDate,
    balance: values.taste_balance ?? "",
    notes: values.taste_notes ?? "",
  };
}

/** Blank is null; returns undefined when the text is not a number. */
function optionalNumber(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const rangeMark: Record<RangeCheck, string> = { LOW: "↓", OK: "✓", HIGH: "↑" };

export function CalibrationForm({
  outletId,
  date,
  beanId,
  record,
  grinders,
  machines,
  target,
  yesterday,
  shots,
  grinderNames,
  onClose,
}: {
  outletId: string;
  date: string;
  beanId: string;
  /** The record being edited, or null for a new one. */
  record: CalibrationRecord | null;
  /** New record: grinders still free for this bean today. Edit: the record's grinder. */
  grinders: Grinder[];
  machines: Machine[];
  target: BeanTarget | undefined;
  /** Yesterday's final records of this bean, by grinder id. */
  yesterday: Map<string, CalibrationRecord>;
  /** Test shots this form may reuse. */
  shots: CalibrationShot[];
  grinderNames: Map<string, string>;
  onClose: () => void;
}) {
  const t = useTranslations("Calibration");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstMachine = machines.find((m) => m.is_active);
  const [form, setForm] = useState<FormState>(() => {
    const base: FormState = {
      grinderId: record?.grinder_id ?? grinders[0]?.id ?? "",
      machineId: record ? (record.espresso_machine_id ?? "") : (firstMachine?.id ?? ""),
      dose: "",
      yield: "",
      time: "",
      grind: "",
      temp: str(firstMachine?.default_water_temp_c),
      pressure: str(firstMachine?.default_pressure_bar),
      preinfusion: "",
      basket: "",
      tds: "",
      roastDate: "",
      balance: "",
      notes: "",
    };
    return record ? fromValues(record, base) : base;
  });
  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const grinder = grinders.find((g) => g.id === form.grinderId);
  const prev = yesterday.get(form.grinderId);
  const dose = Number(form.dose);
  const yieldG = Number(form.yield);
  const time = Number(form.time);
  const ratio = brewRatio(dose, yieldG);
  const ey = extractionYield(dose, yieldG, Number(form.tds) || null);
  const age = daysOffRoast(form.roastDate || null, date);
  const grindNumber = Number(form.grind);
  const grindOutOfRange =
    !!form.grind.trim() &&
    grinder?.scale_min != null &&
    grinder?.scale_max != null &&
    Number.isFinite(grindNumber) &&
    (grindNumber < grinder.scale_min || grindNumber > grinder.scale_max);

  function pickMachine(id: string) {
    const machine = machines.find((m) => m.id === id);
    // Fill the machine's usual temperature and pressure when those are still blank.
    setForm({
      ...form,
      machineId: id,
      temp: form.temp || str(machine?.default_water_temp_c),
      pressure: form.pressure || str(machine?.default_pressure_bar),
    });
  }

  function values(): (ShotValues & { roast_date: string | null }) | null {
    const optional = {
      water_temp_c: optionalNumber(form.temp),
      pressure_bar: optionalNumber(form.pressure),
      preinfusion_seconds: optionalNumber(form.preinfusion),
      basket_g: optionalNumber(form.basket),
      tds_percent: optionalNumber(form.tds),
    };
    if (!(dose > 0 && yieldG > 0 && time > 0) || !form.grind.trim() || !form.grinderId) {
      setError(t("invalid"));
      return null;
    }
    const t1 = optional.water_temp_c;
    const p = optional.pressure_bar;
    const tds = optional.tds_percent;
    if (
      Object.values(optional).some((v) => v === undefined || (v !== null && v < 0)) ||
      (t1 != null && (t1 < 80 || t1 > 100)) ||
      (p != null && (p <= 0 || p > 20)) ||
      (tds != null && (tds <= 0 || tds > 25)) ||
      (optional.basket_g != null && optional.basket_g <= 0)
    ) {
      setError(t("invalidOptional"));
      return null;
    }
    if (form.roastDate && form.roastDate > date) {
      setError(t("roastFuture"));
      return null;
    }
    return {
      coffee_bean_material_id: beanId,
      grinder_id: form.grinderId,
      espresso_machine_id: form.machineId || null,
      dose_g: dose,
      yield_g: yieldG,
      extraction_time_seconds: time,
      grind_setting: form.grind.trim(),
      water_temp_c: optional.water_temp_c ?? null,
      pressure_bar: optional.pressure_bar ?? null,
      preinfusion_seconds: optional.preinfusion_seconds ?? null,
      basket_g: optional.basket_g ?? null,
      tds_percent: optional.tds_percent ?? null,
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
    setBusy(true);
    setError(null);
    const supabase = createClient();
    if (record) {
      // Revision check: if someone saved first, nothing is updated (ch. 13.2).
      const { coffee_bean_material_id: _bean, grinder_id: _grinder, ...changes } = v;
      void _bean;
      void _grinder;
      const { data, error: updateError } = await supabase
        .from("calibrations")
        .update(changes)
        .eq("id", record.id)
        .eq("revision", record.revision)
        .select("id");
      if (updateError || !data?.length) {
        setError(updateError ? t("saveFailed") : t("conflict"));
        setBusy(false);
        router.refresh();
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("calibrations")
        .insert({ ...v, outlet_id: outletId, business_date: date });
      if (insertError) {
        // 23505: someone else recorded this bean on this grinder for the day first.
        setError(insertError.code === "23505" ? t("alreadyRecorded") : t("saveFailed"));
        setBusy(false);
        router.refresh();
        return;
      }
    }
    setBusy(false);
    toast("saved");
    onClose();
    router.refresh();
  }

  async function saveShot() {
    if (busy) return;
    const v = values();
    if (!v) return;
    setBusy(true);
    setError(null);
    const { roast_date: _roast, ...shot } = v;
    void _roast;
    const { error: insertError } = await createClient()
      .from("calibration_shots")
      .insert({ ...shot, outlet_id: outletId, business_date: date });
    setBusy(false);
    if (insertError) {
      setError(t("saveFailed"));
      return;
    }
    toast("saved");
    router.refresh();
  }

  const targetLine = (value: number, min: number, max: number, unit: string) => {
    const check = checkRange(value, min, max);
    return (
      <span className={check && check !== "OK" ? "font-semibold text-[#c4161c]" : ""}>
        {t("targetRange", { min, max, unit })} {check ? rangeMark[check] : ""}
      </span>
    );
  };

  const numberField = (key: keyof FormState, label: string, opts: { min?: string; max?: string; required?: boolean; hint?: React.ReactNode } = {}) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`cal-${key}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`cal-${key}`}
        type="number"
        inputMode="decimal"
        min={opts.min ?? "0"}
        max={opts.max}
        step="any"
        required={opts.required}
        value={form[key]}
        onChange={set(key)}
        className={inputClass}
      />
      {opts.hint && <span className={mutedText}>{opts.hint}</span>}
    </div>
  );

  return (
    <form onSubmit={saveFinal} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="cal-grinder" className={labelClass}>
            {t("grinder")}
          </label>
          <select
            id="cal-grinder"
            value={form.grinderId}
            disabled={!!record}
            onChange={set("grinderId")}
            className={inputClass}
          >
            {grinders.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="cal-machine" className={labelClass}>
            {t("machine")}
          </label>
          <select
            id="cal-machine"
            value={form.machineId}
            onChange={(e) => pickMachine(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!record && prev && (
        <button
          type="button"
          className={`${secondaryButton} self-start`}
          onClick={() => setForm(fromValues({ ...prev, roast_date: prev.roast_date }, form))}
        >
          {t("useYesterday")}
        </button>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">{t("shot")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {numberField("dose", t("doseG"), {
            min: "0.1",
            required: true,
            hint: target ? targetLine(dose, target.dose_min_g, target.dose_max_g, "g") : undefined,
          })}
          {numberField("yield", t("yieldG"), {
            min: "0.1",
            required: true,
            hint: target ? targetLine(yieldG, target.yield_min_g, target.yield_max_g, "g") : undefined,
          })}
          {numberField("time", t("timeS"), {
            min: "0.1",
            required: true,
            hint: target ? targetLine(time, target.time_min_seconds, target.time_max_seconds, "s") : undefined,
          })}
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="cal-grind" className={labelClass}>
              {t("grind")}
            </label>
            <input
              id="cal-grind"
              required
              maxLength={50}
              inputMode="decimal"
              value={form.grind}
              onChange={set("grind")}
              className={inputClass}
            />
            {grinder?.scale_min != null && grinder?.scale_max != null && (
              <span className={grindOutOfRange ? "text-[13px] font-semibold text-[#c4161c]" : mutedText}>
                {grindOutOfRange
                  ? t("grindOutOfRange", { min: grinder.scale_min, max: grinder.scale_max })
                  : t("grindRange", { min: grinder.scale_min, max: grinder.scale_max })}
              </span>
            )}
          </div>
        </div>
        <p className="text-sm">
          <span className={mutedText}>{t("ratio")}: </span>
          <span className="font-semibold">{ratio ?? "—"}</span>
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">{t("machineSettings")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {numberField("temp", t("waterTempC"), { min: "80", max: "100" })}
          {numberField("pressure", t("pressureBar"), { min: "0.1", max: "20" })}
          {numberField("preinfusion", t("preinfusionS"))}
          {numberField("basket", t("basketG"))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">{t("beanAndTaste")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {numberField("tds", t("tdsPercent"), {
            max: "25",
            hint: ey != null ? t("eyValue", { value: ey }) : t("eyHint"),
          })}
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="cal-roast" className={labelClass}>
              {t("roastDate")}
            </label>
            <input id="cal-roast" type="date" max={date} value={form.roastDate} onChange={set("roastDate")} className={inputClass} />
            {age != null && age >= 0 && <span className={mutedText}>{t("daysOffRoast", { days: age })}</span>}
          </div>
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
          <label htmlFor="cal-notes" className={labelClass}>
            {t("tasteNotes")}
          </label>
          <textarea
            id="cal-notes"
            rows={2}
            value={form.notes}
            onChange={set("notes")}
            className="rounded-[10px] border-[1.5px] border-black px-3.5 py-2.5 text-base"
          />
        </div>
      </fieldset>

      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? t("saving") : t("saveFinal")}
        </button>
        <button type="button" disabled={busy} onClick={saveShot} className={secondaryButton}>
          {t("saveShot")}
        </button>
        <button type="button" onClick={onClose} className={secondaryButton}>
          {t("cancel")}
        </button>
      </div>
      <p className={mutedText}>{t("shotHint")}</p>

      {shots.length > 0 && (
        <ShotList
          shots={shots}
          grinderNames={grinderNames}
          onUse={(shot) => setForm(fromValues(shot, { ...form, grinderId: record ? form.grinderId : shot.grinder_id }))}
        />
      )}
    </form>
  );
}
