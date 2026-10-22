"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { proposeMaterialPack } from "@/app/[locale]/(app)/raw-materials/actions";
import { useRouter } from "@/i18n/navigation";
import { divide, formatUnitCost } from "@/lib/materials/decimal";
import { errorClass, inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";

/** A different pack size of the same product is a new Pack, not a new material (ch. 19.1). */
export function AddPackForm({ materialId }: { materialId: string }) {
  const t = useTranslations("RawMaterials");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<"g" | "ml">("ml");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [freeReason, setFreeReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const unitCost = divide(price, quantity);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        {t("addPack.open")}
      </button>
    );
  }

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await proposeMaterialPack(materialId, quantity, unit, description, price, freeReason);
      if (!result.ok) {
        setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t("errors.UNKNOWN"));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-brand-base/60 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-pack-qty" className="text-sm font-semibold">
            {t("form.packQuantity")}
          </label>
          <input
            id="new-pack-qty"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value.replace(",", "."))}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-pack-unit" className="text-sm font-semibold">
            {t("form.unit")}
          </label>
          <select
            id="new-pack-unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as "g" | "ml")}
            className={inputClass}
          >
            <option value="ml">ml</option>
            <option value="g">g</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-pack-price" className="text-sm font-semibold">
          {t("form.price")}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">RM</span>
          <input
            id="new-pack-price"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value.replace(",", "."))}
            className={inputClass}
          />
        </div>
      </div>
      {/^0*(\.0*)?$/.test(price) && price !== "" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-pack-free" className="text-sm font-semibold">
            {t("form.freeReason")}
          </label>
          <input
            id="new-pack-free"
            value={freeReason}
            onChange={(event) => setFreeReason(event.target.value)}
            className={inputClass}
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-pack-desc" className="text-sm font-semibold">
          {t("form.packDescription")}
        </label>
        <input
          id="new-pack-desc"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={inputClass}
        />
      </div>
      <p className="text-sm">
        {t("form.unitCostPreview")}:{" "}
        <span className="font-semibold tabular-nums">
          {unitCost === "DIV_ZERO"
            ? t("form.packInvalid")
            : unitCost
              ? `RM${formatUnitCost(unitCost)} / ${unit}`
              : t("form.toBeFilled")}
        </span>
      </p>
      <p className="text-[13px] text-[#3d3f3a]">{t("addPack.note")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={send} className={primaryButtonClass}>
          {t("addPack.submit")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          {t("priceChange.cancel")}
        </button>
      </div>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
