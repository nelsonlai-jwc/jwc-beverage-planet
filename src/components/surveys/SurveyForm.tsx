"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  submitSurvey,
  type SurveyAnswer,
} from "@/app/[locale]/taste/[token]/actions";
import {
  CRITERIA,
  FLAVOR_TAGS,
  MILK_AMOUNTS,
  commentMax,
  helpGroup,
  isMilk,
  scaleWordKey,
  type Criterion,
  type MilkAmount,
  type SubjectType,
  type SurveyDrink,
} from "@/lib/tasting/scale";

/** What the fill page shows (public.get_survey). */
export type SurveyInfo = {
  id: string;
  subject_type: SubjectType;
  /** Name of a custom survey (one with no record or recipe); null otherwise. */
  title: string | null;
  audience: "OUTLET" | "PUBLIC";
  drinks: SurveyDrink[];
  note: string | null;
  outlet: string | null;
  /** Every outlet of the survey (several when more were ticked). */
  outlets?: string[];
  date: string;
  bean: string | null;
  brand: string | null;
  recipe: string | null;
  temperature: string | null;
  closes_at: string;
  open: boolean;
  answered: SurveyDrink[];
};

const chip = (on: boolean) =>
  `inline-flex min-h-10 items-center rounded-full border-[1.5px] px-4 text-sm font-semibold ${
    on ? "border-black bg-black text-white" : "border-black/40 bg-white"
  }`;

const START = 3;
const startScores = (drink: SurveyDrink) =>
  Object.fromEntries(CRITERIA[drink].map((c) => [c, START])) as Partial<
    Record<Criterion, number>
  >;

/** One score: a 0-6 slider in steps of 0.5 with the scale word. */
function ScoreRow({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const t = useTranslations("Tasting");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base font-semibold">{label}</span>
        <span className="text-base font-semibold tabular-nums">
          {value.toFixed(1)}{" "}
          <span className="text-sm font-normal">
            · {t(scaleWordKey(value))}
          </span>
        </span>
      </div>
      <span className="text-[13px] text-[#3d3f3a]">{help}</span>
      <input
        type="range"
        min={0}
        max={6}
        step={0.5}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-full accent-black"
      />
      <div
        aria-hidden
        className="flex justify-between text-[11px] text-[#3d3f3a]"
      >
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </div>
  );
}

/** Subject of a survey in one line: a custom survey's name, the bean, or the recipe with its temperature. */
export function useSubjectLabel() {
  const r = useTranslations("Recipes");
  return (s: {
    subject_type: SubjectType;
    title: string | null;
    bean: string | null;
    brand: string | null;
    recipe: string | null;
    temperature: string | null;
  }) =>
    s.title
      ? s.title
      : s.subject_type === "RECIPE"
        ? `${s.recipe ?? "—"}${s.temperature ? ` (${r(`temp.${s.temperature}`)})` : ""}`
        : `${s.bean ?? "—"}${s.brand ? ` · ${s.brand}` : ""}`;
}

/** Badge of what a survey rates: "Espresso", or "Custom · Espresso" for a custom survey. */
export function useSubjectBadge() {
  const t = useTranslations("Surveys");
  return (s: { subject_type: SubjectType; title: string | null }) =>
    s.title
      ? `${t("subject.CUSTOM")} · ${t(`customType.${s.subject_type}`)}`
      : t(`subject.${s.subject_type}`);
}

/** "Outlet A, Outlet B · " before a survey's date, or nothing for a survey with no outlet. */
export function useOutletPrefix() {
  const t = useTranslations("Surveys");
  return (s: { outlet: string | null; outlets?: string[] }) => {
    const names = s.outlets?.length ? s.outlets : s.outlet ? [s.outlet] : [];
    return names.length ? `${names.join(t("outletSeparator"))} · ` : "";
  };
}

