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
import { checkRange, daysOffRoast } from "@/lib/calibration/calc";
import { filterExtractionYield, minutes, waterRatio } from "@/lib/calibration/filterCalc";
import { createClient } from "@/lib/supabase/client";
import { BeanTargetForm } from "../BeanTargetForm";
import { equipmentName, type Bean, type Grinder, type Purpose } from "../types";
import { FilterBrewList } from "./FilterBrewList";
import { FilterForm } from "./FilterForm";
import type { Brewer, FilterBrew, FilterRecord, FilterTarget } from "./types";

/** Which form is open: a new record of a bean, an existing record, or a bean's targets. */
type OpenForm =
  | { kind: "new"; beanId: string }
  | { kind: "edit"; recordId: string }
  | { kind: "target"; beanId: string };

export function FilterBoard({
  purpose,
  userId,
  creatorNames,
  outlets,
  outletId,
  date,
  today,
  editable,
  canManage,
  beans,
  targets,
  grinders,
  brewers,
  records,
  previous,
  brews,
}: {
  purpose: Purpose;
  userId: string;
  /** Custom (Super Admin): who made each record. */
  creatorNames: Map<string, string>;
  outlets: Outlet[];
  /** Daily: the outlet shown. Custom: null. */
  outletId: string | null;
  date: string;
  today: string;
  editable: boolean;
  canManage: boolean;
  beans: Bean[];
  targets: FilterTarget[];
  grinders: Grinder[];
  brewers: Brewer[];
  records: FilterRecord[];
  previous: FilterRecord[];
  brews: FilterBrew[];
}) {
  const t = useTranslations("Calibration");
  const tf = useTranslations("FilterCalibration");
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
  const brewerNames = new Map(brewers.map((b) => [b.id, b.name]));
  const activeGrinders = grinders.filter((g) => g.is_active);
  const activeBrewers = brewers.filter((b) => b.is_active);
  const targetOf = new Map(targets.map((x) => [x.material_id, x]));
  // Beans with a record or test brew stay listed even if no longer offered for new records.
  const allBeans = [
    ...beans,
    ...[...new Set([...records, ...brews].map((r) => r.coffee_bean_material_id))]
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

  async function setDeleted(record: FilterRecord, deleted: boolean) {
    if (busy) return;
    if (deleted && !reason.trim()) {
      setError(t("reasonRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: updateError } = await createClient()
      .from("filter_calibrations")
      .update(
        deleted
          ? {
              deleted_at: new Date().toISOString(),
              delete_reason: reason.trim(),
            }
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

  const grindersFor = (record: FilterRecord | null) =>
    grinders.filter((g) => g.is_active || g.id === record?.grinder_id);

  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardClass} grid gap-4 sm:grid-cols-2`}>
        {!custom && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filter-outlet" className={labelClass}>
              {t("outlet")}
            </label>
            <select
              id="filter-outlet"
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
          <label htmlFor="filter-date" className={labelClass}>
            {custom ? t("date") : t("businessDate")}
          </label>
          <input
            id="filter-date"
            type="date"
            max={today}
            value={date}
            onChange={(event) => event.target.value && navigate({ date: event.target.value })}
            className={inputClass}
          />
        </div>
        <p className={`${mutedText} sm:col-span-2`}>
          {custom
            ? t("customWindow")
            : editable
              ? canManage
                ? t("managerWindow")
                : t("baristaWindow")
              : t("readOnly")}
        </p>
        {!custom && (
          <p className="text-sm sm:col-span-2">
            <span className={mutedText}>{t("equipment")}: </span>
            {activeBrewers.length || activeGrinders.length
              ? [...activeBrewers, ...activeGrinders]
                  .map((x) => [x.name, [x.brand, x.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "))
                  .join(" / ")
              : "—"}
          </p>
        )}
      </div>

      {!custom && (activeBrewers.length === 0 || activeGrinders.length === 0) && (
        <p className={`${cardClass} text-sm font-semibold`}>{tf("noEquipment")}</p>
      )}

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
              equipmentName(a.brewer_id, a.brewer_name, brewerNames).localeCompare(
                equipmentName(b.brewer_id, b.brewer_name, brewerNames),
              ),
            );
          const beanBrews = brews.filter((s) => s.coffee_bean_material_id === bean.id);
          const target = targetOf.get(bean.id);
          const freeBrewers = custom
            ? activeBrewers
            : activeBrewers.filter((b) => !beanRecords.some((r) => r.brewer_id === b.id));
          const beanPrevious = previous.filter((r) => r.coffee_bean_material_id === bean.id);
          const yesterday = new Map(
            custom
              ? beanPrevious.slice(0, 1).map((r) => ["*", r] as const)
              : beanPrevious.map((r) => [r.brewer_id ?? "", r] as const),
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
                    ? tf("targetSummary", {
                        dose: `${target.dose_min_g}–${target.dose_max_g}`,
                        ratio: `${target.ratio_min}–${target.ratio_max}`,
                        time: `${minutes(target.time_min_seconds)}–${minutes(target.time_max_seconds)}`,
                      })
                    : t("noTarget")}
                </span>
                {canManage && !isTargetOpen && (
                  <button
                    type="button"
                    onClick={() => show({ kind: "target", beanId: bean.id })}
                    className="font-semibold underline"
                  >
                    {target ? t("editTarget") : t("setTarget")}
                  </button>
                )}
              </div>
              {isTargetOpen && <BeanTargetForm filter beanId={bean.id} target={target} onClose={() => show(null)} />}

              {beanRecords.map((record) => {
                const deleted = !!record.deleted_at;
                const isOpen = open?.kind === "edit" && open.recordId === record.id;
                const ratio = waterRatio(record.dose_g, record.water_g);
                const ey = filterExtractionYield(record.dose_g, record.beverage_g, record.tds_percent);
                const age = daysOffRoast(record.roast_date, record.business_date);
                const mine = !custom || record.created_by === userId;
                const canDelete = custom ? mine : canManage;
                const off = (value: number | null, min?: number, max?: number) =>
                  value != null && min != null && max != null && checkRange(value, min, max) !== "OK"
                    ? "text-[#c4161c]"
                    : "";
                const facts: [string, string, string?][] = [
                  [t("dose"), `${record.dose_g} g`, off(record.dose_g, target?.dose_min_g, target?.dose_max_g)],
                  [tf("water"), `${record.water_g} g`],
                  [t("ratio"), ratio != null ? `1:${ratio}` : "—", off(ratio, target?.ratio_min, target?.ratio_max)],
                  [
                    tf("totalTime"),
                    minutes(record.total_time_seconds),
                    off(record.total_time_seconds, target?.time_min_seconds, target?.time_max_seconds),
                  ],
                  [t("grinder"), equipmentName(record.grinder_id, record.grinder_name, grinderNames)],
                  [t("grind"), record.grind_setting],
                  ...(record.grinder_rpm != null ? [["RPM", String(record.grinder_rpm)] as [string, string]] : []),
                  ...(record.water_temp_c != null
                    ? [[t("waterTemp"), `${record.water_temp_c} °C`] as [string, string]]
                    : []),
                  ...(record.bloom_water_g != null || record.bloom_seconds != null
                    ? [
                        [tf("bloom"), `${record.bloom_water_g ?? "—"} g · ${record.bloom_seconds ?? "—"} s`] as [
                          string,
                          string,
                        ],
                      ]
                    : []),
                  ...(record.pour_count != null
                    ? [[tf("pourCount"), String(record.pour_count)] as [string, string]]
                    : []),
                  ...(record.beverage_g != null
                    ? [[tf("beverage"), `${record.beverage_g} g`] as [string, string]]
                    : []),
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
                      <span className="text-sm font-semibold">
                        {equipmentName(record.brewer_id, record.brewer_name, brewerNames)}
                      </span>
                      {deleted ? (
                        <StatusBadge tone="red">{t("deleted")}</StatusBadge>
                      ) : (
                        <StatusBadge tone="green">{t("final")}</StatusBadge>
                      )}
                      {custom && !mine && (
                        <span className={mutedText}>
                          {t("createdBy", {
                            name: creatorNames.get(record.created_by) ?? "—",
                          })}
                        </span>
                      )}
                    </div>
                    {isOpen ? (
                      <FilterForm
                        purpose={purpose}
                        outletId={outletId}
                        date={date}
                        beanId={bean.id}
                        record={record}
                        brewers={
                          custom
                            ? brewers.filter((b) => b.is_active || b.id === record.brewer_id)
                            : brewers.filter((b) => b.id === record.brewer_id)
                        }
                        grinders={grindersFor(record)}
                        target={target}
                        yesterday={yesterday}
                        brews={beanBrews.filter((s) => custom || s.brewer_id === record.brewer_id)}
                        brewerNames={brewerNames}
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
                            ? t("deletedReason", {
                                reason: record.delete_reason ?? "",
                              })
                            : t("updated", {
                                date: updatedAt(record.updated_at),
                              })}
                        </p>
                      </>
                    )}

                    {editable && mine && !isOpen && (
                      <div className="flex flex-wrap gap-2">
                        {!deleted && (
                          <button
                            type="button"
                            onClick={() => show({ kind: "edit", recordId: record.id })}
                            className={secondaryButton}
                          >
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
                        <label htmlFor="fc-delete-reason" className={labelClass}>
                          {t("deleteReason")}
                        </label>
                        <input
                          id="fc-delete-reason"
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
                <FilterForm
                  purpose={purpose}
                  outletId={outletId}
                  date={date}
                  beanId={bean.id}
                  record={null}
                  brewers={freeBrewers}
                  grinders={activeGrinders}
                  target={target}
                  yesterday={yesterday}
                  brews={custom ? beanBrews : beanBrews.filter((s) => freeBrewers.some((b) => b.id === s.brewer_id))}
                  brewerNames={brewerNames}
                  onClose={() => show(null)}
                />
              ) : (
                <>
                  {editable && (custom || (freeBrewers.length > 0 && activeGrinders.length > 0)) && (
                    <button
                      type="button"
                      onClick={() => show({ kind: "new", beanId: bean.id })}
                      className={`${secondaryButton} self-start`}
                    >
                      {beanRecords.length ? (custom ? t("recordAnother") : tf("recordAnotherBrewer")) : t("record")}
                    </button>
                  )}
                  {beanBrews.length > 0 && !editingHere && (
                    <FilterBrewList brews={beanBrews} brewerNames={brewerNames} />
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
