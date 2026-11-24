"use client";

import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  useOutletPrefix,
  useSubjectBadge,
  useSubjectLabel,
  type SurveyInfo,
} from "@/components/surveys/SurveyForm";
import {
  cardClass,
  mutedText,
  primaryButton,
  smallButton,
} from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";

export type SurveyRow = {
  id: string;
  token: string;
  info: SurveyInfo;
  answers: number;
};

/** Small labels of a survey: what it rates, who answers, which drinks. */
function Badges({ info }: { info: SurveyInfo }) {
  const t = useTranslations("Tasting");
  const s = useTranslations("Surveys");
  const badge = useSubjectBadge();
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
      <span className="rounded-full bg-[#eceee8] px-2.5 py-0.5">
        {badge(info)}
      </span>
      <span className="rounded-full bg-[#eceee8] px-2.5 py-0.5">
        {s(`audience.${info.audience}`)}
      </span>
      {info.subject_type === "ESPRESSO" && (
        <span className={mutedText}>
          {info.drinks.map((d) => t(`drink.${d}`)).join(" · ")}
        </span>
      )}
    </div>
  );
}

export function SurveyList({
  pending,
  run,
  canCreate,
}: {
  pending: SurveyRow[];
  run: SurveyRow[];
  canCreate: boolean;
}) {
  const t = useTranslations("Surveys");
  const format = useFormatter();
  const subject = useSubjectLabel();
  const outletPrefix = useOutletPrefix();
  const time = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuala_Lumpur",
    });

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {t("pendingTitle", { count: pending.length })}
        </h2>
        {pending.length === 0 ? (
          <p className={`${cardClass} text-sm`}>{t("noPending")}</p>
        ) : (
          pending.map((r) => (
            <div
              key={r.id}
              className={`${cardClass} flex flex-wrap items-center justify-between gap-3`}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <Badges info={r.info} />
                <span className="text-base font-semibold">
                  {subject(r.info)}
                </span>
                <span className={mutedText}>
                  {outletPrefix(r.info)}
                  {t("closesAt", { time: time(r.info.closes_at) })}
                </span>
              </div>
              <Link href={`/surveys/fill/${r.token}`} className={primaryButton}>
                {t("answer")}
              </Link>
            </div>
          ))
        )}
      </section>

      {canCreate && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("runTitle")}</h2>
            <Link href="/surveys/new" className={primaryButton}>
              <Plus size={16} aria-hidden />
              {t("newSurvey")}
            </Link>
          </div>
          {run.length === 0 ? (
            <p className={`${cardClass} text-sm`}>{t("noRun")}</p>
          ) : (
            run.map((r) => (
              <div
                key={r.id}
                className={`${cardClass} flex flex-wrap items-center justify-between gap-3`}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Badges info={r.info} />
                  <span className="text-base font-semibold">
                    {subject(r.info)}
                  </span>
                  <span className={mutedText}>
                    {outletPrefix(r.info)}
                    {r.info.date} ·{" "}
                    {r.info.open
                      ? t("openUntil", { time: time(r.info.closes_at) })
                      : t("closed")}{" "}
                    · {t("answers", { count: r.answers })}
                  </span>
                </div>
                <Link href={`/surveys/${r.id}`} className={smallButton}>
                  {t("results")}
                </Link>
              </div>
            ))
          )}
        </section>
      )}
    </>
  );
}
