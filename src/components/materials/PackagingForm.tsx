"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { savePackaging, type PackagingInput } from "@/app/[locale]/(app)/raw-materials/actions";
import { useRouter } from "@/i18n/navigation";
import { isDecimal, isPositiveDecimal } from "@/lib/materials/decimal";
import {
  cardClass,
  errorClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

export type PackagingFormValues = Omit<PackagingInput, "submit">;

/** Packaging is priced per piece (O08); recipes enter a number of pieces. */
export function PackagingForm({ initial }: { initial?: PackagingFormValues }) {
  const t = useTranslations("RawMaterials");
  const router = useRouter();
  const [values, setValues] = useState<PackagingFormValues>(
    initial ?? { name: "", brand: "", description: "", price: "", freeReason: "" },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isFree = isDecimal(values.price) && !isPositiveDecimal(values.price);

  function set<K extends keyof PackagingFormValues>(key: K, value: PackagingFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function save(submit: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await savePackaging({ ...values, submit });
      if (!result.ok) {
        setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t("errors.UNKNOWN"));
        return;
      }
      router.push(`/raw-materials/packaging/${result.id}`);
      router.refresh();
    });
  }

  return (
    <form
      className={`${cardClass} max-w-xl`}
      onSubmit={(event) => {
        event.preventDefault();
        save(true);
      }}
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className={labelClass}>
          {t("form.name")}
        </label>
        <input
          id="name"
          value={values.name}
          maxLength={120}
          onChange={(event) => set("name", event.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="brand" className={labelClass}>
          {t("packaging.brandOptional")}
        </label>
        <input
          id="brand"
          value={values.brand}
          onChange={(event) => set("brand", event.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="price" className={labelClass}>
          {t("packaging.pricePerPiece")}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">RM</span>
          <input
            id="price"
            inputMode="decimal"
            value={values.price}
            onChange={(event) => set("price", event.target.value.replace(",", "."))}
            className={inputClass}
          />
        </div>
        <p className="text-[13px] text-[#3d3f3a]">{t("form.priceHint")}</p>
      </div>
      {isFree && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="freeReason" className={labelClass}>
            {t("form.freeReason")}
          </label>
          <input
            id="freeReason"
            value={values.freeReason}
            onChange={(event) => set("freeReason", event.target.value)}
            className={inputClass}
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className={labelClass}>
          {t("form.description")}
        </label>
        <textarea
          id="description"
          rows={3}
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
          className="w-full rounded-[10px] border-[1.5px] border-black bg-white px-3.5 py-3 text-base"
        />
      </div>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending} onClick={() => save(false)} className={secondaryButtonClass}>
          {t("form.saveDraft")}
        </button>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? t("form.saving") : t("form.submit")}
        </button>
      </div>
    </form>
  );
}
