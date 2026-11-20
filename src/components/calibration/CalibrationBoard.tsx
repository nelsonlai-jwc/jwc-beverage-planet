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
import {
  DRINK_TYPES,
  equipmentName,
  type Bean,
  type BeanTarget,
  type CalibrationRecord,
  type CalibrationShot,
  type Grinder,
  type Machine,
  type Purpose,
} from "./types";

/** Which form is open: a new record of a bean, an existing record, or a bean's targets. */
type OpenForm = { kind: "new"; beanId: string } | { kind: "edit"; recordId: string } | { kind: "target"; beanId: string };

export function CalibrationBoard({
  purpose,
  userId,
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
  creatorNames,
}: {
  purpose: Purpose;
  userId: string;
  outlets: Outlet[];
  /** Daily: the outlet shown. Custom: null. */
  outletId: string | null;
  date: string;
  today: string;
  /** Daily: inside the date window. Custom: always true (own records only). */
  editable: boolean;
  canManage: boolean;
  beans: Bean[];
  targets: BeanTarget[];
  /** Daily: the outlet's equipment. Custom: every outlet's, names include the outlet. */
  grinders: Grinder[];
  machines: Machine[];
  records: CalibrationRecord[];
  /** Daily: yesterday's records. Custom: my last record of each bean before this date. */
  previous: CalibrationRecord[];
  shots: CalibrationShot[];
  /** Custom (Super Admin): who made each record. */
  creatorNames: Map<string, string>;
}) {
  const t = useTranslations("Calibration");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const custom = purpose === "CUSTOM";
  const [open, setOpen] = useState<OpenForm | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grinderNames = new Map(grinders.map((g) => [g.id, g.name]));
  const machineNames = new Map(machines.map((m) => [m.id, m.name]));
  const activeGrinders = grinders.filter((g) => g.is_active);
  const activeMachines = machines.filter((m) => m.is_active);
  // Beans with a record or test shot stay listed even if no longer offered for new records.
  const allBeans = [
    ...beans,
    ...[...new Set([...records, ...shots].map((r) => r.coffee_bean_material_id))]
      .filter((id) => !beans.some((b) => b.id === id))
      .map((id) => ({ id, name: "—" })),
  ];

  function navigate(next: { outlet?: string; date?: string }) {
    const params = new URLSearchParams({ date: next.date ?? date });
    if (!custom) params.set("outlet", next.outlet ?? outletId ?? "");
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
        {!custom && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="calibration-outlet" className={labelClass}>
              {t("outlet")}
            </label>
            <select
              id="calibration-outlet"
              value={outletId ?? ""}
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
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="calibration-date" className={labelClass}>
            {custom ? t("date") : t("businessDate")}
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
          {custom ? t("customWindow") : editable ? (canManage ? t("managerWindow") : t("baristaWindow")) : t("readOnly")}
        </p>
        {!custom && (
          <p className="text-sm sm:col-span-2">
            <span className={mutedText}>{t("equipment")}: </span>
            {activeGrinders.length || activeMachines.length
              ? [...activeGrinders, ...activeMachines]
                  .map((x) => [x.name, [x.brand, x.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "))
                  .join(" / ")
              : "—"}
          </p>
        )}
      </div>

      {!custom && activeGrinders.length === 0 && <p className={`${cardClass} text-sm font-semibold`}>{t("noGrinders")}</p>}

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
            .sort((a, b) =>
              equipmentName(a.grinder_id, a.grinder_name, grinderNames).localeCompare(
                equipmentName(b.grinder_id, b.grinder_name, grinderNames),
              ),
            );
          const beanShots = shots.filter((s) => s.coffee_bean_material_id === bean.id);
          const beanTargets = targets.filter((x) => x.material_id === bean.id);
          const freeGrinders = custom
            ? activeGrinders
            : activeGrinders.filter((g) => !beanRecords.some((r) => r.grinder_id === g.id));
          const beanPrevious = previous.filter((r) => r.coffee_bean_material_id === bean.id);
          const prevMap = new Map(
            custom ? beanPrevious.slice(0, 1).map((r) => ["*", r] as const) : beanPrevious.map((r) => [r.grinder_id ?? "", r] as const),
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

              <div className="flex flex-wrap items-start gap-2 text-[13px]">
                <div className={`${mutedText} flex flex-col`}>
                  {beanTargets.length
                    ? DRINK_TYPES.map((type) => beanTargets.find((x) => x.drink_type === type))
                        .filter((x): x is BeanTarget => !!x)
                        .map((target) => (
                          <span key={target.drink_type}>
                            {t("targetSummary", {
                              drink: t(`drink.${target.drink_type}`),
                              dose: `${target.dose_min_g}–${target.dose_max_g}`,
                              yield: `${target.yield_min_g}–${target.yield_max_g}`,
                              time: `${target.time_min_seconds}–${target.time_max_seconds}`,
                            })}
                          </span>
                        ))
                    : t("noTarget")}
                </div>
                {canManage && !isTargetOpen && (
                  <button type="button" onClick={() => show({ kind: "target", beanId: bean.id })} className="font-semibold underline">
                    {beanTargets.length ? t("editTarget") : t("setTarget")}
                  </button>
                )}
              </div>
              {isTargetOpen && <BeanTargetForm beanId={bean.id} espressoTargets={beanTargets} onClose={() => show(null)} />}

              {beanRecords.map((record) => {
                const deleted = !!record.deleted_at;
                const isOpen = open?.kind === "edit" && open.recordId === record.id;
                const mine = !custom || record.created_by === userId;
                const canEdit = editable && mine;
                const canDelete = custom ? mine : canManage;
                const age = daysOffRoast(record.roast_date, record.business_date);
                const facts: [string, string][] = [
                  [t("grind"), record.grind_setting],
                  ...(record.grinder_rpm != null ? [["RPM", String(record.grinder_rpm)] as [string, string]] : []),
                  ...(record.water_temp_c != null ? [[t("waterTemp"), `${record.water_temp_c} °C`] as [string, string]] : []),
                  ...(record.pressure_bar != null ? [[t("pressure"), `${record.pressure_bar} bar`] as [string, string]] : []),
                  ...(record.preinfusion_seconds != null
                    ? [[t("preinfusion"), `${record.preinfusion_seconds} s`] as [string, string]]
                    : []),
                  ...(record.basket_g != null ? [[t("basket"), `${record.basket_g} g`] as [string, string]] : []),
                  ...(age != null ? [[t("roastAge"), t("daysShort", { days: age })] as [string, string]] : []),
                ];
                const drinks = DRINK_TYPES.map((type) => record.drinks.find((d) => d.drink_type === type)).filter(
                  (d): d is CalibrationRecord["drinks"][number] => !!d,
                );
                return (
                  <div key={record.id} className="flex flex-col gap-3 rounded-[12px] border border-black/15 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{equipmentName(record.grinder_id, record.grinder_name, grinderNames)}</span>
                      {(record.espresso_machine_id || record.machine_name) && (
                        <span className={mutedText}>· {equipmentName(record.espresso_machine_id, record.machine_name, machineNames)}</span>
                      )}
                      {deleted ? (
                        <StatusBadge tone="red">{t("deleted")}</StatusBadge>
                      ) : (
                        <StatusBadge tone="green">{t("final")}</StatusBadge>
                      )}
                      {custom && !mine && (
                        <span className={mutedText}>{t("createdBy", { name: creatorNames.get(record.created_by) ?? "—" })}</span>
                      )}
                    </div>
                    {isOpen ? (
                      <CalibrationForm
                        purpose={purpose}
                        outletId={outletId}
                        date={date}
                        beanId={bean.id}
                        record={record}
                        grinders={custom ? grinders.filter((g) => g.is_active || g.id === record.grinder_id) : grinders.filter((g) => g.id === record.grinder_id)}
                        machines={machinesFor(record)}
                        targets={beanTargets}
                        previous={new Map()}
                        shots={beanShots.filter((s) => custom || s.grinder_id === record.grinder_id)}
                        grinderNames={grinderNames}
                        onClose={() => show(null)}
                      />
                    ) : (
                      <>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                          {facts.map(([label, value]) => (
                            <div key={label}>
                              <dt className={mutedText}>{label}</dt>
                              <dd className="font-semibold">{value}</dd>
                            </div>
                          ))}
                        </dl>
                        <ul className="flex flex-col gap-2">
                          {drinks.map((d) => {
                            const target = beanTargets.find((x) => x.drink_type === d.drink_type);
                            const off = (value: number, min?: number, max?: number) =>
                              min != null && max != null && checkRange(value, min, max) !== "OK" ? "text-[#c4161c]" : "";
                            const ey = extractionYield(d.dose_g, d.yield_g, d.tds_percent);
                            return (
                              <li key={d.drink_type} className="flex flex-col gap-0.5 border-t border-black/10 pt-2 text-sm">
                                <span className="font-semibold">{t(`drink.${d.drink_type}`)}</span>
                                <span>
                                  <span className={off(d.dose_g, target?.dose_min_g, target?.dose_max_g)}>{d.dose_g} g</span>
                                  {" → "}
                                  <span className={off(d.yield_g, target?.yield_min_g, target?.yield_max_g)}>{d.yield_g} g</span>
                                  {` (${brewRatio(d.dose_g, d.yield_g) ?? "—"}) · `}
                                  <span className={off(d.extraction_time_seconds, target?.time_min_seconds, target?.time_max_seconds)}>
                                    {d.extraction_time_seconds} s
                                  </span>
                                  {d.tds_percent != null ? ` · TDS ${d.tds_percent}%` : ""}
                                  {ey != null ? ` · EY ${ey}%` : ""}
                                  {d.taste_balance ? ` · ${t(`balance.${d.taste_balance}`)}` : ""}
                                </span>
                                {d.taste_notes && <span className={mutedText}>{d.taste_notes}</span>}
                              </li>
                            );
                          })}
                        </ul>
                        <p className={mutedText}>
                          {deleted
                            ? t("deletedReason", { reason: record.delete_reason ?? "" })
                            : t("updated", { date: updatedAt(record.updated_at) })}
                        </p>
                      </>
                    )}

                    {canEdit && !isOpen && (
                      <div className="flex flex-wrap gap-2">
                        {!deleted && (
                          <button type="button" onClick={() => show({ kind: "edit", recordId: record.id })} className={secondaryButton}>
                            {t("edit")}
                          </button>
                        )}
                        {canDelete && !deleted && deleteFor !== record.id && (
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
                        {canDelete && deleted && (
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
                  purpose={purpose}
                  outletId={outletId}
                  date={date}
                  beanId={bean.id}
                  record={null}
                  grinders={freeGrinders}
                  machines={activeMachines}
                  targets={beanTargets}
                  previous={prevMap}
                  shots={custom ? beanShots : beanShots.filter((s) => freeGrinders.some((g) => g.id === s.grinder_id))}
                  grinderNames={grinderNames}
                  onClose={() => show(null)}
                />
              ) : (
                <>
                  {editable && (custom || freeGrinders.length > 0) && (
                    <button
                      type="button"
                      onClick={() => show({ kind: "new", beanId: bean.id })}
                      className={`${secondaryButton} self-start`}
                    >
                      {beanRecords.length ? (custom ? t("recordAnother") : t("recordAnotherGrinder")) : t("record")}
                    </button>
                  )}
                  {beanShots.length > 0 && !editingHere && <ShotList shots={beanShots} grinderNames={grinderNames} />}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
