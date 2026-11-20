"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { cardClass, mutedText } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { BeanPicker } from "./BeanPicker";
import { CalibrationForm } from "./CalibrationForm";
import type { FinalKind } from "./FinalParts";
import { FilterForm } from "./filter/FilterForm";
import type { Brewer, FilterBrew, FilterRecord, FilterTarget } from "./filter/types";
import type { Bean, BeanTarget, CalibrationRecord, CalibrationShot, Grinder, Machine, Purpose } from "./types";

/** One kind of equipment, as each purpose may use it. */
type ByPurpose<T> = Record<Purpose, T[]>;

/**
 * New calibration, one step at a time: Daily or Custom, Espresso or Filter, the coffee bean,
 * then test shots and the Final.
 */
export function NewCalibration({
  outletId,
  outletName,
  date,
  dailyAllowed,
  canManage,
  espressoBeans,
  filterBeans,
  recent,
  grinders,
  machines,
  brewers,
  espressoTargets,
  filterTargets,
  previousEspresso,
  previousFilter,
  shots,
  brews,
  grinderNames,
  brewerNames,
}: {
  outletId: string | null;
  outletName: string | null;
  date: string;
  /** Daily needs an outlet and a date inside the change window. */
  dailyAllowed: boolean;
  canManage: boolean;
  espressoBeans: Bean[];
  filterBeans: Bean[];
  /** Beans recently calibrated, per purpose. */
  recent: ByPurpose<string>;
  grinders: ByPurpose<Grinder>;
  machines: ByPurpose<Machine>;
  brewers: ByPurpose<Brewer>;
  espressoTargets: BeanTarget[];
  filterTargets: FilterTarget[];
  previousEspresso: ByPurpose<CalibrationRecord>;
  previousFilter: ByPurpose<FilterRecord>;
  shots: ByPurpose<CalibrationShot>;
  brews: ByPurpose<FilterBrew>;
  grinderNames: Map<string, string>;
  brewerNames: Map<string, string>;
}) {
  const t = useTranslations("Calibration");
  const tf = useTranslations("FilterCalibration");
  const router = useRouter();
  const [purpose, setPurpose] = useState<Purpose | null>(dailyAllowed ? null : "CUSTOM");
  const [kind, setKind] = useState<FinalKind | null>(null);
  const [beanId, setBeanId] = useState<string | null>(null);

  const back = () => {
    const params = new URLSearchParams({ date });
    if (outletId) params.set("outlet", outletId);
    router.push(`/calibration?${params}`);
  };

  const beans = kind === "FILTER" ? filterBeans : espressoBeans;
  const bean = beans.find((b) => b.id === beanId);

  const choice = <T extends string>(value: T | null, options: { key: T; label: string; note?: string; disabled?: boolean }[], onPick: (key: T) => void) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={o.disabled}
          aria-pressed={value === o.key}
          onClick={() => onPick(o.key)}
          className={`flex flex-col items-start gap-0.5 rounded-[14px] border-[1.5px] px-4 py-3 text-left disabled:opacity-40 ${
            value === o.key ? "border-black bg-black text-white" : "border-black/40 bg-white hover:border-black"
          }`}
        >
          <span className="font-semibold">{o.label}</span>
          {o.note && <span className={`text-[13px] ${value === o.key ? "text-white/80" : "text-[#3d3f3a]"}`}>{o.note}</span>}
        </button>
      ))}
    </div>
  );

  /** A step already answered: its answer and a way to change it. */
  const done = (n: number, title: string, answer: string, reset: () => void) => (
    <div className={`${cardClass} flex items-center justify-between gap-3`}>
      <p className="min-w-0 text-sm">
        <span className={mutedText}>
          {n}. {title}:{" "}
        </span>
        <span className="font-semibold">{answer}</span>
      </p>
      <button type="button" className="shrink-0 text-[13px] underline" onClick={reset}>
        {t("change")}
      </button>
    </div>
  );

  const step = (n: number, title: string, body: React.ReactNode) => (
    <section className={`${cardClass} flex flex-col gap-3`}>
      <h2 className="text-base font-semibold">
        {n}. {title}
      </h2>
      {body}
    </section>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className={mutedText}>
        {outletName ? `${outletName} · ` : ""}
        {date}
      </p>

      {purpose
        ? done(1, t("stepPurpose"), t(`purpose.${purpose}`), () => {
            setPurpose(null);
            setBeanId(null);
          })
        : step(
            1,
            t("stepPurpose"),
            <>
              {choice<Purpose>(
                purpose,
                [
                  { key: "DAILY", label: t("purpose.DAILY"), note: t("purposeNote.DAILY"), disabled: !dailyAllowed },
                  { key: "CUSTOM", label: t("purpose.CUSTOM"), note: t("purposeNote.CUSTOM") },
                ],
                setPurpose,
              )}
              {!dailyAllowed && <p className={mutedText}>{outletId ? t("dailyClosed") : t("noOutlet")}</p>}
            </>,
          )}

      {purpose &&
        (kind
          ? done(2, t("stepKind"), t(`kind.${kind}`), () => {
              setKind(null);
              setBeanId(null);
            })
          : step(2, t("stepKind"), choice<FinalKind>(kind, [{ key: "ESPRESSO", label: t("kind.ESPRESSO") }, { key: "FILTER", label: t("kind.FILTER") }], setKind)))}

      {purpose &&
        kind &&
        (bean
          ? done(3, t("stepBean"), bean.brand ? `${bean.name} · ${bean.brand}` : bean.name, () => setBeanId(null))
          : step(3, t("stepBean"), <BeanPicker beans={beans} recent={recent[purpose].filter((id) => beans.some((b) => b.id === id))} onPick={setBeanId} />))}

      {purpose && kind && bean && (
        <section className={`${cardClass} flex flex-col gap-3`}>
          <h2 className="text-base font-semibold">4. {t("stepDialIn")}</h2>
          {purpose === "DAILY" &&
          (grinders.DAILY.every((g) => !g.is_active) || (kind === "FILTER" && brewers.DAILY.every((b) => !b.is_active))) ? (
            <p className="text-sm font-semibold">{kind === "FILTER" ? tf("noEquipment") : t("noGrinders")}</p>
          ) : kind === "ESPRESSO" ? (
            <CalibrationForm
              key={`${purpose}-${bean.id}`}
              purpose={purpose}
              outletId={purpose === "DAILY" ? outletId : null}
              date={date}
              beanId={bean.id}
              grinders={grinders[purpose].filter((g) => g.is_active)}
              machines={machines[purpose].filter((m) => m.is_active)}
              targets={espressoTargets.filter((x) => x.material_id === bean.id)}
              previous={previousEspresso[purpose].filter((r) => r.coffee_bean_material_id === bean.id)}
              shots={shots[purpose].filter((s) => s.coffee_bean_material_id === bean.id)}
              grinderNames={grinderNames}
              canManage={canManage}
              onDone={back}
            />
          ) : (
            <FilterForm
              key={`${purpose}-${bean.id}`}
              purpose={purpose}
              outletId={purpose === "DAILY" ? outletId : null}
              date={date}
              beanId={bean.id}
              brewers={brewers[purpose].filter((b) => b.is_active)}
              grinders={grinders[purpose].filter((g) => g.is_active)}
              target={filterTargets.find((x) => x.material_id === bean.id)}
              previous={previousFilter[purpose].filter((r) => r.coffee_bean_material_id === bean.id)}
              brews={brews[purpose].filter((b) => b.coffee_bean_material_id === bean.id)}
              brewerNames={brewerNames}
              canManage={canManage}
              onDone={back}
            />
          )}
        </section>
      )}
    </div>
  );
}
