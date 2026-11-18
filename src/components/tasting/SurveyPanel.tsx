"use client";

import QRCode from "qrcode";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { errorText, inputClass, labelClass, mutedText, primaryButton, secondaryButton, smallButton } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { CRITERIA, MILK_AMOUNTS, type Drink } from "@/lib/tasting/scale";

export type Survey = {
  id: string;
  calibration_id: string;
  token: string;
  serves_espresso: boolean;
  serves_milk: boolean;
  milk_espresso_g: number | null;
  milk_ml: number | null;
  closes_at: string;
  closed_at: string | null;
  max_responses: number;
  revision: number;
};

export type SurveyResponse = {
  id: string;
  survey_id: string;
  drink: string;
  visual: number | null;
  taste_balance: number;
  tactile: number;
  flavor: number;
  flavor_tags: string[];
  milk_amount: string | null;
  comment: string | null;
  hidden: boolean;
  created_at: string;
};

const avg = (values: number[]) => (values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : "—");

/** "YYYY-MM-DDTHH:mm" in Malaysia time → ISO. */
const myToIso = (local: string) => new Date(`${local}:00+08:00`).toISOString();

/** Tasting survey of one espresso calibration record: open it, share the QR code, read the results. */
export function SurveyPanel({
  calibrationId,
  date,
  yieldG,
  survey,
  responses,
  canManage,
  editable,
}: {
  calibrationId: string;
  date: string;
  yieldG: number;
  survey: Survey | null;
  responses: SurveyResponse[];
  canManage: boolean;
  editable: boolean;
}) {
  const t = useTranslations("Tasting");
  const format = useFormatter();
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [form, setForm] = useState({ espresso: true, milk: false, espressoG: String(yieldG), milkMl: "", closes: `${date}T23:59` });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [now] = useState(() => Date.now());

  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  // Shared links open in English; the page has a language switch.
  const url = survey && origin ? `${origin}/en/taste/${survey.token}` : null;
  useEffect(() => {
    if (!url) return;
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg);
  }, [url]);

  if (!survey && !canManage) return null;

  async function save(run: () => PromiseLike<{ error: unknown; data?: unknown[] | null }>) {
    setBusy(true);
    setError(null);
    const { error: saveError, data } = await run();
    setBusy(false);
    if (saveError || (data && !data.length)) {
      setError(t("saveFailed"));
      router.refresh();
      return false;
    }
    toast("saved");
    router.refresh();
    return true;
  }

  async function open() {
    const espressoG = Number(form.espressoG);
    const milkMl = Number(form.milkMl);
    if (!form.espresso && !form.milk) return setError(t("pickDrink"));
    if (form.milk && !(espressoG > 0 && milkMl > 0)) return setError(t("milkRecipeRequired"));
    if (!form.closes || new Date(myToIso(form.closes)).getTime() <= Date.now()) return setError(t("closesFuture"));
    const ok = await save(() =>
      createClient()
        .from("tasting_surveys")
        .insert({
          calibration_id: calibrationId,
          serves_espresso: form.espresso,
          serves_milk: form.milk,
          milk_espresso_g: form.milk ? espressoG : null,
          milk_ml: form.milk ? milkMl : null,
          closes_at: myToIso(form.closes),
        })
        .select("id"),
    );
    if (ok) setOpening(false);
  }

  if (!survey) {
    if (!editable) return null;
    return opening ? (
      <div className="flex flex-col gap-3 rounded-[12px] border border-black/15 p-3">
        <p className="text-sm font-semibold">{t("openTitle")}</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={form.espresso} onChange={(e) => setForm({ ...form, espresso: e.target.checked })} className="h-5 w-5 accent-black" />
            {t("drink.ESPRESSO")}
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={form.milk} onChange={(e) => setForm({ ...form, milk: e.target.checked })} className="h-5 w-5 accent-black" />
            {t("drink.MILK")}
          </label>
        </div>
        {form.milk && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={labelClass}>{t("milkEspressoG")}</span>
              <input type="number" inputMode="decimal" min="0.1" step="any" value={form.espressoG} onChange={(e) => setForm({ ...form, espressoG: e.target.value })} className={inputClass} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={labelClass}>{t("milkMl")}</span>
              <input type="number" inputMode="decimal" min="1" step="any" value={form.milkMl} onChange={(e) => setForm({ ...form, milkMl: e.target.value })} className={inputClass} />
            </label>
            {Number(form.espressoG) > 0 && Number(form.milkMl) > 0 && (
              <p className={`${mutedText} col-span-2`}>{t("ratio", { ratio: `1:${(Number(form.milkMl) / Number(form.espressoG)).toFixed(1)}` })}</p>
            )}
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>{t("closesAt")}</span>
          <input type="datetime-local" value={form.closes} onChange={(e) => setForm({ ...form, closes: e.target.value })} className={inputClass} />
        </label>
        <p className={mutedText}>{t("openHint")}</p>
        {error && <p className={errorText}>{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={open} className={primaryButton}>
            {t("openButton")}
          </button>
          <button type="button" onClick={() => setOpening(false)} className={secondaryButton}>
            {t("cancel")}
          </button>
        </div>
      </div>
    ) : (
      <button type="button" onClick={() => setOpening(true)} className={`${secondaryButton} self-start`}>
        {t("openSurvey")}
      </button>
    );
  }

  const isOpen = !survey.closed_at && new Date(survey.closes_at).getTime() > now && responses.length < survey.max_responses;
  const shown = responses.filter((r) => !r.hidden);
  const drinks: Drink[] = [...(survey.serves_espresso ? ["ESPRESSO" as const] : []), ...(survey.serves_milk ? ["MILK" as const] : [])];
  const time = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });

  function downloadQr() {
    if (!svg) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    link.download = `tasting-${date}.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-black/15 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{t("surveyTitle")}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${isOpen ? "bg-brand-green" : "bg-[#eceee8]"}`}>
          {isOpen ? t("openUntil", { time: time(survey.closes_at) }) : t("closedBadge")}
        </span>
        <span className={mutedText}>{t("responses", { count: responses.length })}</span>
      </div>

      {isOpen && (
        <div className="flex flex-wrap items-start gap-3">
          {svg && (
            <button type="button" onClick={() => setBig(true)} aria-label={t("showQr")} className="h-32 w-32 shrink-0 rounded-[8px] border border-black/15 bg-white p-1 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
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

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {isOpen ? (
            <button
              type="button"
              disabled={busy}
              className={smallButton}
              onClick={() => save(() => createClient().from("tasting_surveys").update({ closed_at: new Date().toISOString() }).eq("id", survey.id).select("id"))}
            >
              {t("closeNow")}
            </button>
          ) : (
            editable &&
            responses.length < survey.max_responses && (
              <button
                type="button"
                disabled={busy}
                className={smallButton}
                onClick={() =>
                  save(() =>
                    createClient()
                      .from("tasting_surveys")
                      .update({ closed_at: null, closes_at: myToIso(`${date}T23:59`) > new Date().toISOString() ? myToIso(`${date}T23:59`) : new Date(Date.now() + 3600e3).toISOString() })
                      .eq("id", survey.id)
                      .select("id"),
                  )
                }
              >
                {t("reopen")}
              </button>
            )
          )}
        </div>
      )}
      {error && <p className={errorText}>{error}</p>}

      {drinks.map((d) => {
        const rows = shown.filter((r) => r.drink === d);
        return (
          <div key={d} className="flex flex-col gap-2 border-t border-black/10 pt-2">
            <p className="text-sm font-semibold">
              {t(`drink.${d}`)} · {t("responses", { count: rows.length })}
              {d === "MILK" && survey.milk_espresso_g && survey.milk_ml
                ? ` · ${t("milkRecipeShort", { espresso: survey.milk_espresso_g, milk: survey.milk_ml })}`
                : ""}
            </p>
            {rows.length > 0 && (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-5">
                  {CRITERIA[d].map((c) => (
                    <div key={c}>
                      <dt className={mutedText}>{t(`criteria.${c}`)}</dt>
                      <dd className="font-semibold">{avg(rows.map((r) => Number(r[c])))}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className={mutedText}>{t("average")}</dt>
                    <dd className="font-semibold">{avg(rows.flatMap((r) => CRITERIA[d].map((c) => Number(r[c]))))}</dd>
                  </div>
                </dl>
                {d === "MILK" && (
                  <p className="text-sm">
                    <span className={mutedText}>{t("milkAmount")}: </span>
                    {MILK_AMOUNTS.map((m) => `${t(`milk.${m}`)} ${rows.filter((r) => r.milk_amount === m).length}`).join(" · ")}
                  </p>
                )}
                {(() => {
                  const counts = new Map<string, number>();
                  rows.forEach((r) => r.flavor_tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
                  const top = [...counts].sort((a, b) => b[1] - a[1]);
                  return top.length ? (
                    <p className="text-sm">
                      <span className={mutedText}>{t("tagsResult")}: </span>
                      {top.map(([tag, n]) => `${t(`tags.${tag}`)} ${n}`).join(" · ")}
                    </p>
                  ) : null;
                })()}
              </>
            )}
          </div>
        );
      })}

      {responses.some((r) => r.comment) && (
        <ul className="flex flex-col gap-1.5 border-t border-black/10 pt-2">
          {responses
            .filter((r) => r.comment)
            .map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <span className={r.hidden ? "text-[#3d3f3a] line-through" : ""}>
                  “{r.comment}” <span className={mutedText}>· {t(`drink.${r.drink}`)}</span>
                </span>
                {canManage && (
                  <button
                    type="button"
                    disabled={busy}
                    className={smallButton}
                    onClick={() => save(() => createClient().from("tasting_responses").update({ hidden: !r.hidden }).eq("id", r.id).select("id"))}
                  >
                    {r.hidden ? t("unhide") : t("hide")}
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
      {responses.some((r) => r.hidden) && <p className={mutedText}>{t("hiddenNote")}</p>}

      {big && svg && (
        <div role="dialog" aria-modal className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-6" onClick={() => setBig(false)}>
          <p className="text-center font-serif text-2xl">{t("scanTitle")}</p>
          <div className="aspect-square w-full max-w-[min(80vw,70vh)] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          <button type="button" className={secondaryButton} onClick={() => setBig(false)}>
            {t("closeQr")}
          </button>
        </div>
      )}
    </div>
  );
}
