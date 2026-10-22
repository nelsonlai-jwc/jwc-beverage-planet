"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
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
import { createClient } from "@/lib/supabase/client";

type CalibrationRecord = {
  id: string;
  coffee_bean_material_id: string;
  dose_g: number;
  yield_g: number;
  extraction_time_seconds: number;
  grind_setting: string;
  taste_notes: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  updated_at: string;
  revision: number;
};

type Bean = { id: string; name: string };

type FormState = {
  dose: string;
  yield: string;
  time: string;
  grind: string;
  notes: string;
};

const emptyForm: FormState = { dose: "", yield: "", time: "", grind: "", notes: "" };

export function CalibrationBoard({
  outlets,
  outletId,
  date,
  today,
  editable,
  canManage,
  beans,
  records,
}: {
  outlets: Outlet[];
  outletId: string;
  date: string;
  today: string;
  editable: boolean;
  canManage: boolean;
  beans: Bean[];
  records: CalibrationRecord[];
}) {
  const t = useTranslations("Calibration");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const [openBean, setOpenBean] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byBean = new Map(records.map((r) => [r.coffee_bean_material_id, r]));
  // Beans with a record stay listed even if no longer offered for new records.
  const allBeans = [
    ...beans,
    ...records
      .filter((r) => !beans.some((b) => b.id === r.coffee_bean_material_id))
      .map((r) => ({ id: r.coffee_bean_material_id, name: "—" })),
  ];

  function navigate(next: { outlet?: string; date?: string }) {
    const params = new URLSearchParams({ outlet: next.outlet ?? outletId, date: next.date ?? date });
    router.push(`${pathname}?${params}`);
  }

  function open(beanId: string) {
    const record = byBean.get(beanId);
    setForm(
      record
        ? {
            dose: String(record.dose_g),
            yield: String(record.yield_g),
            time: String(record.extraction_time_seconds),
            grind: record.grind_setting,
            notes: record.taste_notes ?? "",
          }
        : emptyForm,
    );
    setOpenBean(beanId);
    setDeleteFor(null);
    setError(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !openBean) return;
    const values = {
      dose_g: Number(form.dose),
      yield_g: Number(form.yield),
      extraction_time_seconds: Number(form.time),
      grind_setting: form.grind.trim(),
      taste_notes: form.notes.trim() || null,
    };
    if (!(values.dose_g > 0 && values.yield_g > 0 && values.extraction_time_seconds > 0) || !values.grind_setting) {
      setError(t("invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const record = byBean.get(openBean);
    if (record) {
      // Revision check: if someone saved first, nothing is updated (ch. 13.2).
      const { data, error: updateError } = await supabase
        .from("calibrations")
        .update(values)
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
      const { error: insertError } = await supabase.from("calibrations").insert({
        ...values,
        outlet_id: outletId,
        business_date: date,
        coffee_bean_material_id: openBean,
      });
      if (insertError) {
        // 23505: someone else recorded this bean for the day first.
        setError(insertError.code === "23505" ? t("alreadyRecorded") : t("saveFailed"));
        setBusy(false);
        router.refresh();
        return;
      }
    }
    setBusy(false);
    setOpenBean(null);
    router.refresh();
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
    }
    router.refresh();
  }

  const updatedAt = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuala_Lumpur",
    });

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
      </div>

      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}

      {allBeans.length === 0 && <p className={`${cardClass} text-sm`}>{t("noBeans")}</p>}

      <ul className="grid gap-4 lg:grid-cols-2">
        {allBeans.map((bean) => {
          const record = byBean.get(bean.id);
          const deleted = !!record?.deleted_at;
          const isOpen = openBean === bean.id;
          return (
            <li key={bean.id} className={`${cardClass} flex flex-col gap-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{bean.name}</h2>
                {record && !deleted && <StatusBadge tone="green">{t("final")}</StatusBadge>}
                {deleted && <StatusBadge tone="red">{t("deleted")}</StatusBadge>}
                {!record && <StatusBadge tone="grey">{t("notRecorded")}</StatusBadge>}
              </div>

              {record && !isOpen && (
                <>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                    <div>
                      <dt className={mutedText}>{t("dose")}</dt>
                      <dd className="font-semibold">{record.dose_g} g</dd>
                    </div>
                    <div>
                      <dt className={mutedText}>{t("yield")}</dt>
                      <dd className="font-semibold">{record.yield_g} g</dd>
                    </div>
                    <div>
                      <dt className={mutedText}>{t("time")}</dt>
                      <dd className="font-semibold">{record.extraction_time_seconds} s</dd>
                    </div>
                    <div>
                      <dt className={mutedText}>{t("grind")}</dt>
                      <dd className="font-semibold">{record.grind_setting}</dd>
                    </div>
                  </dl>
                  {record.taste_notes && <p className="text-sm">{record.taste_notes}</p>}
                  <p className={mutedText}>
                    {deleted
                      ? t("deletedReason", { reason: record.delete_reason ?? "" })
                      : t("updated", { date: updatedAt(record.updated_at) })}
                  </p>
                </>
              )}

              {isOpen && (
                <form onSubmit={handleSave} className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(
                      [
                        ["dose", t("doseG")],
                        ["yield", t("yieldG")],
                        ["time", t("timeS")],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="flex flex-col gap-1.5">
                        <label htmlFor={`cal-${key}`} className={labelClass}>
                          {label}
                        </label>
                        <input
                          id={`cal-${key}`}
                          type="number"
                          inputMode="decimal"
                          min="0.1"
                          step="0.1"
                          required
                          value={form[key]}
                          onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                          className={inputClass}
                        />
                      </div>
                    ))}
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="cal-grind" className={labelClass}>
                        {t("grind")}
                      </label>
                      <input
                        id="cal-grind"
                        required
                        maxLength={50}
                        value={form.grind}
                        onChange={(event) => setForm({ ...form, grind: event.target.value })}
                        className={inputClass}
                      />
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
                      onChange={(event) => setForm({ ...form, notes: event.target.value })}
                      className="rounded-[10px] border-[1.5px] border-black px-3.5 py-2.5 text-base"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={busy} className={primaryButton}>
                      {busy ? t("saving") : t("save")}
                    </button>
                    <button type="button" onClick={() => setOpenBean(null)} className={secondaryButton}>
                      {t("cancel")}
                    </button>
                  </div>
                </form>
              )}

              {editable && !isOpen && (
                <div className="flex flex-wrap gap-2">
                  {!deleted && (
                    <button type="button" onClick={() => open(bean.id)} className={secondaryButton}>
                      {record ? t("edit") : t("record")}
                    </button>
                  )}
                  {canManage && record && !deleted && deleteFor !== record.id && (
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
                  {canManage && record && deleted && (
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

              {record && deleteFor === record.id && (
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
