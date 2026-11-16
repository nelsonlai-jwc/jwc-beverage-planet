"use client";

import { useLocale, useTranslations } from "next-intl";
import { aiEstimatePrice, type AiPriceEstimate } from "@/app/[locale]/(app)/menus/ai-price";

export type DrinkCost = { total: number | null; complete: boolean };
// AI estimate state of one drink row.
export type EstimateState = { loading: boolean; failed: boolean; estimate: AiPriceEstimate | null };

// Highest share of the selling price the drink cost may take.
const MAX_COST_RATIO = 0.4;

// Lowest price (rounded up to RM 0.10) at which cost is at most 40% of the price.
export function suggestedPrice(cost: number): number {
  return Math.ceil(Number((cost / MAX_COST_RATIO / 0.1).toFixed(6))) / 10;
}

// Cost, 40% suggested price, cost ratio of the typed price, and the AI estimate below them.
export function PriceHint({
  cost,
  price,
  estimate,
}: {
  cost: DrinkCost | undefined;
  price: string;
  estimate: EstimateState | undefined;
}) {
  const t = useTranslations("Menus.pricing");

  const total = cost?.complete && cost.total != null ? cost.total : null;
  const priceValue = Number(price);
  const ratio = total != null && price !== "" && priceValue > 0 ? total / priceValue : null;

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
      {estimate?.failed && <p className="text-[#c4161c]">{t("aiFailed")}</p>}
      {estimate?.estimate && !estimate.failed && (
        <p>
          <span className="font-semibold">
            {t("aiRange", { low: estimate.estimate.low.toFixed(2), high: estimate.estimate.high.toFixed(2) })}
          </span>{" "}
          <span className="text-black/60">
            {estimate.estimate.note} {t("aiDisclaimer")}
          </span>
        </p>
      )}
    </div>
  );
}

// Button that asks AI for a price range; the result is shown by PriceHint.
export function EstimateButton({
  recipeId,
  name,
  state,
  onChange,
  className,
}: {
  recipeId: string;
  name: string;
  state: EstimateState | undefined;
  onChange: (state: EstimateState) => void;
  className: string;
}) {
  const t = useTranslations("Menus.pricing");
  const locale = useLocale();

  async function run() {
    onChange({ loading: true, failed: false, estimate: state?.estimate ?? null });
    const result = await aiEstimatePrice(recipeId, locale);
    onChange(
      result.ok
        ? { loading: false, failed: false, estimate: result.estimate }
        : { loading: false, failed: true, estimate: null },
    );
  }

  return (
    <button
      type="button"
      disabled={state?.loading}
      onClick={run}
      aria-label={t("aiButtonFor", { name })}
      className={`${className} whitespace-nowrap`}
    >
      {state?.loading ? t("aiRunning") : state?.estimate ? t("aiAgain") : t("aiButton")}
    </button>
  );
}
