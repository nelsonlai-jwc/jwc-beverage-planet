"use client";

import { useTranslations } from "next-intl";
import { inputClass, labelClass } from "@/components/ui/styles";

/** The select value that means "type a name instead". */
export const OTHER = "__other";

/**
 * Pick a grinder, machine or brewer from Settings. With allowOther (custom records)
 * the last option lets the user type a name instead.
 */
export function EquipmentSelect({
  id,
  label,
  options,
  value,
  typed,
  onChange,
  allowOther,
  allowNone,
  disabled,
}: {
  id: string;
  label: string;
  options: { id: string; name: string }[];
  /** Selected id, "" for none, or OTHER. */
  value: string;
  typed: string;
  onChange: (value: string, typed: string) => void;
  allowOther?: boolean;
  allowNone?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("Calibration");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value, typed)} className={inputClass}>
        {(allowNone || (allowOther && options.length === 0 && value === "")) && <option value="">—</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {allowOther && <option value={OTHER}>{t("otherEquipment")}</option>}
      </select>
      {value === OTHER && (
        <input
          aria-label={`${label} · ${t("equipmentNameLabel")}`}
          placeholder={t("equipmentNameLabel")}
          maxLength={60}
          disabled={disabled}
          value={typed}
          onChange={(e) => onChange(value, e.target.value)}
          className={inputClass}
        />
      )}
    </div>
  );
}

/** Turn a select value and typed text into the record's id and name columns. */
export function equipmentColumns(value: string, typed: string): { id: string | null; name: string | null } {
  if (value === OTHER) return { id: null, name: typed.trim() || null };
  return { id: value || null, name: null };
}
