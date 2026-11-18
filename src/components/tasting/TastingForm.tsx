"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { submitTasting, type TastingAnswer } from "@/app/[locale]/taste/[token]/actions";
import {
  CRITERIA,
  FLAVOR_TAGS,
  MILK_AMOUNTS,
  scaleWordKey,
  type Criterion,
  type Drink,
  type MilkAmount,
} from "@/lib/tasting/scale";

export type SurveyInfo = {
  bean: string;
  brand: string | null;
  outlet: string;
  business_date: string;
  serves_espresso: boolean;
  serves_milk: boolean;
  milk_espresso_g: number | null;
  milk_ml: number | null;
  open: boolean;
};

const chip = (on: boolean) =>
  `inline-flex min-h-10 items-center rounded-full border-[1.5px] px-4 text-sm font-semibold ${
    on ? "border-black bg-black text-white" : "border-black/40 bg-white"
  }`;

const START = 3;

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
          {value.toFixed(1)} <span className="text-sm font-normal">· {t(scaleWordKey(value))}</span>
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
      <div aria-hidden className="flex justify-between text-[11px] text-[#3d3f3a]">
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </div>
  );
}

export function TastingForm({ token, survey }: { token: string; survey: SurveyInfo }) {
  const t = useTranslations("Tasting");
  const drinks: Drink[] = [...(survey.serves_espresso ? ["ESPRESSO" as const] : []), ...(survey.serves_milk ? ["MILK" as const] : [])];
  const [drink, setDrink] = useState<Drink>(drinks[0]);
  const [done, setDone] = useState<Drink[]>([]);
  const [scores, setScores] = useState<Record<Criterion, number>>({ visual: START, taste_balance: START, tactile: START, flavor: START });
  const [tags, setTags] = useState<string[]>([]);
  const [milkAmount, setMilkAmount] = useState<MilkAmount | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ratio =
    survey.milk_espresso_g && survey.milk_ml ? `1:${(survey.milk_ml / survey.milk_espresso_g).toFixed(1)}` : null;
  const left = drinks.filter((d) => !done.includes(d));

  function reset(next: Drink) {
    setDrink(next);
    setScores({ visual: START, taste_balance: START, tactile: START, flavor: START });
    setTags([]);
    setMilkAmount(null);
    setComment("");
    setError(null);
  }

  function submit() {
    if (drink === "MILK" && !milkAmount) {
      setError(t("milkAmountRequired"));
      return;
    }
    const answer: TastingAnswer = { drink, scores, flavorTags: tags, milkAmount, comment };
    setError(null);
    startTransition(async () => {
      const result = await submitTasting(token, answer);
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
      <h1 className="font-serif text-2xl leading-tight">{t("title")}</h1>
      <p className="text-base font-semibold">
        {survey.bean}
        {survey.brand ? ` · ${survey.brand}` : ""}
      </p>
      <p className="text-sm text-[#3d3f3a]">
        {survey.outlet} · {survey.business_date}
      </p>
    </div>
  );

  if (done.includes(drink)) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4 rounded-[20px] bg-white p-5">
          <p className="text-lg font-semibold">{t("thanks")}</p>
          {error && <p className="text-sm font-semibold text-[#c4161c]">{error}</p>}
          {left.map((d) => (
            <button key={d} type="button" onClick={() => reset(d)} className="inline-flex h-11 items-center justify-center rounded-full bg-black px-5 text-base font-semibold text-white">
              {t("rateAlso", { drink: t(`drink.${d}`) })}
            </button>
          ))}
        </div>
      </>
    );
  }

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
                <button key={d} type="button" disabled={done.includes(d)} aria-pressed={drink === d} onClick={() => reset(d)} className={`${chip(drink === d)} disabled:opacity-40`}>
                  {t(`drink.${d}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        {drink === "MILK" && ratio && (
          <p className="rounded-[12px] bg-[#eceee8] px-3 py-2 text-sm">
            {t("milkRecipe", { espresso: survey.milk_espresso_g!, milk: survey.milk_ml!, ratio })}
          </p>
        )}
        <p className="text-[13px] text-[#3d3f3a]">{t("scaleHint")}</p>

        {CRITERIA[drink].map((c) => (
          <ScoreRow
            key={c}
            label={t(`criteria.${c}`)}
            help={t(`help.${drink}.${c}`)}
            value={scores[c]}
            onChange={(v) => setScores({ ...scores, [c]: v })}
          />
        ))}

        {drink === "MILK" && (
          <div className="flex flex-col gap-2">
            <span className="text-base font-semibold">{t("milkAmount")}</span>
            <div role="radiogroup" className="flex flex-wrap gap-2">
              {MILK_AMOUNTS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={milkAmount === m} onClick={() => setMilkAmount(m)} className={chip(milkAmount === m)}>
                  {t(`milk.${m}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-base font-semibold">{t("flavorTags")}</span>
          <div className="flex flex-wrap gap-2">
            {FLAVOR_TAGS.map((tag) => {
              const on = tags.includes(tag);
              return (
                <button key={tag} type="button" aria-pressed={on} onClick={() => setTags(on ? tags.filter((x) => x !== tag) : [...tags, tag])} className={chip(on)}>
                  {t(`tags.${tag}`)}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-base font-semibold">{t("comment")}</span>
          <input value={comment} maxLength={140} onChange={(e) => setComment(e.target.value)} className="h-11 rounded-[10px] border-[1.5px] border-black px-3.5 text-base" />
        </label>

        {error && (
          <p role="alert" className="text-sm font-semibold text-[#c4161c]">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="inline-flex h-12 items-center justify-center rounded-full bg-black px-5 text-base font-semibold text-white disabled:opacity-50">
          {pending ? t("sending") : t("submit")}
        </button>
      </form>
    </>
  );
}