/** Answer form for one survey: one drink at a time, then the next drink left. */
export function SurveyForm({
  token,
  survey,
}: {
  token: string;
  survey: SurveyInfo;
}) {
  const t = useTranslations("Tasting");
  const subject = useSubjectLabel();
  const outletPrefix = useOutletPrefix();
  const drinks = survey.drinks;
  const [done, setDone] = useState<SurveyDrink[]>(survey.answered);
  const [drink, setDrink] = useState<SurveyDrink>(
    drinks.find((d) => !survey.answered.includes(d)) ?? drinks[0],
  );
  const [scores, setScores] = useState(() => startScores(drink));
  const [tags, setTags] = useState<string[]>([]);
  const [milkAmount, setMilkAmount] = useState<MilkAmount | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const left = drinks.filter((d) => !done.includes(d));

  function reset(next: SurveyDrink) {
    setDrink(next);
    setScores(startScores(next));
    setTags([]);
    setMilkAmount(null);
    setComment("");
    setError(null);
  }

  function submit() {
    if (isMilk(drink) && !milkAmount) {
      setError(t("milkAmountRequired"));
      return;
    }
    const answer: SurveyAnswer = {
      drink,
      scores,
      flavorTags: tags,
      milkAmount,
      comment,
    };
    setError(null);
    startTransition(async () => {
      const result = await submitSurvey(token, answer);
      if (result.ok) {
        setDone([...done, drink]);
        window.scrollTo({ top: 0 });
      } else {
        setError(t(`errors.${result.error}`));
        if (result.error === "ALREADY") setDone([...done, drink]);
      }
    });
  }

  const header = (
    <div className="flex flex-col gap-1 rounded-[20px] bg-white p-5">
      <h1 className="font-serif text-2xl leading-tight">
        {t(`subjectTitle.${survey.subject_type}`)}
      </h1>
      <p className="text-base font-semibold">{subject(survey)}</p>
      <p className="text-sm text-[#3d3f3a]">
        {outletPrefix(survey)}
        {survey.date}
      </p>
      {survey.note && <p className="text-sm">{survey.note}</p>}
    </div>
  );

  if (done.includes(drink)) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4 rounded-[20px] bg-white p-5">
          <p className="text-lg font-semibold">{t("thanks")}</p>
          {error && (
            <p className="text-sm font-semibold text-[#c4161c]">{error}</p>
          )}
          {left.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => reset(d)}
              className="inline-flex h-11 items-center justify-center rounded-full bg-black px-5 text-base font-semibold text-white"
            >
              {t("rateAlso", { drink: t(`drink.${d}`) })}
            </button>
          ))}
        </div>
      </>
    );
  }

  const group = helpGroup(drink);
  const max = commentMax(drink);

  return (
    <>
      {header}
      <form
        className="flex flex-col gap-5 rounded-[20px] bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {drinks.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="text-base font-semibold">{t("whichDrink")}</span>
            <div className="flex flex-wrap gap-2">
              {drinks.map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={done.includes(d)}
                  aria-pressed={drink === d}
                  onClick={() => reset(d)}
                  className={`${chip(drink === d)} disabled:opacity-40`}
                >
                  {t(`drink.${d}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[13px] text-[#3d3f3a]">{t("scaleHint")}</p>

        {CRITERIA[drink].map((c) => (
          <ScoreRow
            key={c}
            label={t(`criteria.${c}`)}
            help={t(`help.${group}.${c}`)}
            value={scores[c] ?? START}
            onChange={(v) => setScores({ ...scores, [c]: v })}
          />
        ))}

        {isMilk(drink) && (
          <div className="flex flex-col gap-2">
            <span className="text-base font-semibold">{t("milkAmount")}</span>
            <div role="radiogroup" className="flex flex-wrap gap-2">
              {MILK_AMOUNTS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={milkAmount === m}
                  onClick={() => setMilkAmount(m)}
                  className={chip(milkAmount === m)}
                >
                  {t(`milk.${m}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {drink !== "RECIPE" && (
          <div className="flex flex-col gap-2">
            <span className="text-base font-semibold">{t("flavorTags")}</span>
            <div className="flex flex-wrap gap-2">
              {FLAVOR_TAGS.map((tag) => {
                const on = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setTags(
                        on ? tags.filter((x) => x !== tag) : [...tags, tag],
                      )
                    }
                    className={chip(on)}
                  >
                    {t(`tags.${tag}`)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-base font-semibold">
            {drink === "RECIPE" ? t("opinion") : t("comment")}
          </span>
          {drink === "RECIPE" ? (
            <textarea
              value={comment}
              maxLength={max}
              rows={4}
              onChange={(e) => setComment(e.target.value)}
              className="rounded-[10px] border-[1.5px] border-black px-3.5 py-2 text-base"
            />
          ) : (
            <input
              value={comment}
              maxLength={max}
              onChange={(e) => setComment(e.target.value)}
              className="h-11 rounded-[10px] border-[1.5px] border-black px-3.5 text-base"
            />
          )}
        </label>

        {error && (
          <p role="alert" className="text-sm font-semibold text-[#c4161c]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 items-center justify-center rounded-full bg-black px-5 text-base font-semibold text-white disabled:opacity-50"
        >
          {pending ? t("sending") : t("submit")}
        </button>
      </form>
    </>
  );
}
