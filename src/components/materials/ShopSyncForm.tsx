"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { runShopSync, type SyncSummary } from "@/app/[locale]/(app)/raw-materials/shop-sync/actions";
import { useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/lib/materials/decimal";
import { SHOP_SIZES, sizeLabel, type SyncPlan, type SyncRow } from "@/lib/materials/shopBeans";
import { cardClass, errorClass, primaryButtonClass, secondaryButtonClass } from "./ui";

/** Size ticks, a tick per bean to add, what changes availability, then one button to run it. */
export function ShopSyncForm({ plan }: { plan: SyncPlan }) {
  const t = useTranslations("RawMaterials.shopSync");
  const router = useRouter();
  const newRows = plan.rows.filter((r) => !r.materialId);
  // Beans ticked to add; all of them to start with, sold-out ones too.
  const [picked, setPicked] = useState<Set<number>>(() => new Set(newRows.map((r) => r.variantId)));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SyncSummary | null>(null);
  const [pending, startTransition] = useTransition();

  const toAdd = newRows.filter((r) => picked.has(r.variantId));
  const changes = plan.rows.filter((r) => r.change);
  const existing = plan.rows.filter((r) => r.materialId && !r.change);
  const nothing = toAdd.length === 0 && changes.length === 0 && plan.gone.length === 0 && !plan.rows.some((r) => r.link);

  const ofSize = (size: number) => newRows.filter((r) => r.grams === size);
  // A size is ticked while every bean of that size is ticked; clicking it ticks or unticks them all.
  const sizeOn = (size: number) => ofSize(size).every((r) => picked.has(r.variantId));
  function setRows(rows: SyncRow[], on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      for (const r of rows) {
        if (on) next.add(r.variantId);
        else next.delete(r.variantId);
      }
      return next;
    });
  }

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await runShopSync(toAdd.map((r) => r.variantId));
      if (!result.ok) {
        setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t("errors.UNKNOWN"));
        return;
      }
      setDone(result.summary);
      router.refresh();
    });
  }

  const price = (row: SyncRow) => t("price", { price: formatMoney(row.price), shop: formatMoney(row.shopPrice) });

  return (
    <div className="flex flex-col gap-6">
      {done && (
        <section role="status" className={`${cardClass} border-[1.5px] border-brand-green`}>
          <p className="text-sm font-semibold">{t("doneTitle")}</p>
          <p className="text-sm">{t("doneSummary", done)}</p>
        </section>
      )}

      <section className={cardClass} aria-labelledby="shop-sizes">
        <h2 id="shop-sizes" className="text-base font-semibold">
          {t("sizesTitle")}
        </h2>
        <p className="text-sm text-[#3d3f3a]">{t("sizesHint")}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {SHOP_SIZES.map((size) => (
            <label key={size} className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={sizeOn(size)}
                disabled={ofSize(size).length === 0}
                onChange={() => setRows(ofSize(size), !sizeOn(size))}
                className="size-5 accent-black"
              />
              {sizeLabel(size)}
            </label>
          ))}
        </div>
      </section>

      <section className={cardClass} aria-labelledby="shop-new">
        <h2 id="shop-new" className="text-base font-semibold">
          {t("newTitle", { count: toAdd.length, total: newRows.length })}
        </h2>
        {newRows.length === 0 ? (
          <p className="text-sm text-[#3d3f3a]">{t("newEmpty")}</p>
        ) : (
          <>
            <p className="text-sm text-[#3d3f3a]">{t("newHint")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setRows(newRows, true)} className={secondaryButtonClass}>
                {t("selectAll")}
              </button>
              <button type="button" onClick={() => setRows(newRows, false)} className={secondaryButtonClass}>
                {t("selectNone")}
              </button>
            </div>
            <ul className="flex flex-col divide-y divide-black/10">
              {newRows.map((row) => (
                <li key={row.variantId}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm sm:items-center">
                    <input
                      type="checkbox"
                      checked={picked.has(row.variantId)}
                      onChange={(event) => setRows([row], event.target.checked)}
                      className="mt-0.5 size-5 shrink-0 accent-black sm:mt-0"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                      <span className={`min-w-0 flex-1 font-semibold break-words ${picked.has(row.variantId) ? "" : "text-[#6b6d67]"}`}>
                        {row.name}
                      </span>
                      {!row.available && <UnavailableTag label={t("soldOut")} />}
                      <span className="shrink-0 tabular-nums text-[#3d3f3a]">{price(row)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={cardClass} aria-labelledby="shop-changes">
        <h2 id="shop-changes" className="text-base font-semibold">
          {t("changesTitle", { count: changes.length + plan.gone.length })}
        </h2>
        {changes.length + plan.gone.length === 0 ? (
          <p className="text-sm text-[#3d3f3a]">{t("changesEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/10">
            {changes.map((row) => (
              <li key={row.variantId} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-4">
                <span className="min-w-0 flex-1 font-semibold break-words">{row.materialName}</span>
                <span className="shrink-0">{row.change === "unavailable" ? t("toUnavailable") : t("toAvailable")}</span>
              </li>
            ))}
            {plan.gone.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-4">
                <span className="min-w-0 flex-1 font-semibold break-words">{item.name}</span>
                <span className="shrink-0">{t("goneFromShop")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className={cardClass}>
        <summary className="cursor-pointer text-base font-semibold">{t("existingTitle", { count: existing.length })}</summary>
        <p className="text-sm text-[#3d3f3a]">{t("existingHint")}</p>
        <ul className="flex flex-col divide-y divide-black/10">
          {existing.map((row) => (
            <li key={row.variantId} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-4">
              <span className="min-w-0 flex-1 break-words">{row.materialName}</span>
              {!row.available && <UnavailableTag label={t("soldOut")} />}
            </li>
          ))}
        </ul>
      </details>

      <section className={cardClass}>
        {error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}
        <button type="button" disabled={pending || nothing} onClick={run} className={`${primaryButtonClass} self-start`}>
          {pending ? t("running") : t("run", { count: toAdd.length })}
        </button>
      </section>
    </div>
  );
}

function UnavailableTag({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center self-start rounded-full border-[1.5px] border-black/40 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-[#3d3f3a] sm:self-auto">
      {label}
    </span>
  );
}
