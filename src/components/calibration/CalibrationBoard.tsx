"use client";

import { toast } from "@/components/ui/toast";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  cardClass,
  errorText,
  inputClass,
  labelClass,
  mutedText,
  primaryButton,
  secondaryButton,
} from "@/components/ui/styles";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Outlet } from "@/lib/auth/currentUser";
import { brewRatio, checkRange, daysOffRoast, extractionYield } from "@/lib/calibration/calc";
import { createClient } from "@/lib/supabase/client";
import { BeanTargetForm } from "./BeanTargetForm";
import { CalibrationForm } from "./CalibrationForm";
import { ShotList } from "./ShotList";
import type { Bean, BeanTarget, CalibrationRecord, CalibrationShot, Grinder, Machine } from "./types";

/** Which form is open: a new record of a bean, an existing record, or a bean's targets. */
type OpenForm = { kind: "new"; beanId: string } | { kind: "edit"; recordId: string } | { kind: "target"; beanId: string };

export function CalibrationBoard({
  outlets,
  outletId,
  date,
  today,
  editable,
  canManage,
  beans,
  targets,
  grinders,
  machines,
  records,
  previous,
  shots,
}: {
  outlets: Outlet[];
  outletId: string;
  date: string;
  today: string;
  editable: boolean;
  canManage: boolean;
  beans: Bean[];
  targets: BeanTarget[];
  grinders: Grinder[];
  machines: Machine[];
  records: CalibrationRecord[];
  previous: CalibrationRecord[];
  shots: CalibrationShot[];
}) {
  const t = useTranslations("Calibration");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState<OpenForm | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grinderNames = new Map(grinders.map((g) => [g.id, g.name]));
  const machineNames = new Map(machines.map((m) => [m.id, m.name]));
  const activeGrinders = grinders.filter((g) => g.is_active);
  const activeMachines = machines.filter((m) => m.is_active);
  const targetOf = new Map(targets.map((x) => [x.material_id, x]));
  // Beans with a record or test shot stay listed even if no longer offered for new records.
  const allBeans = [
    ...beans,
    ...[...new Set([...records, ...shots].map((r) => r.coffee_bean_material_id))]
      .filter((id) => !beans.some((b) => b.id === id))
      .map((id) => ({ id, name: "—" })),
  ];

  function navigate(next: { outlet?: string; date?: string }) {
    const params = new URLSearchParams({ outlet: next.outlet ?? outletId, date: next.date ?? date });
    router.push(`${pathname}?${params}`);
  }

  function show(form: OpenForm | null) {
    setOpen(form);
    setDeleteFor(null);
    setError(null);
  }

  async function setDeleted(record: CalibrationRecord, deleted: boolean) {
    if (busy) return;
    if (deleted && !reason.trim()) {
      setError(t("reasonRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: updateError } = await createClient()
      .from("calibrations")
      .update(
        deleted
          ? { deleted_at: new Date().toISOString(), delete_reason: reason.trim() }
          : { deleted_at: null, deleted_by: null, delete_reason: null },
      )
      .eq("id", record.id)
      .eq("revision", record.revision)
      .select("id");
    setBusy(false);
    if (updateError || !data?.length) {
      setError(updateError ? t("saveFailed") : t("conflict"));
    } else {
      setDeleteFor(null);
      setReason("");
      toast(deleted ? "deleted" : "restored");
    }
    router.refresh();
  }

  const updatedAt = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuala_Lumpur",
    });

  const machinesFor = (record: CalibrationRecord | null) =>
    machines.filter((m) => m.is_active || m.id === record?.espresso_machine_id);

  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardClass} grid gap-4 sm:grid-cols-2`}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="calibration-outlet" className={labelClass}>
            {t("outlet")}
          </label>
          <select
            id="calibration-outlet"
            value={outletId}
            onChange={(event) => navigate({ outlet: event.target.value })}
            className={inputClass}
          >
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="calibration-date" className={labelClass}>
            {t("businessDate")}
          </label>
          <input
            id="calibration-date"
            type="date"
            max={today}
            value={date}
            onChange={(event) => event.target.value && navigate({ date: event.target.value })}
            className={inputClass}
          />
        </div>
        <p className={`${mutedText} sm:col-span-2`}>
          {editable ? (canManage ? t("managerWindow") : t("baristaWindow")) : t("readOnly")}
        </p>
        <p className="text-sm sm:col-span-2">
          <span className={mutedText}>{t("equipment")}: </span>
          {activeGrinders.length || activeMachines.length
            ? [...activeGrinders, ...activeMachines]
                .map((x) => [x.name, [x.brand, x.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "))
                .join(" / ")
            : "—"}
        </p>
      </div>

      {activeGrinders.length === 0 && <p className={`${cardClass} text-sm font-semibold`}>{t("noGrinders")}</p>}

      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}

      {allBeans.length === 0 && <p className={`${cardClass} text-sm`}>{t("noBeans")}</p>}

      <ul className="grid items-start gap-4 lg:grid-cols-2">
        {allBeans.map((bean) => {
          const beanRecords = records
            .filter((r) => r.coffee_bean_material_id === bean.id)
            .sort((a, b) => (grinderNames.get(a.grinder_id) ?? "").localeCompare(grinderNames.get(b.grinder_id) ?? ""));
          const beanShots = shots.filter((s) => s.coffee_bean_material_id === bean.id);
          const target = targetOf.get(bean.id);
          const freeGrinders = activeGrinders.filter((g) => !beanRecords.some((r) => r.grinder_id === g.id));
          const yesterday = new Map(
            previous.filter((r) => r.coffee_bean_material_id === bean.id).map((r) => [r.grinder_id, r]),
          );
          const isNewOpen = open?.kind === "new" && open.beanId === bean.id;
          const isTargetOpen = open?.kind === "target" && open.beanId === bean.id;
          const editingHere = open?.kind === "edit" && beanRecords.some((r) => r.id === open.recordId);
          return (
            <li key={bean.id} className={`${cardClass} flex flex-col gap-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{bean.name}</h2>
                {beanRecords.length === 0 && <StatusBadge tone="grey">{t("notRecorded")}</StatusBadge>}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className={mutedText}>
                  {target
                    ? t("targetSummary", {
                        dose: `${target.dose_min_g}–${target.dose_max_g}`,
                        yield: `${target.yield_min_g}–${target.yield_max_g}`,
                        time: `${target.time_min_seconds}–${target.time_max_seconds}`,
                      })
                    : t("noTarget")}
                </span>
                {canManage && !isTargetOpen && (
                  <button type="button" onClick={() => show({ kind: "target", beanId: bean.id })} className="font-semibold underline">
                    {target ? t("editTarget") : t("setTarget")}
                  </button>
                )}
              </div>
              {isTargetOpen && <BeanTargetForm beanId={bean.id} target={target} onClose={() => show(null)} />}

              {beanRecords.map((record) => {
                const deleted = !!record.deleted_at;
                const isOpen = open?.kind === "edit" && open.recordId === record.id;
                const ey = extractionYield(record.dose_g, record.yield_g, record.tds_percent);
                const age = daysOffRoast(record.roast_date, date);
                const off = (value: number, min?: number, max?: number) =>
                  min != null && max != null && checkRange(value, min, max) !== "OK" ? "text-[#c4161c]" : "";
                const facts: [string, string, string?][] = [
                  [t("dose"), `${record.dose_g} g`, off(record.dose_g, target?.dose_min_g, target?.dose_max_g)],
                  [t("yield"), `${record.yield_g} g`, off(record.yield_g, target?.yield_min_g, target?.yield_max_g)],
                  [t("ratio"), brewRatio(record.dose_g, record.yield_g) ?? "—"],
                  [
                    t("time"),
                    `${record.extraction_time_seconds} s`,
                    off(record.extraction_time_seconds, target?.time_min_seconds, target?.time_max_seconds),
                  ],
                  [t("grind"), record.grind_setting],
                  ...(record.water_temp_c != null ? [[t("waterTemp"), `${record.water_temp_c} °C`] as [string, string]] : []),
                  ...(record.pressure_bar != null ? [[t("pressure"), `${record.pressure_bar} bar`] as [string, string]] : []),
                  ...(record.preinfusion_seconds != null
                    ? [[t("preinfusion"), `${record.preinfusion_seconds} s`] as [string, string]]
                    : []),
                  ...(record.basket_g != null ? [[t("basket"), `${record.basket_g} g`] as [string, string]] : []),
                  ...(record.tds_percent != null ? [["TDS", `${record.tds_percent}%`] as [string, string]] : []),
                  ...(ey != null ? [["EY", `${ey}%`] as [string, string]] : []),
                  ...(age != null ? [[t("roastAge"), t("daysShort", { days: age })] as [string, string]] : []),
                  ...(record.taste_balance
                    ? [[t("tasteBalance"), t(`balance.${record.taste_balance}`)] as [string, string]]
                    : []),
                ];
                return (
                  <div key={record.id} className="flex flex-col gap-3 rounded-[12px] border border-black/15 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{grinderNames.get(record.grinder_id) ?? "—"}</span>
                      {record.espresso_machine_id && (
                        <span className={mutedText}>· {machineNames.get(record.espresso_machine_id) ?? "—"}</span>
                      )}
                      {deleted ? (
                        <StatusBadge tone="red">{t("deleted")}</StatusBadge>
                      ) : (
                        <StatusBadge tone="green">{t("final")}</StatusBadge>
                      )}
                    </div>
                    {isOpen ? (
                      <CalibrationForm
                        outletId={outletId}
                        date={date}
                        beanId={bean.id}
                        record={record}
                        grinders={grinders.filter((g) => g.id === record.grinder_id)}
                        machines={machinesFor(record)}
                        target={target}
                        yesterday={yesterday}
                        shots={beanShots.filter((s) => s.grinder_id === record.grinder_id)}
                        grinderNames={grinderNames}
                        onClose={() => show(null)}
                      />
                    ) : (
                      <>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                          {facts.map(([label, value, tone]) => (
                            <div key={label}>
                              <dt className={mutedText}>{label}</dt>
                              <dd className={`font-semibold ${tone ?? ""}`}>{value}</dd>
                            </div>
                          ))}
                        </dl>
                        {record.taste_notes && <p className="text-sm">{record.taste_notes}</p>}
                        <p className={mutedText}>
                          {deleted
                            ? t("deletedReason", { reason: record.delete_reason ?? "" })
                            : t("updated", { date: updatedAt(record.updated_at) })}
                        </p>
                      </>
                    )}

                    {editable && !isOpen && (
                      <div className="flex flex-wrap gap-2">
                        {!deleted && (
                          <button type="button" onClick={() => show({ kind: "edit", recordId: record.id })} className={secondaryButton}>
                            {t("edit")}
                          </button>
                        )}
                        {canManage && !deleted && deleteFor !== record.id && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteFor(record.id);
                              setReason("");
                              setError(null);
                            }}
                            className={secondaryButton}
                          >
                            {t("delete")}
                          </button>
                        )}
                        {canManage && deleted && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setDeleted(record, false)}
                            className={secondaryButton}
                          >
                            {t("restore")}
                          </button>
                        )}
                      </div>
                    )}

                    {deleteFor === record.id && (
                      <div className="flex flex-col gap-2">
                        <label htmlFor="cal-delete-reason" className={labelClass}>
                          {t("deleteReason")}
                        </label>
                        <input
                          id="cal-delete-reason"
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          className={inputClass}
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setDeleted(record, true)}
                            className={primaryButton}
                          >
                            {t("confirmDelete")}
                          </button>
                          <button type="button" onClick={() => setDeleteFor(null)} className={secondaryButton}>
                            {t("cancel")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {isNewOpen ? (
                <CalibrationForm
                  outletId={outletId}
                  date={date}
                  beanId={bean.id}
                  record={null}
                  grinders={freeGrinders}
                  machines={activeMachines}
                  target={target}
                  yesterday={yesterday}
                  shots={beanShots.filter((s) => freeGrinders.some((g) => g.id === s.grinder_id))}
                  grinderNames={grinderNames}
                  onClose={() => show(null)}
                />
              ) : (
                <>
                  {editable && freeGrinders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => show({ kind: "new", beanId: bean.id })}
                      className={`${secondaryButton} self-start`}
                    >
                      {beanRecords.length ? t("recordAnotherGrinder") : t("record")}
                    </button>
                  )}
                  {beanShots.length > 0 && !editingHere && (
                    <ShotList shots={beanShots} grinderNames={grinderNames} />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
