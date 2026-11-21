"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { inputClass, labelClass, mutedText, primaryButton, secondaryButton } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { brewRatio, checkRange, daysOffRoast, extractionYield, type RangeCheck } from "@/lib/calibration/calc";
import { createClient } from "@/lib/supabase/client";
import { BeanTargetForm } from "./BeanTargetForm";
import { EquipmentSelect, OTHER, equipmentColumns } from "./EquipmentSelect";
import { ApplyTo, FormError, ItemTabs, ProductionNoField, productionNoProblem, useFinalSave, type FinalToSave } from "./FinalParts";
import { ShotList } from "./ShotList";
import {
  DRINK_TYPES,
  type BeanTarget,
  type CalibrationRecord,
  type CalibrationShot,
  type DrinkType,
  type EspressoValues,
  type Grinder,
  type Machine,
  type Purpose,
  type SharedValues,
  type TasteBalance,
  rpmProblem,
} from "./types";

type FormState = {
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
};

/** The shot values of one tab (one drink). */
type ShotState = {
  dose: string;
  yield: string;
  time: string;
  tds: string;
  balance: string;
  notes: string;
};

const EMPTY_SHOT: ShotState = { dose: "", yield: "", time: "", tds: "", balance: "", notes: "" };
const emptyTabs = () => Object.fromEntries(DRINK_TYPES.map((d) => [d, EMPTY_SHOT])) as Record<DrinkType, ShotState>;
const isFilled = (shot: ShotState) => Object.values(shot).some((v) => v.trim() !== "");

const str = (value: number | string | null | undefined) => (value == null ? "" : String(value));

function fromValues(v: SharedValues & EspressoValues, base: FormState): FormState {
  return {
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
  };
}

function shotFromValues(v: EspressoValues): ShotState {
  return {
    dose: str(v.dose_g),
    yield: str(v.yield_g),
    time: str(v.extraction_time_seconds),
    tds: str(v.tds_percent),
    balance: v.taste_balance ?? "",
    notes: v.taste_notes ?? "",
  };
}

