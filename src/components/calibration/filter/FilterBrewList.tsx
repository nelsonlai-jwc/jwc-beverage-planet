"use client";

import { useFormatter, useTranslations } from "next-intl";
import { smallButton } from "@/components/recipes/ui";
import { mutedText } from "@/components/ui/styles";
import { filterExtractionYield, minutes, waterRatio } from "@/lib/calibration/filterCalc";
import type { FilterBrew } from "./types";

/** Test brews of one bean for the day, oldest first. */
export function FilterBrewList({
  brews,
  brewerNames,
  onUse,
}: {
  brews: FilterBrew[];
  brewerNames: Map<string, string>;
  onUse?: (brew: FilterBrew) => void;
}) {
  const t = useTranslations("Calibration");
  const tf = useTranslations("FilterCalibration");
  const format = useFormatter();
  return (
    <details className="rounded-[12px] border border-black/15 p-2.5" open={!!onUse}>
      <summary className="cursor-pointer text-sm font-semibold">{tf("testBrews", { count: brews.length })}</summary>
      <ol className="mt-2 flex flex-col gap-2">
        {brews.map((brew, index) => {
          const ey = filterExtractionYield(brew.dose_g, brew.beverage_g, brew.tds_percent);
          const parts = [
            `${brew.dose_g} g : ${brew.water_g} g (1:${waterRatio(brew.dose_g, brew.water_g)})`,
            `${t("grind")} ${brew.grind_setting}`,
            minutes(brew.total_time_seconds),
            brew.water_temp_c != null ? `${brew.water_temp_c} °C` : null,
            brew.bloom_water_g != null || brew.bloom_seconds != null
              ? tf("bloomShort", { water: brew.bloom_water_g ?? "—", seconds: brew.bloom_seconds ?? "—" })
              : null,
            brew.pour_count != null ? tf("poursShort", { count: brew.pour_count }) : null,
            brew.tds_percent != null ? `TDS ${brew.tds_percent}%` : null,
            ey != null ? `EY ${ey}%` : null,
            brew.taste_balance ? t(`balance.${brew.taste_balance}`) : null,
          ].filter(Boolean);
          return (
            <li key={brew.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-black/10 pt-2 first:border-t-0 first:pt-0">
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="font-semibold">
                  #{index + 1} · {format.dateTime(new Date(brew.created_at), { timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" })} ·{" "}
                  {brewerNames.get(brew.brewer_id) ?? "—"}
                </span>
                <span>{parts.join(" · ")}</span>
                {brew.taste_notes && <span className={mutedText}>{brew.taste_notes}</span>}
              </div>
              {onUse && (
                <button type="button" className={smallButton} onClick={() => onUse(brew)}>
                  {t("useShot")}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
