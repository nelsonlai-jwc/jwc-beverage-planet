"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { errorText, inputClass, labelClass, mutedText, primaryButton, secondaryButton } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { brewRatio, checkRange, daysOffRoast, extractionYield, type RangeCheck } from "@/lib/calibration/calc";
import { createClient } from "@/lib/supabase/client";
import { EquipmentSelect, OTHER, equipmentColumns } from "./EquipmentSelect";
import { ShotList } from "./ShotList";
import {
  DRINK_TYPES,
  type BeanTarget,
  type CalibrationRecord,
  type CalibrationShot,
  type DrinkType,
  type DrinkValues,
  type Grinder,
  type Machine,
  type Purpose,
  type SharedValues,
  type TasteBalance,
  rpmProblem,
} from "./types";

type SharedState = {
  grinderId: string;
  grinderName: string;
  machineId: string;
  machineName: string;
  grind: string;
  rpm: string;
  temp: string;
  pressure: string;
  preinfusion: string;
  basket: string;
  roastDate: string;
};

type DrinkState = { dose: string; yield: string; time: string; tds: string; balance: string; notes: string };
type Drinks = Partial<Record<DrinkType, DrinkState>>;

const str = (value: number | string | null | undefined) => (value == null ? "" : String(value));
const emptyDrink: DrinkState = { dose: "", yield: "", time: "", tds: "", balance: "", notes: "" };

function sharedFrom(v: Partial<SharedValues> & { roast_date?: string | null }, base: SharedState): SharedState {
  return {
    ...base,
    grinderId: v.grinder_id ?? (v.grinder_name ? OTHER : base.grinderId),
    grinderName: v.grinder_name ?? base.grinderName,
    machineId: v.espresso_machine_id ?? (v.machine_name ? OTHER : base.machineId),
    machineName: v.machine_name ?? base.machineName,
    grind: v.grind_setting ?? "",
    rpm: str(v.grinder_rpm),
    temp: str(v.water_temp_c),
    pressure: str(v.pressure_bar),
    preinfusion: str(v.preinfusion_seconds),
    basket: str(v.basket_g),
    roastDate: v.roast_date !== undefined ? str(v.roast_date) : base.roastDate,
  };
}

function drinkFrom(v: DrinkValues): DrinkState {
  return {
    dose: str(v.dose_g),
    yield: str(v.yield_g),
    time: str(v.extraction_time_seconds),
    tds: str(v.tds_percent),
    balance: v.taste_balance ?? "",
    notes: v.taste_notes ?? "",
  };
}

const drinksFrom = (list: DrinkValues[]): Drinks =>
  Object.fromEntries(list.map((d) => [d.drink_type, drinkFrom(d)])) as Drinks;

