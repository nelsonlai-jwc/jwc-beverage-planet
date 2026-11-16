"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { aiEstimatePrice, type AiPriceEstimate } from "@/app/[locale]/(app)/menus/ai-price";
import { smallButton } from "@/components/ui/styles";

export type DrinkCost = { total: number | null; complete: boolean };

// Highest share of the selling price the drink cost may take.
const MAX_COST_RATIO = 0.4;

// Lowest price (rounded up to RM 0.10) at which cost is at most 40% of the price.
export function suggestedPrice(cost: number): number {
  return Math.ceil(Number((cost / MAX_COST_RATIO / 0.1).toFixed(6))) / 10;
}

// Cost, 40% suggested price, cost ratio of the typed price, and an AI price estimate.
export function PriceHint({
  recipeId,
  name,
  cost,
  price,
}: {
  recipeId: string;
  name: string;
  cost: DrinkCost | undefined;
  price: string;
}) {
  const t = useTranslations("Menus.pricing");
  const locale = useLocale();
  const [estimate, setEstimate] = useState<AiPriceEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const total = cost?.complete && cost.total != null ? cost.total : null;
  const priceValue = Number(price);
  const ratio = total != null && price !== "" && priceValue > 0 ? total / priceValue : null;

  async function runEstimate() {
    setLoading(true);
    setFailed(false);
    const result = await aiEstimatePrice(recipeId, locale);
    setLoading(false);
    if (result.ok) setEstimate(result.estimate);
    else setFailed(true);
  }

  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <p className="flex flex-wrap gap-x-3 gap-y-0.5">
        {total != null ? (
          <>
            <span>{t("cost", { cost: total.toFixed(2) })}</span>
            <span className="font-semibold">{t("suggested", { price: suggestedPrice(total).toFixed(2) })}</span>
            {ratio != null && (
              <span className={ratio > MAX_COST_RATIO ? "font-semibold text-[#c4161c]" : ""}>
                {t(ratio > MAX_COST_RATIO ? "ratioOver" : "ratio", { ratio: (ratio * 100).toFixed(1) })}
              </span>
            )}
          </>
        ) : (
          <span className="text-[#c4161c]">{cost ? t("costIncomplete") : t("costUnavailable")}</span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={runEstimate}
          aria-label={t("aiButtonFor", { name })}
          className={`${smallButton} whitespace-nowrap`}
        >
          {loading ? t("aiRunning") : estimate ? t("aiAgain") : t("aiButton")}
        </button>
        {failed && <span className="text-[#c4161c]">{t("aiFailed")}</span>}
        {estimate && !failed && (
          <span>
            <span className="font-semibold">
              {t("aiRange", { low: estimate.low.toFixed(2), high: estimate.high.toFixed(2) })}
            </span>{" "}
            <span className="text-black/60">
              {estimate.note} {t("aiDisclaimer")}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
