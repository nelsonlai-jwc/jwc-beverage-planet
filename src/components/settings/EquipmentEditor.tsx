"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  saveEquipment,
  setEquipmentActive,
  type EquipmentInput,
  type EquipmentKind,
} from "@/app/[locale]/(app)/settings/equipment-actions";
import { alertClass, inputClass, primaryButton, secondaryButton } from "@/components/recipes/ui";
import { useRouter } from "@/i18n/navigation";
import { Chevron } from "./SettingsEditors";

export type EquipmentItem = {
  id: string;
  outletId: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  notes: string | null;
  active: boolean;
  burrType?: string | null;
  burrSizeMm?: number | null;
  scaleType?: string | null;
  scaleMin?: number | null;
  scaleMax?: number | null;
  groupCount?: number | null;
  defaultWaterTempC?: number | null;
  defaultPressureBar?: number | null;
};

type OutletOption = { id: string; name: string };

const s = (value: string | number | null | undefined) => (value == null ? "" : String(value));

function toInput(item: EquipmentItem | null, outlets: OutletOption[]): EquipmentInput {
  return {
    outletId: item?.outletId ?? outlets[0]?.id ?? "",
    name: s(item?.name),
    brand: s(item?.brand),
    model: s(item?.model),
    serialNumber: s(item?.serialNumber),
    notes: s(item?.notes),
    burrType: s(item?.burrType),
    burrSizeMm: s(item?.burrSizeMm),
    scaleType: item?.scaleType ?? "STEPPED",
    scaleMin: s(item?.scaleMin),
    scaleMax: s(item?.scaleMax),
    groupCount: s(item?.groupCount),
    defaultWaterTempC: s(item?.defaultWaterTempC),
    defaultPressureBar: s(item?.defaultPressureBar),
  };
}

/** One line under the name: brand, model and the main numbers. */
export function equipmentSummary(
  kind: EquipmentKind,
  item: EquipmentItem,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  const parts = [[item.brand, item.model].filter(Boolean).join(" ")];
  if (kind === "GRINDER") {
    if (item.burrType) parts.push(t(`burr.${item.burrType}`) + (item.burrSizeMm ? ` ${item.burrSizeMm} mm` : ""));
    if (item.scaleMin != null && item.scaleMax != null) parts.push(t("scaleShort", { min: item.scaleMin, max: item.scaleMax }));
  } else {
    if (item.groupCount) parts.push(t("groupsShort", { count: item.groupCount }));
    if (item.defaultWaterTempC) parts.push(`${item.defaultWaterTempC} °C`);
    if (item.defaultPressureBar) parts.push(`${item.defaultPressureBar} bar`);
  }
  return parts.filter(Boolean).join(" · ");
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-[13px] font-semibold">{label}</span>
      {children}
    </label>
  );
}

