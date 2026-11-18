"use client";

import QRCode from "qrcode";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useSubjectLabel, type SurveyInfo } from "@/components/surveys/SurveyForm";
import { cardClass, errorText, mutedText, secondaryButton, smallButton } from "@/components/ui/styles";
import { toast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { CRITERIA, MILK_AMOUNTS, isMilk, type SurveyDrink } from "@/lib/tasting/scale";

export type SurveyResponse = {
  id: string;
  drink: string;
  scores: Record<string, number>;
  flavor_tags: string[];
  milk_amount: string | null;
  comment: string | null;
  respondent_id: string | null;
  hidden: boolean;
  created_at: string;
};

type Survey = {
  id: string;
  audience: string;
  token: string;
  closes_at: string;
  closed_at: string | null;
  max_responses: number;
};

const avg = (values: number[]) => (values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : "—");

export function SurveyResults({
  survey,
  info,
  responses,
  invitees,
}: {
  survey: Survey;
  info: SurveyInfo;
  responses: SurveyResponse[];
  invitees: { id: string; full_name: string; answered: boolean }[];
}) {
  const t = useTranslations("Surveys");
  const d = useTranslations("Tasting");
  const format = useFormatter();
  const router = useRouter();
  const subject = useSubjectLabel();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const isPublic = survey.audience === "PUBLIC";
  // Shared links open in English; the page has a language switch.
  const url = isPublic && origin ? `${origin}/en/taste/${survey.token}` : null;
  useEffect(() => {
    if (!url) return;
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg);
  }, [url]);

  const time = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });
  const names = new Map(invitees.map((p) => [p.id, p.full_name]));
  const shown = responses.filter((r) => !r.hidden);
  const notFilled = invitees.filter((p) => !p.answered);

  async function save(run: () => PromiseLike<{ error: unknown; data?: unknown[] | null }>) {
    setBusy(true);
    setError(null);
    const { error: saveError, data } = await run();
    setBusy(false);
    if (saveError || (data && !data.length)) setError(t("saveFailed"));
    else toast("saved");
    router.refresh();
  }

  const close = () =>
    save(() =>
      createClient().from("surveys").update({ closed_at: new Date().toISOString() }).eq("id", survey.id).select("id"),
    );
  // Reopened surveys run 24 more hours when their closing time has passed.
  const reopen = () =>
    save(() =>
      createClient()
        .from("surveys")
        .update({
          closed_at: null,
          closes_at:
            new Date(survey.closes_at).getTime() > Date.now()
              ? survey.closes_at
              : new Date(Date.now() + 24 * 3600e3).toISOString(),
        })
        .eq("id", survey.id)
        .select("id"),
    );
  const toggleHidden = (r: SurveyResponse) =>
    save(() => createClient().from("survey_responses").update({ hidden: !r.hidden }).eq("id", r.id).select("id"));

  function downloadQr() {
    if (!svg) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    link.download = `survey-${info.date}.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <div className={`${cardClass} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <span className="rounded-full bg-[#eceee8] px-2.5 py-0.5">{t(`subject.${info.subject_type}`)}</span>
          <span className="rounded-full bg-[#eceee8] px-2.5 py-0.5">{t(`audience.${info.audience}`)}</span>
          <span className={`rounded-full px-2.5 py-0.5 ${info.open ? "bg-brand-green" : "bg-[#eceee8]"}`}>
            {info.open ? t("openUntil", { time: time(info.closes_at) }) : t("closed")}
          </span>
        </div>
        <p className="text-lg font-semibold">{subject(info)}</p>
        <p className={mutedText}>
          {info.outlet ? `${info.outlet} · ` : ""}
          {info.date} · {t("answersOf", { count: responses.length, max: survey.max_responses })}
        </p>
        {info.note && <p className="text-sm">{info.note}</p>}
        <div className="flex flex-wrap gap-2">
          {info.open ? (
            <button type="button" disabled={busy} className={smallButton} onClick={close}>
              {t("closeNow")}
            </button>
          ) : (
            responses.length < survey.max_responses && (
              <button type="button" disabled={busy} className={smallButton} onClick={reopen}>
                {t("reopen")}
              </button>
            )
          )}
          <Link href="/surveys" className={smallButton}>
            {t("back")}
          </Link>
        </div>
        {error && <p className={errorText}>{error}</p>}
      </div>

      {isPublic && info.open && (
        <div className={`${cardClass} flex flex-wrap items-start gap-3`}>
          {svg && (
            <button
              type="button"
              onClick={() => setBig(true)}
              aria-label={t("showQr")}
              className="h-32 w-32 shrink-0 rounded-[8px] border border-black/15 bg-white p-1 [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className={mutedText}>{t("publicHint")}</p>
            <p className="break-all text-[13px]">{url}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={smallButton} onClick={() => setBig(true)}>
                {t("showQr")}
              </button>
              <button type="button" className={smallButton} onClick={downloadQr}>
                {t("downloadQr")}
              </button>
              <button
                type="button"
                className={smallButton}
                onClick={() => url && navigator.clipboard?.writeText(url).then(() => toast("saved"))}
              >
                {t("copyLink")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!isPublic && (
        <div className={`${cardClass} flex flex-col gap-2`}>
          <p className="text-sm font-semibold">
            {t("notFilledTitle", { count: notFilled.length, total: invitees.length })}
          </p>
          {notFilled.length > 0 && <p className="text-sm">{notFilled.map((p) => p.full_name).join(" · ")}</p>}
          {invitees.length > notFilled.length && (
            <p className={mutedText}>
              {t("filled")}: {invitees.filter((p) => p.answered).map((p) => p.full_name).join(" · ")}
            </p>
          )}
        </div>
      )}

      {info.drinks.map((drink: SurveyDrink) => {
        const rows = shown.filter((r) => r.drink === drink);
        const criteria = CRITERIA[drink];
        const counts = new Map<string, number>();
        rows.forEach((r) => r.flavor_tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
        const top = [...counts].sort((a, b) => b[1] - a[1]);
        return (
          <div key={drink} className={`${cardClass} flex flex-col gap-2`}>
            <p className="text-sm font-semibold">
              {d(`drink.${drink}`)} · {t("answers", { count: rows.length })}
            </p>
            {rows.length > 0 && (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
                  {criteria.map((c) => (
                    <div key={c}>
                      <dt className={mutedText}>{d(`criteria.${c}`)}</dt>
                      <dd className="font-semibold">{avg(rows.map((r) => Number(r.scores[c])))}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className={mutedText}>{t("average")}</dt>
                    <dd className="font-semibold">{avg(rows.flatMap((r) => criteria.map((c) => Number(r.scores[c]))))}</dd>
                  </div>
                </dl>
                {isMilk(drink) && (
                  <p className="text-sm">
                    <span className={mutedText}>{d("milkAmount")}: </span>
                    {MILK_AMOUNTS.map((m) => `${d(`milk.${m}`)} ${rows.filter((r) => r.milk_amount === m).length}`).join(" · ")}
                  </p>
                )}
                {top.length > 0 && (
                  <p className="text-sm">
                    <span className={mutedText}>{t("flavours")}: </span>
                    {top.map(([tag, n]) => `${d(`tags.${tag}`)} ${n}`).join(" · ")}
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}

      <div className={`${cardClass} flex flex-col gap-2`}>
        <p className="text-sm font-semibold">{t("allAnswers")}</p>
        {responses.length === 0 ? (
          <p className={mutedText}>{t("noAnswers")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/10">
            {responses.map((r, i) => {
              const drink = r.drink as SurveyDrink;
              return (
                <li key={r.id} className={`flex flex-wrap items-start justify-between gap-2 py-2 text-sm ${r.hidden ? "opacity-50" : ""}`}>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-semibold">
                      {r.respondent_id ? (names.get(r.respondent_id) ?? "—") : `#${i + 1}`} · {d(`drink.${drink}`)} ·{" "}
                      <span className={mutedText}>{time(r.created_at)}</span>
                    </span>
                    <span>
                      {(CRITERIA[drink] ?? []).map((c) => `${d(`criteria.${c}`)} ${Number(r.scores[c]).toFixed(1)}`).join(" · ")}
                    </span>
                    {(r.milk_amount || r.flavor_tags.length > 0) && (
                      <span className={mutedText}>
                        {[r.milk_amount && d(`milk.${r.milk_amount}`), ...r.flavor_tags.map((tag) => d(`tags.${tag}`))]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                    {r.comment && <span className={r.hidden ? "line-through" : ""}>“{r.comment}”</span>}
                  </div>
                  <button type="button" disabled={busy} className={smallButton} onClick={() => toggleHidden(r)}>
                    {r.hidden ? t("unhide") : t("hide")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {responses.some((r) => r.hidden) && <p className={mutedText}>{t("hiddenNote")}</p>}
      </div>

      {big && svg && (
        <div
          role="dialog"
          aria-modal
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-6"
          onClick={() => setBig(false)}
        >
          <p className="text-center font-serif text-2xl">{t(`scanTitle.${info.subject_type}`)}</p>
          <div
            className="aspect-square w-full max-w-[min(80vw,70vh)] [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <button type="button" className={secondaryButton} onClick={() => setBig(false)}>
            {t("closeQr")}
          </button>
        </div>
      )}
    </>
  );
}
