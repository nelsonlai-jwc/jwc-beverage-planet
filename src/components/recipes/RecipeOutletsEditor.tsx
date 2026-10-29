"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setRecipeOutlets } from "@/app/[locale]/(app)/recipes/actions";
import { useRouter } from "@/i18n/navigation";
import type { Outlet } from "@/lib/recipes/types";
import { OutletChecklist } from "./OutletChecklist";
import { alertClass, card, primaryButton, secondaryButton } from "./ui";

/** Admin only: change which outlets a recipe is made for. Applies at once. */
export function RecipeOutletsEditor({
  recipeId,
  outlets,
  label,
  initialOutletIds,
  initialAllOutlets,
}: {
  recipeId: string;
  outlets: Outlet[];
  label: string;
  initialOutletIds: string[];
  initialAllOutlets: boolean;
}) {
  const t = useTranslations("Recipes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outletIds, setOutletIds] = useState(initialOutletIds);
  const [allOutlets, setAllOutlets] = useState(initialAllOutlets);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!allOutlets && !outletIds.length) {
      setError(t("errors.OUTLET_REQUIRED"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setRecipeOutlets(recipeId, outletIds, allOutlets);
      if (!result.ok) {
        setError(
          t.has(`actionErrors.${result.error}`)
            ? t(`actionErrors.${result.error}`)
            : `${t("actionErrors.UNKNOWN")} ${result.message ?? ""}`,
        );
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <section className={card}>
      <h2 className="text-base font-semibold">{t("fields.outlets")}</h2>
      {!open ? (
        <>
          <p className="text-sm">{label}</p>
          <button type="button" onClick={() => setOpen(true)} className={`${secondaryButton} self-start`}>
            {t("outletsEdit.open")}
          </button>
        </>
      ) : (
        <>
          <OutletChecklist
            outlets={outlets}
            allowAll
            outletIds={outletIds}
            allOutlets={allOutlets}
            onChange={(ids, all) => {
              setOutletIds(ids);
              setAllOutlets(all);
            }}
          />
          <p className="text-[13px] text-[#3d3f3a]">{t("outletsEdit.note")}</p>
          {error && (
            <p role="alert" className={alertClass}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={pending} className={primaryButton}>
              {t("outletsEdit.save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setOutletIds(initialOutletIds);
                setAllOutlets(initialAllOutlets);
                setError(null);
              }}
              className={secondaryButton}
            >
              {t("cancel")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
