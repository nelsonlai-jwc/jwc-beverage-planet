import { useTranslations } from "next-intl";
import { letterFor, splitReferences } from "@/lib/recipes/letters";
import type { BeverageStyle, BeverageTemp, MeasureUnit, Photo, StepMedia } from "@/lib/recipes/types";
import { StepMediaView } from "./StepMediaView";

export type SopData = {
  productName: string | null;
  style: BeverageStyle | null;
  temperature: BeverageTemp | null;
  versionNo: number;
  updatedAt?: string | null;
  yieldQuantity?: number | null;
  yieldUnit?: MeasureUnit | null;
  appearanceNotes: string | null;
  ingredients: { key: string; name: string; isPrep: boolean; quantity: number | null; unit: MeasureUnit | null }[];
  steps: { key: string; instruction: string; media?: StepMedia | null }[];
  photos: Photo[];
};

function Letter({ letter }: { letter: string }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border-[1.5px] border-black px-1 text-xs font-semibold leading-none">
      {letter}
    </span>
  );
}

// Barista layout: photo, ingredients with amounts, steps. Never shows cost (ch. 12.3, 20.3).
// Ingredients carry letters A, B, C…; steps that mention [A] show the same letter.
export function SopView({ data, draft }: { data: SopData; draft?: boolean }) {
  const t = useTranslations("Recipes");
  const cover = data.photos.find((p) => p.url);

  return (
    <article className="flex flex-col gap-5 rounded-[20px] bg-white p-5 sm:p-6">
      {draft && (
        <p className="rounded-[10px] bg-brand-orange px-3 py-2 text-sm font-semibold">{t("draftPreview")}</p>
      )}
      {cover?.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
        <img src={cover.url} alt={data.productName ?? ""} className="aspect-[4/3] w-full rounded-[12px] object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[12px] bg-[#eceee8] text-sm text-[#3d3f3a]">
          {t("noPhoto")}
        </div>
      )}
      <header className="flex flex-col gap-1">
        <h2 className="font-serif text-[26px] font-normal">{data.productName || t("untitled")}</h2>
        <p className="text-sm text-[#3d3f3a]">
          {[data.style && t(`style.${data.style}`), data.temperature && t(`temp.${data.temperature}`), `V${data.versionNo}`]
            .filter(Boolean)
            .join(" · ")}
          {data.updatedAt && ` · ${t("updatedAt", { date: data.updatedAt })}`}
        </p>
        {data.yieldQuantity != null && (
          <p className="text-sm">{t("yieldLine", { quantity: data.yieldQuantity, unit: data.yieldUnit ?? "" })}</p>
        )}
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">{t("sections.ingredients")}</h3>
        {data.ingredients.length === 0 ? (
          <p className="text-sm text-[#3d3f3a]">—</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/10">
            {data.ingredients.map((i, index) => (
              <li key={i.key} className="flex justify-between gap-3 py-2 text-sm">
                <span className="flex items-baseline gap-2">
                  <Letter letter={letterFor(index)} />
                  <span>{i.name}</span>
                  {i.isPrep && <span className="ml-2 text-xs font-semibold text-[#3d3f3a]">{t("prep")}</span>}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {i.quantity ?? "—"} {i.unit ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">{t("sections.method")}</h3>
        <ol className="flex flex-col gap-2">
          {data.steps
            .filter((s) => s.instruction.trim())
            .map((s, index) => (
              <li key={s.key} className="flex gap-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="whitespace-pre-wrap pt-0.5">
                    {splitReferences(s.instruction, data.ingredients.length).map((part, i) =>
                      "letter" in part ? <Letter key={i} letter={part.letter} /> : <span key={i}>{part.text}</span>,
                    )}
                  </span>
                  {s.media && <StepMediaView media={s.media} stepNo={index + 1} />}
                </div>
              </li>
            ))}
        </ol>
      </section>

      {data.appearanceNotes && (
        <section className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">{t("sections.appearance")}</h3>
          <p className="whitespace-pre-wrap text-sm">{data.appearanceNotes}</p>
        </section>
      )}
    </article>
  );
}