function EquipmentForm({
  kind,
  initial,
  outlets,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  kind: EquipmentKind;
  initial: EquipmentInput;
  outlets: OutletOption[];
  pending: boolean;
  submitLabel: string;
  onSubmit: (input: EquipmentInput) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("Settings.equipment");
  const [form, setForm] = useState(initial);
  const set = (key: keyof EquipmentInput) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });
  const numberProps = { type: "number", inputMode: "decimal" as const, step: "any", className: inputClass };

  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <Field label={t("name")}>
        <input value={form.name} maxLength={60} required onChange={set("name")} placeholder={t(kind === "GRINDER" ? "grinderPlaceholder" : "machinePlaceholder")} className={inputClass} />
      </Field>
      <Field label={t("outlet")}>
        <select value={form.outletId} onChange={set("outletId")} className={inputClass}>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("brand")}>
        <input value={form.brand} maxLength={60} onChange={set("brand")} className={inputClass} />
      </Field>
      <Field label={t("model")}>
        <input value={form.model} maxLength={60} onChange={set("model")} className={inputClass} />
      </Field>
      {kind === "GRINDER" ? (
        <>
          <Field label={t("burrType")}>
            <select value={form.burrType} onChange={set("burrType")} className={inputClass}>
              <option value="">—</option>
              {(["FLAT", "CONICAL", "OTHER"] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`burr.${v}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("burrSize")}>
            <input {...numberProps} min="1" value={form.burrSizeMm} onChange={set("burrSizeMm")} />
          </Field>
          <Field label={t("scaleType")}>
            <select value={form.scaleType} onChange={set("scaleType")} className={inputClass}>
              <option value="STEPPED">{t("scale.STEPPED")}</option>
              <option value="STEPLESS">{t("scale.STEPLESS")}</option>
            </select>
          </Field>
          <Field label={t("scaleRange")}>
            <span className="flex items-center gap-2">
              <input {...numberProps} aria-label={t("scaleMin")} placeholder={t("scaleMin")} value={form.scaleMin} onChange={set("scaleMin")} />
              <span aria-hidden>–</span>
              <input {...numberProps} aria-label={t("scaleMax")} placeholder={t("scaleMax")} value={form.scaleMax} onChange={set("scaleMax")} />
            </span>
          </Field>
        </>
      ) : (
        <>
          <Field label={t("groupCount")}>
            <input {...numberProps} step="1" min="1" max="6" value={form.groupCount} onChange={set("groupCount")} />
          </Field>
          <Field label={t("defaultTemp")}>
            <input {...numberProps} min="80" max="100" value={form.defaultWaterTempC} onChange={set("defaultWaterTempC")} />
          </Field>
          <Field label={t("defaultPressure")}>
            <input {...numberProps} min="0.1" max="20" value={form.defaultPressureBar} onChange={set("defaultPressureBar")} />
          </Field>
        </>
      )}
      <Field label={t("serial")}>
        <input value={form.serialNumber} maxLength={80} onChange={set("serialNumber")} className={inputClass} />
      </Field>
      <Field label={t("notes")} wide>
        <input value={form.notes} maxLength={500} onChange={set("notes")} className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className={primaryButton} disabled={pending || !form.name.trim()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={secondaryButton} onClick={onCancel}>
            {t("cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

/** Settings card body: the Super Admin lists, adds, edits and disables grinders or machines. */
export function EquipmentEditor({
  kind,
  items,
  outlets,
}: {
  kind: EquipmentKind;
  items: EquipmentItem[];
  outlets: OutletOption[];
}) {
  const t = useTranslations("Settings.equipment");
  const tEdit = useTranslations("Settings.edit");
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));

  function run(action: () => ReturnType<typeof saveEquipment>, done: () => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : tEdit.has(`errors.${result.error}`) ? tEdit(`errors.${result.error}`) : tEdit("errors.UNKNOWN"));
        return;
      }
      done();
      router.refresh();
    });
  }

  // Grouped by outlet, in outlet order.
  const sorted = [...items].sort(
    (a, b) =>
      outlets.findIndex((o) => o.id === a.outletId) - outlets.findIndex((o) => o.id === b.outletId) ||
      a.name.localeCompare(b.name),
  );

  return (
    <div className="flex flex-col gap-3">
      {sorted.length === 0 && <p className="text-sm text-[#3d3f3a]">{t(kind === "GRINDER" ? "noGrinders" : "noMachines")}</p>}
      <ul className="flex flex-col gap-2">
        {sorted.map((item) => {
          const open = openId === item.id;
          return (
            <li key={item.id} className="flex flex-col gap-2 rounded-[12px] border border-black/15 p-2.5">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : item.id)}
                className="flex min-w-0 items-center justify-between gap-2 py-1 text-left"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`font-semibold ${item.active ? "" : "text-[#3d3f3a]"}`}>{item.name}</span>
                    <span className="rounded-full border border-black/40 px-2 py-0.5 text-xs">{outletName.get(item.outletId) ?? "—"}</span>
                    {!item.active && (
                      <span className="rounded-full bg-[#eceee8] px-2.5 py-0.5 text-xs font-semibold">{tEdit("disabled")}</span>
                    )}
                  </span>
                  <span className="text-[13px] text-[#3d3f3a]">{equipmentSummary(kind, item, t)}</span>
                </span>
                <Chevron className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <>
                  <EquipmentForm
                    kind={kind}
                    initial={toInput(item, outlets)}
                    outlets={outlets}
                    pending={pending}
                    submitLabel={tEdit("save")}
                    onSubmit={(input) => run(() => saveEquipment(kind, item.id, input), () => setNotice(tEdit("saved")))}
                  />
                  <button
                    type="button"
                    className={`${secondaryButton} self-start`}
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => setEquipmentActive(kind, item.id, !item.active),
                        () => setNotice(item.active ? t("disabledNotice") : tEdit("enabled")),
                      )
                    }
                  >
                    {item.active ? t("disable") : tEdit("enable")}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="border-t border-black/10 pt-3">
        {adding ? (
          <EquipmentForm
            kind={kind}
            initial={toInput(null, outlets)}
            outlets={outlets}
            pending={pending}
            submitLabel={tEdit("add")}
            onCancel={() => setAdding(false)}
            onSubmit={(input) =>
              run(
                () => saveEquipment(kind, null, input),
                () => {
                  setAdding(false);
                  setNotice(tEdit("added"));
                },
              )
            }
          />
        ) : (
          <button type="button" className={secondaryButton} onClick={() => setAdding(true)}>
            {t(kind === "GRINDER" ? "addGrinder" : "addMachine")}
          </button>
        )}
      </div>
      <p className="text-[13px] text-[#3d3f3a]">{t("hint")}</p>
      {notice && (
        <p role="status" className="text-sm font-semibold">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
    </div>
  );
}