/** Blank is null; returns undefined when the text is not a number. */
function optionalNumber(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const rangeMark: Record<RangeCheck, string> = { LOW: "↓", OK: "✓", HIGH: "↑" };

export function CalibrationForm({
  purpose,
  outletId,
  date,
  beanId,
  record,
  grinders,
  machines,
  targets,
  previous,
  shots,
  grinderNames,
  onClose,
}: {
  purpose: Purpose;
  /** Daily records only. */
  outletId: string | null;
  date: string;
  beanId: string;
  /** The record being edited, or null for a new one. */
  record: CalibrationRecord | null;
  /** Daily new record: grinders still free for this bean today. Daily edit: the record's grinder. */
  grinders: Grinder[];
  machines: Machine[];
  /** This bean's targets, one per drink type. */
  targets: BeanTarget[];
  /** Earlier values to reuse: daily by grinder id (yesterday), custom under "*" (the last record). */
  previous: Map<string, CalibrationRecord>;
  /** Test shots this form may reuse. */
  shots: CalibrationShot[];
  grinderNames: Map<string, string>;
  onClose: () => void;
}) {
  const t = useTranslations("Calibration");
  const router = useRouter();
  const custom = purpose === "CUSTOM";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstMachine = custom ? undefined : machines.find((m) => m.is_active);
  const [form, setForm] = useState<SharedState>(() => {
    const base: SharedState = {
      grinderId: grinders[0]?.id ?? (custom ? OTHER : ""),
      grinderName: "",
      machineId: firstMachine?.id ?? "",
      machineName: "",
      grind: "",
      rpm: "",
      temp: str(firstMachine?.default_water_temp_c),
      pressure: str(firstMachine?.default_pressure_bar),
      preinfusion: "",
      basket: "",
      roastDate: "",
    };
    return record ? sharedFrom(record, base) : base;
  });
  const [drinks, setDrinks] = useState<Drinks>(() => (record ? drinksFrom(record.drinks) : {}));
  const set = (key: keyof SharedState) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const setDrink = (type: DrinkType, key: keyof DrinkState, value: string) =>
    setDrinks({ ...drinks, [type]: { ...(drinks[type] ?? emptyDrink), [key]: value } });
  const toggleDrink = (type: DrinkType) => {
    const next = { ...drinks };
    if (next[type]) delete next[type];
    else next[type] = { ...emptyDrink };
    setDrinks(next);
  };

  const lockGrinder = !!record && !custom;
  const grinder = grinders.find((g) => g.id === form.grinderId);
  const prev = previous.get(custom ? "*" : form.grinderId);
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

  function pickMachine(id: string, typed: string) {
    const machine = machines.find((m) => m.id === id);
    // Fill the machine's usual temperature and pressure when those are still blank.
    setForm({
      ...form,
      machineId: id,
      machineName: typed,
      temp: form.temp || str(machine?.default_water_temp_c),
      pressure: form.pressure || str(machine?.default_pressure_bar),
    });
  }

  /** Shared values, or null after showing why they are not valid. */
  function shared(): (SharedValues & { roast_date: string | null }) | null {
    const g = equipmentColumns(form.grinderId, form.grinderName);
    const m = equipmentColumns(form.machineId, form.machineName);
    if (!form.grind.trim() || (!g.id && !g.name) || (form.machineId === OTHER && !m.name)) {
      setError(t("invalidShared"));
      return null;
    }
    const optional = {
      water_temp_c: optionalNumber(form.temp),
      pressure_bar: optionalNumber(form.pressure),
      preinfusion_seconds: optionalNumber(form.preinfusion),
      basket_g: optionalNumber(form.basket),
    };
    const { water_temp_c: temp, pressure_bar: p, basket_g: basket } = optional;
    if (
      Object.values(optional).some((v) => v === undefined || (v !== null && v < 0)) ||
      (temp != null && (temp < 80 || temp > 100)) ||
      (p != null && (p <= 0 || p > 20)) ||
      (basket != null && basket <= 0)
    ) {
      setError(t("invalidOptional"));
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
      grinder_id: g.id,
      grinder_name: g.name,
      espresso_machine_id: m.id,
      machine_name: m.name,
      grind_setting: form.grind.trim(),
      grinder_rpm: rpmGrinder && form.rpm.trim() ? Number(form.rpm) : null,
      water_temp_c: temp ?? null,
      pressure_bar: p ?? null,
      preinfusion_seconds: optional.preinfusion_seconds ?? null,
      basket_g: basket ?? null,
      roast_date: form.roastDate || null,
    };
  }

  /** One drink row's values, or null after showing why they are not valid. */
  function drinkValues(type: DrinkType): DrinkValues | null {
    const d = drinks[type] ?? emptyDrink;
    const dose = Number(d.dose);
    const yieldG = Number(d.yield);
    const time = Number(d.time);
    const tds = optionalNumber(d.tds);
    if (!(dose > 0 && yieldG > 0 && time > 0)) {
      setError(t("invalidDrink", { drink: t(`drink.${type}`) }));
      return null;
    }
    if (tds === undefined || (tds != null && (tds <= 0 || tds > 25))) {
      setError(t("invalidOptional"));
      return null;
    }
    return {
      drink_type: type,
      dose_g: dose,
      yield_g: yieldG,
      extraction_time_seconds: time,
      tds_percent: tds,
      taste_balance: d.balance || null,
      taste_notes: d.notes.trim() || null,
    };
  }

  async function saveFinal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const s = shared();
    if (!s) return;
    const types = DRINK_TYPES.filter((type) => drinks[type]);
    if (types.length === 0) {
      setError(t("needDrink"));
      return;
    }
    const rows: DrinkValues[] = [];
    for (const type of types) {
      const row = drinkValues(type);
      if (!row) return;
      rows.push(row);
    }
    setBusy(true);
    setError(null);
    const { error: saveError } = await createClient().rpc("save_espresso_calibration", {
      p_id: record?.id ?? null,
      p_revision: record?.revision ?? null,
      p_record: { ...s, purpose, outlet_id: outletId, business_date: date },
      p_drinks: rows,
    });
    setBusy(false);
    if (saveError) {
      // 40001: someone saved first (revision check, ch. 13.2). 23505: already recorded today.
      setError(
        saveError.code === "40001" ? t("conflict") : saveError.code === "23505" ? t("alreadyRecorded") : t("saveFailed"),
      );
      router.refresh();
      return;
    }
    toast("saved");
    onClose();
    router.refresh();
  }

  async function saveShot(type: DrinkType) {
    if (busy) return;
    const s = shared();
    const d = s && drinkValues(type);
    if (!s || !d) return;
    setBusy(true);
    setError(null);
    const { roast_date: _roast, ...values } = s;
    void _roast;
    const { error: insertError } = await createClient()
      .from("calibration_shots")
      .insert({ ...values, ...d, purpose, outlet_id: outletId, business_date: date });
    setBusy(false);
    if (insertError) {
      setError(t("saveFailed"));
      return;
    }
    toast("saved");
    router.refresh();
  }

  function useShot(shot: CalibrationShot) {
    const next = sharedFrom(shot, form);
    // A daily record keeps its grinder.
    setForm(lockGrinder ? { ...next, grinderId: form.grinderId, grinderName: form.grinderName } : next);
    setDrinks({ ...drinks, [shot.drink_type]: drinkFrom(shot) });
  }

  const targetLine = (value: number, min: number, max: number, unit: string) => {
    const check = checkRange(value, min, max);
    return (
      <span className={check && check !== "OK" ? "font-semibold text-[#c4161c]" : ""}>
        {t("targetRange", { min, max, unit })} {check ? rangeMark[check] : ""}
      </span>
    );
  };

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    opts: { min?: string; max?: string; required?: boolean; hint?: React.ReactNode } = {},
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={opts.min ?? "0"}
        max={opts.max}
        step="any"
        required={opts.required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      {opts.hint && <span className={mutedText}>{opts.hint}</span>}
    </div>
  );
  const sharedField = (key: keyof SharedState, label: string, opts?: { min?: string; max?: string }) =>
    field(`cal-${key}`, label, form[key], (v) => setForm({ ...form, [key]: v }), opts);

  return (
    <form onSubmit={saveFinal} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <EquipmentSelect
          id="cal-grinder"
          label={t("grinder")}
          options={grinders}
          value={form.grinderId}
          typed={form.grinderName}
          allowOther={custom}
          disabled={lockGrinder}
          onChange={(value, typed) => setForm({ ...form, grinderId: value, grinderName: typed })}
        />
        <EquipmentSelect
          id="cal-machine"
          label={t("machine")}
          options={machines}
          value={form.machineId}
          typed={form.machineName}
          allowOther={custom}
          allowNone
          onChange={pickMachine}
        />
      </div>

      {!record && prev && (
        <button
          type="button"
          className={`${secondaryButton} self-start`}
          onClick={() => {
            setForm(sharedFrom(prev, form));
            setDrinks(drinksFrom(prev.drinks));
          }}
        >
          {custom ? t("useLast") : t("useYesterday")}
        </button>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">{t("machineSettings")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="cal-grind" className={labelClass}>
              {t("grind")}
            </label>
            <input id="cal-grind" required maxLength={50} inputMode="decimal" value={form.grind} onChange={set("grind")} className={inputClass} />
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
              <label htmlFor="cal-rpm" className={labelClass}>
                {t("rpm")}
              </label>
              <input
                id="cal-rpm"
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
          {sharedField("temp", t("waterTempC"), { min: "80", max: "100" })}
          {sharedField("pressure", t("pressureBar"), { min: "0.1", max: "20" })}
          {sharedField("preinfusion", t("preinfusionS"))}
          {sharedField("basket", t("basketG"))}
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="cal-roast" className={labelClass}>
              {t("roastDate")}
            </label>
            <input id="cal-roast" type="date" max={date} value={form.roastDate} onChange={set("roastDate")} className={inputClass} />
            {age != null && age >= 0 && <span className={mutedText}>{t("daysOffRoast", { days: age })}</span>}
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">{t("drinksTitle")}</legend>
        <p className={mutedText}>{t("drinksHint")}</p>
        <div className="flex flex-wrap gap-2">
          {DRINK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="checkbox"
              aria-checked={!!drinks[type]}
              onClick={() => toggleDrink(type)}
              className={`inline-flex h-9 items-center rounded-full border-[1.5px] px-4 text-sm font-semibold ${
                drinks[type] ? "border-black bg-black text-white" : "border-black/40 bg-white"
              }`}
            >
              {t(`drink.${type}`)}
            </button>
          ))}
        </div>

        {DRINK_TYPES.filter((type) => drinks[type]).map((type) => {
          const d = drinks[type] ?? emptyDrink;
          const target = targets.find((x) => x.drink_type === type);
          const dose = Number(d.dose);
          const yieldG = Number(d.yield);
          const time = Number(d.time);
          const ey = extractionYield(dose, yieldG, Number(d.tds) || null);
          const id = (key: string) => `cal-${type}-${key}`;
          return (
            <div key={type} className="flex flex-col gap-3 rounded-[12px] border border-black/15 p-3">
              <p className="text-sm font-semibold">{t(`drink.${type}`)}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {field(id("dose"), t("doseG"), d.dose, (v) => setDrink(type, "dose", v), {
                  min: "0.1",
                  required: true,
                  hint: target ? targetLine(dose, target.dose_min_g, target.dose_max_g, "g") : undefined,
                })}
                {field(id("yield"), t("yieldG"), d.yield, (v) => setDrink(type, "yield", v), {
                  min: "0.1",
                  required: true,
                  hint: target ? targetLine(yieldG, target.yield_min_g, target.yield_max_g, "g") : undefined,
                })}
                {field(id("time"), t("timeS"), d.time, (v) => setDrink(type, "time", v), {
                  min: "0.1",
                  required: true,
                  hint: target ? targetLine(time, target.time_min_seconds, target.time_max_seconds, "s") : undefined,
                })}
                {field(id("tds"), t("tdsPercent"), d.tds, (v) => setDrink(type, "tds", v), {
                  max: "25",
                  hint: ey != null ? t("eyValue", { value: ey }) : t("eyHint"),
                })}
              </div>
              <p className="text-sm">
                <span className={mutedText}>{t("ratio")}: </span>
                <span className="font-semibold">{brewRatio(dose, yieldG) ?? "—"}</span>
              </p>
              <div role="radiogroup" aria-label={t("tasteBalance")} className="flex flex-wrap items-center gap-2">
                <span className={labelClass}>{t("tasteBalance")}</span>
                {(["SOUR", "BALANCED", "BITTER"] as TasteBalance[]).map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="radio"
                    aria-checked={d.balance === b}
                    onClick={() => setDrink(type, "balance", d.balance === b ? "" : b)}
                    className={`inline-flex h-9 items-center rounded-full border-[1.5px] px-4 text-sm font-semibold ${
                      d.balance === b ? "border-black bg-black text-white" : "border-black/40 bg-white"
                    }`}
                  >
                    {t(`balance.${b}`)}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={id("notes")} className={labelClass}>
                  {t("tasteNotes")}
                </label>
                <textarea
                  id={id("notes")}
                  rows={2}
                  value={d.notes}
                  onChange={(e) => setDrink(type, "notes", e.target.value)}
                  className="rounded-[10px] border-[1.5px] border-black px-3.5 py-2.5 text-base"
                />
              </div>
              <button type="button" disabled={busy} onClick={() => saveShot(type)} className={`${secondaryButton} self-start`}>
                {t("saveShot")}
              </button>
            </div>
          );
        })}
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
        <button type="button" onClick={onClose} className={secondaryButton}>
          {t("cancel")}
        </button>
      </div>
      <p className={mutedText}>{t("shotHint")}</p>

      {shots.length > 0 && <ShotList shots={shots} grinderNames={grinderNames} onUse={useShot} />}
    </form>
  );
}
