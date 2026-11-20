"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { toast } from "@/components/ui/toast";
import { cardClass, errorText, inputClass, labelClass, mutedText, primaryButton, secondaryButton, smallButton } from "@/components/ui/styles";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { Outlet } from "@/lib/auth/currentUser";
import { brewRatio, daysOffRoast, extractionYield } from "@/lib/calibration/calc";
import { filterExtractionYield, minutes, waterRatio } from "@/lib/calibration/filterCalc";
import { createClient } from "@/lib/supabase/client";
import { type FinalKind, useItemLabel } from "./FinalParts";
import { FilterBrewList } from "./filter/FilterBrewList";
import type { FilterBrew, FilterRecord } from "./filter/types";
import { ShotList } from "./ShotList";
import { DRINK_TYPES, equipmentName, type CalibrationRecord, type CalibrationShot, type FinalUse } from "./types";

type Row =
  | { kind: "ESPRESSO"; record: CalibrationRecord }
  | { kind: "FILTER"; record: FilterRecord };

const ITEM_ORDER = [...DRINK_TYPES, "HOT", "ICED"];
const sortUses = (uses: FinalUse[]) => [...uses].sort((a, b) => ITEM_ORDER.indexOf(a.item) - ITEM_ORDER.indexOf(b.item));
const replaced = (r: { uses: FinalUse[] }) => r.uses.length > 0 && r.uses.every((u) => u.superseded_by);

