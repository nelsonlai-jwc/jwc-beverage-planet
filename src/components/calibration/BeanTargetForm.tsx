"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { errorText, inputClass, primaryButton, secondaryButton } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import type { BeanTarget } from "./types";

const KEYS = [
  ["dose_min_g", "dose_max_g", "doseG"],
  ["yield_min_g", "yield_max_g", "yieldG"],
  ["time_min_seconds", "time_max_seconds", "timeS"],
] as const;

type TargetKey = (typeof KEYS)[number][0] | (typeof KEYS)[number][1];

/** Manager or Admin sets the target ranges of one coffee bean (all outlets). */
export function BeanTargetForm({
  beanId,
  target,
  onClose,
}: {
  beanId: string;
  target: BeanTarget | undefined;
  onClose: () => void;
}) {
  const t = useTranslations("Calibration");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<TargetKey, string>>(() =>
    Object.fromEntries(
      KEYS.flatMap(([min, max]) => [
        [min, target ? String(target[min]) : ""],
        [max, target ? String(target[max]) : ""],
      ]),
    ) as Record<TargetKey, string>,
  );

  async function save() {
    const values = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])) as Record<TargetKey, number>;
    if (KEYS.some(([min, max]) => !(values[min] > 0 && values[max] >= values[min]))) {
      setError(t("targetInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: saveError } = target
      ? await supabase
          .from("coffee_bean_targets")
          .update(values)
          .eq("material_id", beanId)
          .eq("revision", target.revision)
          .select("material_id")
      : await supabase.from("coffee_bean_targets").insert({ ...values, material_id: beanId }).select("material_id");
    setBusy(false);
    if (saveError || !data?.length) {
      setError(saveError && saveError.code !== "23505" ? t("saveFailed") : t("conflict"));
      router.refresh();
      return;
    }
    toast("saved");
    onClose();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-black/15 p-3">
      <p className="text-sm font-semibold">{t("targetTitle")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {KEYS.map(([min, max, label]) => (
          <div key={min} className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-semibold">{t(label)}</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                aria-label={`${t(label)} ${t("min")}`}
                placeholder={t("min")}
                value={form[min]}
                onChange={(e) => setForm({ ...form, [min]: e.target.value })}
                className={inputClass}
              />
              <span aria-hidden>–</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                aria-label={`${t(label)} ${t("max")}`}
                placeholder={t("max")}
                value={form[max]}
                onChange={(e) => setForm({ ...form, [max]: e.target.value })}
                className={inputClass}
              />
            </span>
          </div>
        ))}
      </div>
      <p className="text-[13px] text-[#3d3f3a]">{t("targetHint")}</p>
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={save} className={primaryButton}>
          {busy ? t("saving") : t("save")}
        </button>
        <button type="button" onClick={onClose} className={secondaryButton}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
