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
import { type FinalKind, ItemTabs, useItemLabel } from "./FinalParts";
import { FilterBrewList } from "./filter/FilterBrewList";
import { FILTER_TEMPS, type FilterBrew, type FilterRecord } from "./filter/types";
import { ShotList } from "./ShotList";
import { DRINK_TYPES, equipmentName, type CalibrationRecord, type CalibrationShot, type FinalUse } from "./types";

type Row =
  | { kind: "ESPRESSO"; record: CalibrationRecord }
  | { kind: "FILTER"; record: FilterRecord };

/** The Finals of one "Save as final" (one per drink tab), shown as one card with tabs. */
type Group = { kind: FinalKind; session: string; rows: Row[] };

const ITEM_ORDER = [...DRINK_TYPES, "HOT", "ICED"];
const sortUses = (uses: FinalUse[]) => [...uses].sort((a, b) => ITEM_ORDER.indexOf(a.item) - ITEM_ORDER.indexOf(b.item));
const replaced = (r: { uses: FinalUse[] }) => r.uses.length > 0 && r.uses.every((u) => u.superseded_by);

/** The day's Finals of an outlet (and my custom ones), newest first, one card per save. */
export function CalibrationTable({
  userId,
  isSuperAdmin,
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
  isSuperAdmin: boolean;
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
  /** Open drink tab of each card. */
  const [tabOf, setTabOf] = useState<Record<string, string>>({});
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: Row[] = [
    ...espresso.map((record) => ({ kind: "ESPRESSO" as const, record })),
    ...filter.map((record) => ({ kind: "FILTER" as const, record })),
  ].sort((a, b) => a.record.created_at.localeCompare(b.record.created_at) || a.record.id.localeCompare(b.record.id));
  // One card per session; its first Final gives the time and the creator.
  const bySession = new Map<string, Group>();
  for (const row of rows) {
    const key = `${row.kind}:${row.record.session_id}`;
    const group = bySession.get(key);
    if (group) group.rows.push(row);
    else bySession.set(key, { kind: row.kind, session: row.record.session_id, rows: [row] });
  }
  const groups = [...bySession.values()].sort((a, b) => b.rows[0].record.created_at.localeCompare(a.rows[0].record.created_at));
  const shown = groups.filter((g) => show === "ALL" || g.kind === show);
  const groupKey = (g: Group) => `${g.kind}:${g.session}`;
  const itemsOf = (kind: FinalKind): string[] => (kind === "ESPRESSO" ? DRINK_TYPES : FILTER_TEMPS);
  /** The Final of a tab: the current one, else the newest that had this drink. */
  const rowFor = (g: Group, item: string) => {
    const withItem = g.rows.filter((r) => r.record.uses.some((u) => u.item === item));
    return (
      withItem.find((r) => !r.record.deleted_at && r.record.uses.some((u) => u.item === item && !u.superseded_by)) ??
      withItem[withItem.length - 1]
    );
  };
  const tabFor = (g: Group) => {
    const chosen = tabOf[groupKey(g)];
    if (chosen && itemsOf(g.kind).includes(chosen)) return chosen;
    return itemsOf(g.kind).find((x) => rowFor(g, x)) ?? itemsOf(g.kind)[0];
  };
  const isCurrentRow = (r: Row) => !r.record.deleted_at && r.record.uses.some((u) => !u.superseded_by);
  const groupDeleted = (g: Group) => g.rows.every((r) => r.record.deleted_at);
  const groupReplaced = (g: Group) => !groupDeleted(g) && g.rows.every((r) => r.record.deleted_at || replaced(r.record));
  const groupMain = (g: Group) => g.rows.find(isCurrentRow) ?? g.rows[0];
  /** Daily: its creator, or a Manager / Admin, on the same day. Custom: its creator or the Super Admin. */
  const canEdit = (g: Group) => {
    const owner = g.rows[0].record;
    if (!g.rows.some(isCurrentRow)) return false;
    return owner.purpose === "DAILY"
      ? date === today && (owner.created_by === userId || canManage)
      : owner.created_by === userId || isSuperAdmin;
  };
  const editHref = (g: Group) => `/calibration/new?${new URLSearchParams({ edit: g.session, kind: g.kind })}`;

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
    // Only the tries of this Final's drinks (tries saved before tabs have no drink and always show).
    const items = r.uses.map((u) => u.item);
    const tries =
      row.kind === "ESPRESSO"
        ? shots.filter((x) => sameKey(x) && (!x.drink_type || items.includes(x.drink_type)))
        : brews.filter((x) => sameKey(x) && (!x.temperature || items.includes(x.temperature)));
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
        {error && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </div>
    );
  };

  const shortRecipe = (row: Row) =>
    `${recipe(row)} · ${ratio(row)}${row.record.taste_balance ? ` · ${t(`balance.${row.record.taste_balance}`)}` : ""}`;

  /** Badges of a whole card. */
  const groupBadges = (g: Group) => (
    <span className="flex flex-wrap gap-1">
      <StatusBadge tone={g.kind === "ESPRESSO" ? "purple" : "green"}>{t(`kind.${g.kind}`)}</StatusBadge>
      {g.rows[0].record.purpose === "CUSTOM" && <StatusBadge tone="grey">{t("purpose.CUSTOM")}</StatusBadge>}
      {groupDeleted(g) ? (
        <StatusBadge tone="red">{t("deleted")}</StatusBadge>
      ) : (
        groupReplaced(g) && <StatusBadge tone="orange">{t("replaced")}</StatusBadge>
      )}
    </span>
  );

  const editButton = (g: Group) =>
    canEdit(g) ? (
      <Link href={editHref(g)} className={`${smallButton} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
        {t("edit")}
      </Link>
    ) : null;

  /** The drink tabs of a card, as in the form; the open tab shows its values (and details when expanded). */
  const groupTabs = (g: Group, expanded: boolean) => {
    const items = itemsOf(g.kind);
    const tab = tabFor(g);
    const row = rowFor(g, tab);
    const use = row?.record.uses.find((u) => u.item === tab);
    const summary = Object.fromEntries(
      items.flatMap((x) => {
        const r = rowFor(g, x);
        return r ? [[x, recipe(r)]] : [];
      }),
    );
    return (
      <ItemTabs
        kind={g.kind}
        items={items}
        value={tab}
        summary={summary}
        onChange={(x) => {
          setTabOf({ ...tabOf, [groupKey(g)]: x });
          setDeleteFor(null);
          setError(null);
        }}
        idPrefix={`cal-${g.session}`}
        shortcuts={false}
      >
        {!row ? (
          <p className={`${mutedText} text-sm`}>{t("tabEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p className={`flex flex-wrap items-center gap-2 ${row.record.deleted_at || use?.superseded_by ? "text-[#6b6d67]" : ""}`}>
              <span className="font-semibold tabular-nums">{shortRecipe(row)}</span>
              {row.record.deleted_at ? (
                <StatusBadge tone="red">{t("deleted")}</StatusBadge>
              ) : (
                use?.superseded_by && <StatusBadge tone="orange">{t("replaced")}</StatusBadge>
              )}
            </p>
            {expanded && <div className="border-t border-black/10 pt-3">{detail(row)}</div>}
          </div>
        )}
      </ItemTabs>
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
      {label} <span className={show === key ? "" : "text-[#6b6d67]"}>{groups.filter((g) => key === "ALL" || g.kind === key).length}</span>
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
          {/* Phone: one card per save, drinks as tabs. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {shown.map((g) => {
              const key = groupKey(g);
              const r = groupMain(g).record;
              return (
                <li key={key} className={`${cardClass} flex flex-col gap-2 ${groupDeleted(g) || groupReplaced(g) ? "opacity-70" : ""}`}>
                  <button type="button" onClick={() => toggle(key)} aria-expanded={open === key} className="flex flex-col gap-2 text-left">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-semibold">{bean(r.coffee_bean_material_id)}</span>
                        <span className={`block ${mutedText}`}>
                          {time(g.rows[0].record.created_at)} · {people.get(g.rows[0].record.created_by) ?? "—"}
                        </span>
                      </span>
                      <span aria-hidden className="text-xs">
                        {open === key ? "▲" : "▼"}
                      </span>
                    </span>
                    <span className="text-sm">
                      {grinder(r)} · {t("grind")} {r.grind_setting}
                      {r.grinder_rpm != null ? ` · ${r.grinder_rpm} RPM` : ""}
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {groupBadges(g)}
                    {editButton(g)}
                  </div>
                  {groupTabs(g, open === key)}
                </li>
              );
            })}
          </ul>

          {/* Desktop: one row per save; click a row for its drink tabs and details. */}
          <div className="hidden overflow-x-auto rounded-[20px] bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/15 text-[#3d3f3a]">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("colTime")}</th>
                  <th className="px-4 py-3 font-semibold">{t("colType")}</th>
                  <th className="px-4 py-3 font-semibold">{t("bean")}</th>
                  <th className="px-4 py-3 font-semibold">{t("colGrind")}</th>
                  <th className="px-4 py-3 font-semibold">{t("colRecipe")}</th>
                  <th className="px-4 py-3 font-semibold">{t("colBy")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const key = groupKey(g);
                  const r = groupMain(g).record;
                  const lines = itemsOf(g.kind).flatMap((x) => {
                    const row = rowFor(g, x);
                    const use = row?.record.uses.find((u) => u.item === x);
                    return row ? [{ x, row, off: !!row.record.deleted_at || !!use?.superseded_by }] : [];
                  });
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => toggle(key)}
                        aria-expanded={open === key}
                        className={`cursor-pointer border-b border-black/10 align-top hover:bg-[#f7f7f4] ${
                          groupDeleted(g) || groupReplaced(g) ? "text-[#6b6d67]" : ""
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums">{time(g.rows[0].record.created_at)}</td>
                        <td className="px-4 py-3">{groupBadges(g)}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold">{bean(r.coffee_bean_material_id)}</span>
                          {r.production_no && <span className={`block ${mutedText}`}>{r.production_no}</span>}
                        </td>
                        <td className="px-4 py-3">
                          {grinder(r)}
                          <span className={`block ${mutedText}`}>
                            {r.grind_setting}
                            {r.grinder_rpm != null ? ` · ${r.grinder_rpm} RPM` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ul className="flex flex-col gap-0.5">
                            {lines.map(({ x, row, off }) => (
                              <li key={x} className={`whitespace-nowrap tabular-nums ${off ? "text-[#6b6d67] line-through" : ""}`}>
                                <span className="font-semibold">{itemLabel(g.kind, x)}</span> {shortRecipe(row)}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="px-4 py-3">{people.get(g.rows[0].record.created_by) ?? "—"}</td>
                        <td className="px-4 py-3 text-right">{editButton(g)}</td>
                      </tr>
                      {open === key && (
                        <tr className="border-b border-black/10 bg-[#fafaf8]">
                          <td colSpan={7} className="px-4 py-4">
                            {groupTabs(g, true)}
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
