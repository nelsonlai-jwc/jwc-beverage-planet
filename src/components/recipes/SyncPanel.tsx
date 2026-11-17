"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { aiSyncRecipes, syncRecipes } from "@/app/[locale]/(app)/recipes/sync/actions";
import { useRouter } from "@/i18n/navigation";
import { letterFor, relabelSteps } from "@/lib/recipes/letters";
import type { SyncContent, SyncOption } from "@/lib/recipes/sync";
import { UNITS, type BeverageStyle, type BeverageTemp, type MeasureUnit, type Photo, type StepMedia } from "@/lib/recipes/types";
import { explainApprovalError } from "./ReviewActions";
import { alertClass, card, inputClass, primaryButton, secondaryButton, smallButton, textareaClass } from "./ui";

type Props = {
  recipeIds: string[];
  columns: { id: string; label: string }[];
  // Finished photos and step photos / videos of each compared recipe.
  media: { recipeId: string; photos: Photo[]; steps: (StepMedia & { stepNo: number })[] }[];
  isPrep: boolean;
  options: SyncOption[];
  styles: BeverageStyle[];
  temps: BeverageTemp[];
};

// AI writes one version from the compared recipes; the Super Admin edits it and syncs it
// to every compared recipe at once (new approved version each, no approval step).
export function SyncPanel({ recipeIds, columns, media, isPrep, options, styles, temps }: Props) {
  const t = useTranslations("Recipes");
  const locale = useLocale();
  const router = useRouter();
  const [content, setContent] = useState<SyncContent | null>(null);
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[] | null>(null);

  const nameOf = (key: string) => options.find((o) => o.key === key)?.name ?? "—";

  async function runAi() {
    setAiPending(true);
    setAiError(false);
    setConfirming(false);
    const result = await aiSyncRecipes(recipeIds, locale);
    setAiPending(false);
    if (!result.ok) {
      setAiError(true);
      return;
    }
    // A new AI answer keeps the ticked recipes; step media is picked again for the new steps.
    setContent((old) => ({ ...result.content, photo_recipe_ids: old?.photo_recipe_ids ?? [] }));
    setError(null);
  }

  function update(patch: Partial<SyncContent>) {
    setContent((c) => (c ? { ...c, ...patch } : c));
    setConfirming(false);
  }

  // Removing an ingredient keeps the [X] step references pointing at the same lines;
  // a reference to the removed one becomes its name.
  function removeIngredient(n: number) {
    if (!content) return;
    const before = content.ingredients.map((i, k) => ({ key: String(k), name: nameOf(i.key) }));
    const after = before.filter((_, k) => k !== n);
    update({
      ingredients: content.ingredients.filter((_, k) => k !== n),
      steps: relabelSteps(content.steps, before, after),
    });
  }

  async function sync() {
    if (!content) return;
    setPending(true);
    setError(null);
    const keep = content.steps.map((s) => Boolean(s.trim()));
    const result = await syncRecipes(recipeIds, {
      ...content,
      steps: content.steps.filter((_, n) => keep[n]).map((s) => s.trim()),
      step_media: content.step_media.filter((_, n) => keep[n]),
    });
    setPending(false);
    if (!result.ok) {
      const which = columns.find((c) => c.id === result.recipeId)?.label;
      const lines =
        result.error === "NOT_ALLOWED"
          ? [t("errors.NOT_ALLOWED")]
          : result.error.startsWith("SYNC_")
            ? [t(`sync.errors.${result.error}`)]
            : explainApprovalError(t, result.error, result.detail);
      setError(which ? [t("sync.failedFor", { recipe: which }), ...lines] : lines);
      setConfirming(false);
      return;
    }
    router.push(`/recipes?tab=sync&synced=${result.count}`);
  }

  // Ticking a recipe brings in its photos; unticking also clears its step media from the steps.
  function toggleMediaRecipe(recipeId: string) {
    if (!content) return;
    const on = !content.photo_recipe_ids.includes(recipeId);
    const ids = on
      ? recipeIds.filter((id) => id === recipeId || content.photo_recipe_ids.includes(id))
      : content.photo_recipe_ids.filter((id) => id !== recipeId);
    const allowed = new Set(media.filter((m) => ids.includes(m.recipeId)).flatMap((m) => m.steps.map((s) => s.id)));
    update({ photo_recipe_ids: ids, step_media: content.step_media.map((m) => (m && allowed.has(m) ? m : null)) });
  }

  const ticked = media.filter((m) => content?.photo_recipe_ids.includes(m.recipeId));
  const photosUsed = ticked.flatMap((m) => m.photos).filter((p, n, all) => all.findIndex((x) => x.id === p.id) === n);
  const stepChoices = ticked.flatMap((m) =>
    m.steps.map((s) => ({
      ...s,
      label: `${columns.find((c) => c.id === m.recipeId)?.label ?? ""} · ${t("stepLabel", { no: s.stepNo })} (${
        s.isVideo ? t("sync.video") : t("sync.photo")
      })`,
    })),
  ).filter((s, n, all) => all.findIndex((x) => x.id === s.id) === n);

  const used = new Set(content?.ingredients.map((i) => i.key) ?? []);
  const unused = options.filter((o) => !used.has(o.key));
  const incomplete =
    !content ||
    content.ingredients.length === 0 ||
    content.ingredients.some((i) => i.quantity == null || !i.unit) ||
    !content.steps.some((s) => s.trim()) ||
    (!isPrep && (!content.style || !content.temperature)) ||
    (isPrep && content.yield_quantity == null);

  return (
    <section className={card} aria-labelledby="sync-ai">
      <h2 id="sync-ai" className="text-base font-semibold">
        {t("sync.aiTitle")}
      </h2>
      <p className="text-[13px] text-[#3d3f3a]">{t("sync.aiIntro")}</p>
      <div>
        <button type="button" className={secondaryButton} disabled={aiPending || pending} onClick={runAi}>
          {aiPending ? t("sync.aiRunning") : content ? t("sync.aiAgain") : t("sync.aiRun")}
        </button>
      </div>
      {aiError && (
        <p role="alert" className={alertClass}>
          {t("sync.aiFailed")}
        </p>
      )}

      {content && !aiPending && (
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">{t("sync.reason")}</span>
            <textarea
              value={content.change_summary}
              onChange={(e) => update({ change_summary: e.target.value })}
              className={textareaClass}
            />
          </label>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-semibold">{t("sections.ingredients")}</legend>
            {content.ingredients.map((line, n) => (
              <div key={`${n}:${line.key}`} className="flex flex-col gap-2 rounded-[12px] bg-[#f3f4f0] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    [{letterFor(n)}] {nameOf(line.key)}
                  </span>
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() => removeIngredient(n)}
                  >
                    {t("remove")}
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_6rem] gap-2 sm:grid-cols-[8rem_6rem_1fr]">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs">{t("fields.quantity")}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={line.quantity ?? ""}
                      onChange={(e) =>
                        update({
                          ingredients: content.ingredients.map((x, k) =>
                            k === n ? { ...x, quantity: e.target.value === "" ? null : Number(e.target.value) } : x,
                          ),
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs">{t("fields.unit")}</span>
                    <select
                      value={line.unit ?? ""}
                      onChange={(e) =>
                        update({
                          ingredients: content.ingredients.map((x, k) =>
                            k === n ? { ...x, unit: (e.target.value || null) as MeasureUnit | null } : x,
                          ),
                        })
                      }
                      className={inputClass}
                    >
                      <option value="" />
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                    <span className="text-xs">{t("sync.notes")}</span>
                    <input
                      value={line.notes}
                      onChange={(e) =>
                        update({
                          ingredients: content.ingredients.map((x, k) => (k === n ? { ...x, notes: e.target.value } : x)),
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                </div>
              </div>
            ))}
            {unused.length > 0 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm">{t("addIngredient")}</span>
                <select
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    update({ ingredients: [...content.ingredients, { key: e.target.value, quantity: null, unit: null, notes: "" }] })
                  }
                  className={inputClass}
                >
                  <option value="" />
                  {unused.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-semibold">{t("sections.method")}</legend>
            <p className="text-[13px] text-[#3d3f3a]">{t("sync.stepsNote")}</p>
            {content.steps.map((step, n) => (
              <div key={n} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{t("stepLabel", { no: n + 1 })}</span>
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() =>
                      update({
                        steps: content.steps.filter((_, k) => k !== n),
                        step_media: content.step_media.filter((_, k) => k !== n),
                      })
                    }
                  >
                    {t("remove")}
                  </button>
                </div>
                <textarea
                  aria-label={t("stepLabel", { no: n + 1 })}
                  value={step}
                  onChange={(e) => update({ steps: content.steps.map((s, k) => (k === n ? e.target.value : s)) })}
                  className={textareaClass}
                />
                {stepChoices.length > 0 && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs">{t("sync.stepMedia")}</span>
                    <select
                      value={content.step_media[n] ?? ""}
                      onChange={(e) =>
                        update({ step_media: content.step_media.map((m, k) => (k === n ? e.target.value || null : m)) })
                      }
                      className={inputClass}
                    >
                      <option value="">{t("sync.noMedia")}</option>
                      {stepChoices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {content.step_media[n] && <MediaPreview item={stepChoices.find((c) => c.id === content.step_media[n])} />}
              </div>
            ))}
            <div>
              <button
                type="button"
                className={smallButton}
                onClick={() => update({ steps: [...content.steps, ""], step_media: [...content.step_media, null] })}
              >
                {t("addStep")}
              </button>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-semibold">{t("sync.mediaTitle")}</legend>
            <p className="text-[13px] text-[#3d3f3a]">{t("sync.mediaIntro")}</p>
            {columns.map((c) => {
              const m = media.find((x) => x.recipeId === c.id);
              const ticked = content.photo_recipe_ids.includes(c.id);
              return (
                <label key={c.id} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={ticked}
                    onChange={() => toggleMediaRecipe(c.id)}
                    className="h-5 w-5 accent-black"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold">{c.label}</span>
                    <span className="text-xs text-[#3d3f3a]">
                      {t("sync.mediaCount", { photos: m?.photos.length ?? 0, steps: m?.steps.length ?? 0 })}
                    </span>
                  </span>
                </label>
              );
            })}
            {content.photo_recipe_ids.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm">{t("sync.photosUsed")}</span>
                {photosUsed.length === 0 ? (
                  <p className={alertClass}>{t("sync.noPhotos")}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {photosUsed.map((p) => (
                      <li key={p.id}>
                        {p.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
                          <img src={p.url} alt="" className="h-20 w-20 rounded-[10px] object-cover" />
                        ) : (
                          <div className="h-20 w-20 rounded-[10px] bg-[#eceee8]" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[13px] text-[#3d3f3a]">{t("sync.stepMediaHint")}</p>
              </div>
            )}
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{t("sync.settings")}</legend>
            {!isPrep && (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm">{t("fields.style")} *</span>
                  <select
                    value={content.style ?? ""}
                    onChange={(e) => update({ style: (e.target.value || null) as BeverageStyle | null })}
                    className={inputClass}
                  >
                    <option value="" />
                    {styles.map((s) => (
                      <option key={s} value={s}>
                        {t(`style.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm">{t("fields.temperature")} *</span>
                  <select
                    value={content.temperature ?? ""}
                    onChange={(e) => update({ temperature: (e.target.value || null) as BeverageTemp | null })}
                    className={inputClass}
                  >
                    <option value="" />
                    {temps.map((s) => (
                      <option key={s} value={s}>
                        {t(`temp.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm">
                  {t("fields.yield")}
                  {isPrep ? " *" : ""}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={content.yield_quantity ?? ""}
                  onChange={(e) => update({ yield_quantity: e.target.value === "" ? null : Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm">{t("fields.unit")}</span>
                <select
                  value={content.yield_unit ?? ""}
                  onChange={(e) => update({ yield_unit: (e.target.value || null) as MeasureUnit | null })}
                  className={inputClass}
                >
                  <option value="" />
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(["cup_type", "serving_size", "garnish"] as const).map((field) => (
              <label key={field} className="flex flex-col gap-1.5">
                <span className="text-sm">{t(`fields.${field}`)}</span>
                <input value={content[field]} onChange={(e) => update({ [field]: e.target.value })} className={inputClass} />
              </label>
            ))}
          </fieldset>

          <p className="text-[13px] text-[#3d3f3a]">{t("sync.keeps")}</p>

          {error && (
            <ul role="alert" className={`${alertClass} flex flex-col gap-1`}>
              {error.map((line, n) => (
                <li key={n}>{line}</li>
              ))}
            </ul>
          )}

          {confirming ? (
            <div className="flex flex-col gap-3 rounded-[12px] border-[1.5px] border-black p-4">
              <p className="text-sm font-semibold">{t("sync.confirm", { count: recipeIds.length })}</p>
              <ul className="list-disc pl-5 text-sm">
                {columns.map((c) => (
                  <li key={c.id}>{c.label}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryButton} disabled={pending} onClick={sync}>
                  {pending ? t("sync.syncing") : t("sync.confirmButton")}
                </button>
                <button type="button" className={secondaryButton} disabled={pending} onClick={() => setConfirming(false)}>
                  {t("sync.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button type="button" className={primaryButton} disabled={incomplete} onClick={() => setConfirming(true)}>
                {t("sync.syncButton", { count: recipeIds.length })}
              </button>
              {incomplete && <p className="mt-2 text-[13px] text-[#3d3f3a]">{t("sync.incomplete")}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MediaPreview({ item }: { item?: StepMedia }) {
  if (!item?.url) return null;
  return item.isVideo ? (
    <video src={item.url} controls preload="metadata" className="max-h-40 w-fit max-w-full rounded-[10px]" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
    <img src={item.url} alt="" className="max-h-40 w-fit max-w-full rounded-[10px] object-cover" />
  );
}
