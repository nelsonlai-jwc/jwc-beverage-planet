"use client";

import { useFormatter, useTranslations } from "next-intl";
import { smallButton } from "@/components/recipes/ui";
import { mutedText } from "@/components/ui/styles";
import { brewRatio, extractionYield } from "@/lib/calibration/calc";
import { equipmentName, type CalibrationShot } from "./types";

/** Test shots of one bean for the day, oldest first. */
export function ShotList({
  shots,
  grinderNames,
  onUse,
}: {
  shots: CalibrationShot[];
  grinderNames: Map<string, string>;
  /** When given, each shot can fill the open form. */
  onUse?: (shot: CalibrationShot) => void;
}) {
  const t = useTranslations("Calibration");
  const format = useFormatter();
  return (
    <details className="rounded-[12px] border border-black/15 p-2.5" open={!!onUse}>
      <summary className="cursor-pointer text-sm font-semibold">{t("testShots", { count: shots.length })}</summary>
      <ol className="mt-2 flex flex-col gap-2">
        {shots.map((shot, index) => {
          const ey = extractionYield(shot.dose_g, shot.yield_g, shot.tds_percent);
          const parts = [
            `${shot.dose_g} g → ${shot.yield_g} g (${brewRatio(shot.dose_g, shot.yield_g)})`,
            `${shot.extraction_time_seconds} s`,
            `${t("grind")} ${shot.grind_setting}`,
            shot.grinder_rpm != null ? `${shot.grinder_rpm} RPM` : null,
            shot.water_temp_c != null ? `${shot.water_temp_c} °C` : null,
            shot.pressure_bar != null ? `${shot.pressure_bar} bar` : null,
            shot.preinfusion_seconds != null ? t("preinfusionShort", { value: shot.preinfusion_seconds }) : null,
            shot.basket_g != null ? t("basketShort", { value: shot.basket_g }) : null,
            shot.tds_percent != null ? `TDS ${shot.tds_percent}%` : null,
            ey != null ? `EY ${ey}%` : null,
            shot.taste_balance ? t(`balance.${shot.taste_balance}`) : null,
          ].filter(Boolean);
          return (
            <li key={shot.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-black/10 pt-2 first:border-t-0 first:pt-0">
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="font-semibold">
                  #{index + 1} · {format.dateTime(new Date(shot.created_at), { timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" })} ·{" "}
                  {equipmentName(shot.grinder_id, shot.grinder_name, grinderNames)}
                </span>
                <span>{parts.join(" · ")}</span>
                {shot.taste_notes && <span className={mutedText}>{shot.taste_notes}</span>}
              </div>
              {onUse && (
                <button type="button" className={smallButton} onClick={() => onUse(shot)}>
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