/** Blank is null; returns undefined when the text is not a number. */
function optionalNumber(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const rangeMark: Record<RangeCheck, string> = { LOW: "↓", OK: "✓", HIGH: "↑" };

/** Espresso: dial in with test shots per drink tab, then save each filled tab as its own Final. */
export function CalibrationForm({
  purpose,
  outletId,
  date,
  beanId,
  grinders,
  machines,
  targets,
  previous,
  shots,
  grinderNames,
  canManage,
  onDone,
}: {
  purpose: Purpose;
  /** Daily records only. */
  outletId: string | null;
  date: string;
  beanId: string;
  /** Daily: the outlet's grinders in use. Custom: every grinder in use. */
  grinders: Grinder[];
  machines: Machine[];
  /** This bean's targets, one per drink type. */
  targets: BeanTarget[];
  /** Earlier Finals of this bean to reuse, newest first: daily yesterday's, custom my last ones. */
  previous: CalibrationRecord[];
  /** Test shots of this bean today (each shows under its drink's tab). */
  shots: CalibrationShot[];
  grinderNames: Map<string, string>;
  canManage: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("Calibration");
  const router = useRouter();
  const custom = purpose === "CUSTOM";
  const final = useFinalSave({ kind: "ESPRESSO", purpose, outletId, date, onSaved: onDone });
  const { busy, setBusy, error, setError } = final;
  const [editTarget, setEditTarget] = useState(false);
  const [tab, setTab] = useState<DrinkType>("BLACK_HOT");
  const [tabs, setTabs] = useState(emptyTabs);
  const [roastDate, setRoastDate] = useState("");
  const [productionNo, setProductionNo] = useState("");

  const firstMachine = custom ? undefined : machines.find((m) => m.is_active);
  const [form, setForm] = useState<FormState>(() => ({
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
  }));
  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const shot = tabs[tab];
  const setShot = (key: keyof ShotState) => (e: { target: { value: string } }) => setTabs({ ...tabs, [tab]: { ...shot, [key]: e.target.value } });
  const filled = DRINK_TYPES.filter((d) => isFilled(tabs[d]));
  const summary = Object.fromEntries(
    filled.map((d) => {
      const x = tabs[d];
      return [d, [x.dose && x.yield ? `${x.dose} g → ${x.yield} g` : x.dose ? `${x.dose} g` : "", x.time ? `${x.time} s` : ""].filter(Boolean).join(" · ") || "…"];
    }),
  );
  // Only this tab's test shots; shots saved before tabs have no drink and are not shown here.
  const tabShots = shots.filter((s) => s.drink_type === tab);

  const grinder = grinders.find((g) => g.id === form.grinderId);
  // Earlier Finals to reuse: custom my last ones, daily yesterday's of this grinder.
  const reusable = custom ? previous : previous.filter((r) => r.grinder_id === form.grinderId);
  const prev = reusable[0];
  const age = daysOffRoast(roastDate || null, date);
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
  // Targets of the open tab's drink.
  const target = targets.find((x) => x.drink_type === tab);
  const dose = Number(shot.dose);
  const yieldG = Number(shot.yield);
  const time = Number(shot.time);
  const ey = extractionYield(dose, yieldG, Number(shot.tds) || null);

  /** Use earlier Finals: machine settings of the newest, and each drink's values into its tab. */
  function useEarlier() {
    if (!prev) return;
    setForm(fromValues(prev, form));
    const next = { ...tabs };
    for (const d of DRINK_TYPES) {
      const r = reusable.find((x) => x.uses.some((u) => u.item === d));
      if (r) next[d] = shotFromValues(r);
    }
    setTabs(next);
  }

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

  /** One tab's values with the shared settings, or null after showing why they are not valid. */
  function values(d: DrinkType): (SharedValues & EspressoValues) | null {
    const s = tabs[d];
    const dose = Number(s.dose);
    const yieldG = Number(s.yield);
    const time = Number(s.time);
    const g = equipmentColumns(form.grinderId, form.grinderName);
    const m = equipmentColumns(form.machineId, form.machineName);
    if (!form.grind.trim() || (!g.id && !g.name) || (form.machineId === OTHER && !m.name)) {
      setError(t("invalidShared"));
      return null;
    }
    if (!(dose > 0 && yieldG > 0 && time > 0)) {
      setTab(d);
      setError(t("invalidShotTab", { drink: t(`drink.${d}`) }));
      return null;
    }
    const optional = {
      water_temp_c: optionalNumber(form.temp),
      pressure_bar: optionalNumber(form.pressure),
      preinfusion_seconds: optionalNumber(form.preinfusion),
      basket_g: optionalNumber(form.basket),
      tds_percent: optionalNumber(s.tds),
    };
    const { water_temp_c: temp, pressure_bar: p, basket_g: basket, tds_percent: tds } = optional;
    if (
      Object.values(optional).some((v) => v === undefined || (v !== null && v < 0)) ||
      (temp != null && (temp < 80 || temp > 100)) ||
      (p != null && (p <= 0 || p > 20)) ||
      (basket != null && basket <= 0) ||
      (tds != null && (tds <= 0 || tds > 25))
    ) {
      setTab(d);
      setError(t("invalidOptional"));
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
      dose_g: dose,
      yield_g: yieldG,
      extraction_time_seconds: time,
      tds_percent: tds ?? null,
      taste_balance: s.balance || null,
      taste_notes: s.notes.trim() || null,
    };
  }

  async function saveFinal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (filled.length === 0) {
      setError(t("needShotValues"));
      return;
    }
    const finals: FinalToSave[] = [];
    for (const d of filled) {
      const v = values(d);
      if (!v) return;
      finals.push({ record: { ...v, roast_date: roastDate || null, production_no: productionNo.trim() || null }, items: [d] });
    }
    if (roastDate && roastDate > date) {
      setError(t("roastFuture"));
      return;
    }
    if (productionNoProblem(productionNo)) {
      setError(t("productionNoInvalid"));
      return;
    }
    await final.submit(finals);
  }

  async function saveShot() {
    if (busy) return;
    const v = values(tab);
    if (!v) return;
    setBusy(true);
    setError(null);
    const { error: insertError } = await createClient()
      .from("calibration_shots")
      .insert({ ...v, drink_type: tab, purpose, outlet_id: outletId, business_date: date });
    setBusy(false);
    if (insertError) {
      setError(t("saveFailed"));
      return;
    }
    toast("saved");
    router.refresh();
  }

  const targetLine = (value: number, min: number, max: number, unit: string) => {
    const check = value ? checkRange(value, min, max) : null;
    return (
      <span className={check && check !== "OK" ? "font-semibold text-[#c4161c]" : ""}>
        {t("targetRange", { min, max, unit })} {check ? rangeMark[check] : ""}
      </span>
    );
  };

  const numberField = (
    key: keyof FormState | keyof ShotState,
    label: string,
    opts: { min?: string; max?: string; required?: boolean; hint?: React.ReactNode } = {},
  ) => (
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
        value={key in shot ? shot[key as keyof ShotState] : form[key as keyof FormState]}
        onChange={key in shot ? setShot(key as keyof ShotState) : set(key as keyof FormState)}
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
            <label htmlFor="cal-roast" className={labelClass}>
              {t("roastDate")}
            </label>
            <input id="cal-roast" type="date" max={date} value={roastDate} onChange={(e) => setRoastDate(e.target.value)} className={inputClass} />
            {age != null && age >= 0 && <span className={mutedText}>{t("daysOffRoast", { days: age })}</span>}
          </div>
          <ProductionNoField id="cal-production" value={productionNo} onChange={setProductionNo} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">{t("machineSettings")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <EquipmentSelect
            id="cal-grinder"
            label={t("grinder")}
            options={grinders}
            value={form.grinderId}
            typed={form.grinderName}
            allowOther={custom}
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
        {prev && (
          <button type="button" className={`${secondaryButton} self-start`} onClick={useEarlier}>
            {custom ? t("useLast") : t("useYesterday")}
          </button>
        )}
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
          {numberField("temp", t("waterTempC"), { min: "80", max: "100" })}
          {numberField("pressure", t("pressureBar"), { min: "0.1", max: "20" })}
          {numberField("preinfusion", t("preinfusionS"))}
          {numberField("basket", t("basketG"))}
        </div>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">{t("shot")}</legend>
        <ItemTabs kind="ESPRESSO" items={DRINK_TYPES} value={tab} summary={summary} onChange={(d) => setTab(d as DrinkType)}>
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
            {numberField("tds", t("tdsPercent"), { max: "25", hint: ey != null ? t("eyValue", { value: ey }) : t("eyHint") })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span>
              <span className={mutedText}>{t("ratio")}: </span>
              <span className="font-semibold">{brewRatio(dose, yieldG) ?? "—"}</span>
            </span>
            {canManage && (
              <button type="button" className="text-[13px] underline" onClick={() => setEditTarget(!editTarget)}>
                {targets.length ? t("editTarget") : t("setTarget")}
              </button>
            )}
          </div>
          {editTarget && <BeanTargetForm beanId={beanId} espressoTargets={targets} onClose={() => setEditTarget(false)} />}
          <div role="radiogroup" aria-label={t("tasteBalance")} className="flex flex-wrap items-center gap-2">
            <span className={labelClass}>{t("tasteBalance")}</span>
            {(["SOUR", "BALANCED", "BITTER"] as TasteBalance[]).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={shot.balance === b}
                onClick={() => setTabs({ ...tabs, [tab]: { ...shot, balance: shot.balance === b ? "" : b } })}
                className={`inline-flex h-9 items-center rounded-full border-[1.5px] px-4 text-sm font-semibold ${
                  shot.balance === b ? "border-black bg-black text-white" : "border-black/40 bg-white"
                }`}
              >
                {t(`balance.${b}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cal-notes" className={labelClass}>
              {t("tasteNotes")}
            </label>
            <textarea
              id="cal-notes"
              rows={2}
              maxLength={1000}
              value={shot.notes}
              onChange={setShot("notes")}
              className="rounded-[10px] border-[1.5px] border-black px-3.5 py-2.5 text-base"
            />
          </div>
          <button type="button" disabled={busy} onClick={saveShot} className={`${secondaryButton} self-start`}>
            {t("saveShot")}
          </button>
          <p className={mutedText}>{t("shotHint")}</p>
          {tabShots.length > 0 && (
            <ShotList
              shots={tabShots}
              grinderNames={grinderNames}
              onUse={(s) => {
                setForm(fromValues(s, form));
                setTabs({ ...tabs, [tab]: shotFromValues(s) });
              }}
            />
          )}
          <ApplyTo kind="ESPRESSO" items={DRINK_TYPES} current={tab} onApply={(d) => setTabs({ ...tabs, [d]: { ...shot } })} />
        </ItemTabs>
      </fieldset>

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