/** The day's Finals of an outlet (and my custom ones), newest first. */
export function CalibrationTable({
  userId,
  outlets,
  outletId,
  date,
  today,
  canManage,
  dailyEditable,
  espresso,
  filter,
  shots,
  brews,
  beanNames,
  grinderNames,
  machineNames,
  brewerNames,
  people,
}: {
  userId: string;
  outlets: Outlet[];
  outletId: string | null;
  date: string;
  today: string;
  canManage: boolean;
  /** Daily records of this date can still be deleted / restored by a Manager or Admin. */
  dailyEditable: boolean;
  espresso: CalibrationRecord[];
  filter: FilterRecord[];
  shots: (CalibrationShot & { purpose: string; created_by: string })[];
  brews: (FilterBrew & { purpose: string; created_by: string })[];
  beanNames: Map<string, string>;
  grinderNames: Map<string, string>;
  machineNames: Map<string, string>;
  brewerNames: Map<string, string>;
  people: Map<string, string>;
}) {
  const t = useTranslations("Calibration");
  const tf = useTranslations("FilterCalibration");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const itemLabel = useItemLabel();
  const [show, setShow] = useState<"ALL" | FinalKind>("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: Row[] = [
    ...espresso.map((record) => ({ kind: "ESPRESSO" as const, record })),
    ...filter.map((record) => ({ kind: "FILTER" as const, record })),
  ].sort((a, b) => b.record.created_at.localeCompare(a.record.created_at));
  const shown = rows.filter((r) => show === "ALL" || r.kind === show);

  function navigate(next: { outlet?: string; date?: string }) {
    const params = new URLSearchParams({ date: next.date ?? date });
    const outlet = next.outlet ?? outletId;
    if (outlet) params.set("outlet", outlet);
    router.push(`${pathname}?${params}`);
  }
  const newHref = `/calibration/new?${new URLSearchParams({ date, ...(outletId ? { outlet: outletId } : {}) })}`;

  const time = (value: string) => format.dateTime(new Date(value), { timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });
  const bean = (id: string) => beanNames.get(id) ?? "—";
  const grinder = (r: { grinder_id: string | null; grinder_name: string | null }) => equipmentName(r.grinder_id, r.grinder_name, grinderNames);
  const recipe = (row: Row) =>
    row.kind === "ESPRESSO"
      ? `${row.record.dose_g} g → ${row.record.yield_g} g · ${row.record.extraction_time_seconds} s`
      : `${row.record.dose_g} g : ${row.record.water_g} g · ${minutes(row.record.total_time_seconds)}`;
  const ratio = (row: Row) =>
    row.kind === "ESPRESSO" ? brewRatio(row.record.dose_g, row.record.yield_g) : `1:${waterRatio(row.record.dose_g, row.record.water_g)}`;
  const canDelete = (row: Row) =>
    row.record.purpose === "DAILY" ? canManage && dailyEditable : row.record.created_by === userId;
  /** When a newer Final replaced an item. */
  const replacedNote = (use: FinalUse) => (use.superseded_at ? t("replacedAt", { time: time(use.superseded_at) }) : "");

  async function setDeleted(row: Row, deleted: boolean) {
    if (busy) return;
    if (deleted && !reason.trim()) {
      setError(t("reasonRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: updateError } = await createClient()
      .from(row.kind === "ESPRESSO" ? "calibrations" : "filter_calibrations")
      .update(
        deleted
          ? { deleted_at: new Date().toISOString(), delete_reason: reason.trim() }
          : { deleted_at: null, deleted_by: null, delete_reason: null },
      )
      .eq("id", row.record.id)
      .eq("revision", row.record.revision)
      .select("id");
    setBusy(false);
    if (updateError || !data?.length) {
      setError(updateError?.code === "23505" ? t("restoreBlocked") : updateError ? t("saveFailed") : t("conflict"));
    } else {
      setDeleteFor(null);
      setReason("");
      toast(deleted ? "deleted" : "restored");
    }
    router.refresh();
  }

  const usesChips = (row: Row) => (
    <span className="flex flex-wrap gap-1">
      {sortUses(row.record.uses).map((u) => (
        <span
          key={u.id}
          title={replacedNote(u)}
          className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
            u.superseded_by ? "border-black/20 text-[#6b6d67] line-through" : "border-black bg-white font-semibold"
          }`}
        >
          {itemLabel(row.kind, u.item)}
        </span>
      ))}
    </span>
  );

  const badges = (row: Row) => (
    <span className="flex flex-wrap gap-1">
      <StatusBadge tone={row.kind === "ESPRESSO" ? "purple" : "green"}>{t(`kind.${row.kind}`)}</StatusBadge>
      {row.record.purpose === "CUSTOM" && <StatusBadge tone="grey">{t("purpose.CUSTOM")}</StatusBadge>}
      {row.record.deleted_at ? (
        <StatusBadge tone="red">{t("deleted")}</StatusBadge>
      ) : (
        replaced(row.record) && <StatusBadge tone="orange">{t("replaced")}</StatusBadge>
      )}
    </span>
  );

  const detail = (row: Row) => {
    const r = row.record;
    const age = daysOffRoast(r.roast_date, r.business_date);
    const facts: [string, string | null][] =
      row.kind === "ESPRESSO"
        ? [
            [t("machine"), equipmentName(row.record.espresso_machine_id, row.record.machine_name, machineNames)],
            [t("waterTemp"), row.record.water_temp_c != null ? `${row.record.water_temp_c} °C` : null],
            [t("pressure"), row.record.pressure_bar != null ? `${row.record.pressure_bar} bar` : null],
            [t("preinfusion"), row.record.preinfusion_seconds != null ? `${row.record.preinfusion_seconds} s` : null],
            [t("basket"), row.record.basket_g != null ? `${row.record.basket_g} g` : null],
            [
              "TDS / EY",
              row.record.tds_percent != null
                ? `${row.record.tds_percent}% / ${extractionYield(row.record.dose_g, row.record.yield_g, row.record.tds_percent) ?? "—"}%`
                : null,
            ],
          ]
        : [
            [tf("brewer"), equipmentName(row.record.brewer_id, row.record.brewer_name, brewerNames)],
            [tf("waterTempC"), row.record.water_temp_c != null ? `${row.record.water_temp_c} °C` : null],
            [
              tf("bloom"),
              row.record.bloom_water_g != null || row.record.bloom_seconds != null
                ? `${row.record.bloom_water_g ?? "—"} g / ${row.record.bloom_seconds ?? "—"} s`
                : null,
            ],
            [tf("pourCount"), row.record.pour_count != null ? String(row.record.pour_count) : null],
            [tf("beverage"), row.record.beverage_g != null ? `${row.record.beverage_g} g` : null],
            [
              "TDS / EY",
              row.record.tds_percent != null
                ? `${row.record.tds_percent}% / ${filterExtractionYield(row.record.dose_g, row.record.beverage_g, row.record.tds_percent) ?? "—"}%`
                : null,
            ],
          ];
    const bagFacts: [string, string | null][] = [
      [t("roastDate"), r.roast_date ? `${r.roast_date}${age != null && age >= 0 ? ` (${t("daysOffRoast", { days: age })})` : ""}` : null],
      [t("productionNo"), r.production_no],
    ];
    const sameKey = (x: { coffee_bean_material_id: string; grinder_id: string | null; grinder_name: string | null; purpose: string; created_by: string }) =>
      x.coffee_bean_material_id === r.coffee_bean_material_id &&
      x.purpose === r.purpose &&
      (r.purpose === "DAILY" ? x.grinder_id === r.grinder_id : x.created_by === r.created_by);
    const tries = row.kind === "ESPRESSO" ? shots.filter(sameKey) : brews.filter(sameKey);
    return (
      <div className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {[...bagFacts, ...facts]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className={mutedText}>{k}</dt>
                <dd className="font-semibold break-words">{v}</dd>
              </div>
            ))}
        </dl>
        {r.taste_notes && <p className="whitespace-pre-wrap">{r.taste_notes}</p>}
        {r.uses.some((u) => u.superseded_by) && (
          <ul className={`${mutedText} flex flex-col gap-0.5`}>
            {sortUses(r.uses)
              .filter((u) => u.superseded_by)
              .map((u) => (
                <li key={u.id}>
                  {itemLabel(row.kind, u.item)}: {replacedNote(u)}
                </li>
              ))}
          </ul>
        )}
        {r.deleted_at && <p className={mutedText}>{t("deletedReason", { reason: r.delete_reason ?? "" })}</p>}
        {tries.length > 0 &&
          (row.kind === "ESPRESSO" ? (
            <ShotList shots={tries as CalibrationShot[]} grinderNames={grinderNames} />
          ) : (
            <FilterBrewList brews={tries as FilterBrew[]} brewerNames={brewerNames} />
          ))}
        {canDelete(row) && deleteFor !== r.id && (
          <div className="flex flex-wrap gap-2">
            {r.deleted_at ? (
              <button type="button" disabled={busy} className={smallButton} onClick={() => setDeleted(row, false)}>
                {t("restore")}
              </button>
            ) : (
              <button
                type="button"
                className={smallButton}
                onClick={() => {
                  setDeleteFor(r.id);
                  setReason("");
                  setError(null);
                }}
              >
                {t("delete")}
              </button>
            )}
          </div>
        )}
        {deleteFor === r.id && (
          <div className="flex flex-col gap-2 rounded-[12px] border-[1.5px] border-black p-3">
            <label htmlFor={`delete-${r.id}`} className={labelClass}>
              {t("deleteReason")}
            </label>
            <input id={`delete-${r.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={primaryButton} onClick={() => setDeleted(row, true)}>
                {t("confirmDelete")}
              </button>
              <button type="button" className={secondaryButton} onClick={() => setDeleteFor(null)}>
                {t("cancel")}
              </button>
            </div>
          </div>
        )}
        {error && open === r.id && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </div>
    );
  };

  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    setDeleteFor(null);
    setError(null);
  };

  const filterChip = (key: "ALL" | FinalKind, label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={show === key}
      onClick={() => setShow(key)}
      className={`rounded-full border-[1.5px] border-black px-3 py-1 text-sm whitespace-nowrap ${show === key ? "bg-black text-white" : "bg-white"}`}
    >
      {label} <span className={show === key ? "" : "text-[#6b6d67]"}>{rows.filter((r) => key === "ALL" || r.kind === key).length}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardClass} flex flex-col gap-4 sm:flex-row sm:items-end`}>
        {outlets.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1.5 sm:w-64">
            <label htmlFor="calibration-outlet" className={labelClass}>
              {t("outlet")}
            </label>
            <select id="calibration-outlet" value={outletId ?? ""} onChange={(e) => navigate({ outlet: e.target.value })} className={inputClass}>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-52">
          <label htmlFor="calibration-date" className={labelClass}>
            {t("date")}
          </label>
          <input
            id="calibration-date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => e.target.value && navigate({ date: e.target.value })}
            className={inputClass}
          />
        </div>
        <Link href={newHref} className={`${primaryButton} sm:ml-auto`}>
          + {t("new")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {filterChip("ALL", t("allKinds"))}
        {filterChip("ESPRESSO", t("kind.ESPRESSO"))}
        {filterChip("FILTER", t("kind.FILTER"))}
      </div>

      {shown.length === 0 ? (
        <p className={`${cardClass} text-sm`}>{date === today ? t("emptyToday") : t("emptyDay")}</p>
      ) : (
        <>
          {/* Phone: one card per Final. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {shown.map((row) => {
              const r = row.record;
              return (
                <li key={r.id} className={`${cardClass} flex flex-col gap-2 ${r.deleted_at || replaced(r) ? "opacity-70" : ""}`}>
                  <button type="button" onClick={() => toggle(r.id)} aria-expanded={open === r.id} className="flex flex-col gap-2 text-left">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-semibold">{bean(r.coffee_bean_material_id)}</span>
                        <span className={`block ${mutedText}`}>
                          {time(r.created_at)} · {people.get(r.created_by) ?? "—"}
                        </span>
                      </span>
                      <span aria-hidden className="text-xs">
                        {open === r.id ? "▲" : "▼"}
                      </span>
                    </span>
                    {badges(row)}
                    {usesChips(row)}
                    <span className="text-sm">
                      {grinder(r)} · {t("grind")} {r.grind_setting}
                      {r.grinder_rpm != null ? ` · ${r.grinder_rpm} RPM` : ""}
                    </span>
                    <span className="text-sm">
                      {recipe(row)} · {ratio(row)}
                      {r.taste_balance ? ` · ${t(`balance.${r.taste_balance}`)}` : ""}
                    </span>
                  </button>
                  {open === r.id && <div className="border-t border-black/10 pt-3">{detail(row)}</div>}
                </li>
              );
            })}
          </ul>

          {/* Desktop: table, click a row for details. */}
          <div className="hidden overflow-x-auto rounded-[20px] bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/15 text-[#3d3f3a]">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("colTime")}</th>
                  <th className="px-4 py-3 font-semibold">{t("colType")}</th>
                  <th className="px-4 py-3 font-semibold">{t("bean")}</th>
                  <th className="px-4 py-3 font-semibold">{t("appliesTo")}</th>
                  <th className="px-4 py-3 font-semibold">{t("colGrind")}</th>
                  <th className="px-4 py-3 font-semibold">{t("colRecipe")}</th>
                  <th className="px-4 py-3 font-semibold">{t("tasteBalance")}</th>
                  <th className="px-4 py-3 font-semibold">{t("colBy")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const r = row.record;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => toggle(r.id)}
                        aria-expanded={open === r.id}
                        className={`cursor-pointer border-b border-black/10 align-top hover:bg-[#f7f7f4] ${
                          r.deleted_at || replaced(r) ? "text-[#6b6d67]" : ""
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums">{time(r.created_at)}</td>
                        <td className="px-4 py-3">{badges(row)}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold">{bean(r.coffee_bean_material_id)}</span>
                          {r.production_no && <span className={`block ${mutedText}`}>{r.production_no}</span>}
                        </td>
                        <td className="px-4 py-3">{usesChips(row)}</td>
                        <td className="px-4 py-3">
                          {grinder(r)}
                          <span className={`block ${mutedText}`}>
                            {r.grind_setting}
                            {r.grinder_rpm != null ? ` · ${r.grinder_rpm} RPM` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                          {recipe(row)}
                          <span className={`block ${mutedText}`}>{ratio(row)}</span>
                        </td>
                        <td className="px-4 py-3">{r.taste_balance ? t(`balance.${r.taste_balance}`) : "—"}</td>
                        <td className="px-4 py-3">{people.get(r.created_by) ?? "—"}</td>
                      </tr>
                      {open === r.id && (
                        <tr className="border-b border-black/10 bg-[#fafaf8]">
                          <td colSpan={8} className="px-4 py-4">
                            {detail(row)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
