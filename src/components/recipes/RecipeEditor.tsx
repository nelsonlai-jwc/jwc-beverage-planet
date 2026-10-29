"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { publishRecipeVersion } from "@/app/[locale]/(app)/recipes/actions";
import { Link, useRouter } from "@/i18n/navigation";
import { prepareImage } from "@/lib/media/prepareImage";
import { extensionFor, prepareStepMedia, STEP_MEDIA_ACCEPT } from "@/lib/media/prepareStepMedia";
import { createClient } from "@/lib/supabase/client";
import { getRecipeCost, MEDIA_BUCKET } from "@/lib/recipes/data";
import { letterFor, relabelSteps } from "@/lib/recipes/letters";
import {
  TASTES,
  UNITS,
  type BeverageStyle,
  type BeverageTemp,
  type CostResult,
  type FullVersion,
  type MeasureUnit,
  type Photo,
  type StepMedia,
  type Taste,
  type ValidationError,
} from "@/lib/recipes/types";
import type { Json } from "@/types/database";
import { CostSummary } from "./CostSummary";
import { explainApprovalError } from "./ReviewActions";
import { SopView } from "./SopView";
import { StepMediaView } from "./StepMediaView";
import {
  StatusBadge,
  alertClass,
  card,
  inputClass,
  primaryButton,
  secondaryButton,
  smallButton,
  textareaClass,
} from "./ui";
import { useDragSort } from "./useDragSort";

type Option = { id: string; name: string; approved?: boolean };
type IngredientLine = {
  key: string;
  ref: string; // "m:<material id>" or "p:<prep recipe id>"
  quantity: string;
  unit: MeasureUnit | "";
  notes: string;
};
type PackagingLine = { key: string; itemId: string; pieces: string };
type StepLine = { key: string; instruction: string; media: StepMedia | null };

const MAX_PHOTOS = 5;
const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
// Unsaved changes are saved as a draft this long after the last edit.
const AUTOSAVE_MS = 3000;
const TEXT_FIELDS = ["cup_type", "serving_size", "garnish", "storage_method", "shelf_life", "tasting_notes"] as const;

type Props = {
  recipeId: string;
  outletId: string;
  outletName: string;
  isPrep: boolean;
  version: FullVersion;
  returnReason: string | null;
  materials: Option[];
  preps: Option[];
  packagingItems: Option[];
  initialCost: CostResult | null;
  // Admin editing an approved recipe: saving makes the new version live at once.
  adminDirect: boolean;
  // Style and temperature choices in the order set on the Settings page.
  styles: BeverageStyle[];
  temps: BeverageTemp[];
};

const newKey = () => crypto.randomUUID();
const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

function move<T>(list: T[], index: number, delta: number) {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function RecipeEditor(props: Props) {
  const { recipeId, outletId, outletName, isPrep, version, materials, preps, packagingItems, adminDirect } = props;
  const t = useTranslations("Recipes");
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [fields, setFields] = useState({
    product_name: version.product_name ?? "",
    purpose: version.purpose,
    style: version.style ?? "",
    temperature: version.temperature ?? "",
    yield_quantity: version.yield_quantity?.toString() ?? "",
    yield_unit: version.yield_unit ?? "",
    appearance_notes: version.appearance_notes ?? "",
    change_summary: version.change_summary ?? "",
    ...Object.fromEntries(TEXT_FIELDS.map((f) => [f, version[f] ?? ""])),
  } as Record<string, string>);
  const [tastes, setTastes] = useState<Record<Taste, string>>(
    Object.fromEntries(TASTES.map((k) => [k, version[`taste_${k}`]?.toString() ?? ""])) as Record<Taste, string>,
  );
  const [ingredients, setIngredients] = useState<IngredientLine[]>(
    version.ingredients.map((i) => ({
      key: i.id,
      ref: i.prep_recipe_id ? `p:${i.prep_recipe_id}` : `m:${i.material_id}`,
      quantity: i.quantity?.toString() ?? "",
      unit: i.unit ?? "",
      notes: i.notes ?? "",
    })),
  );
  const [packaging, setPackaging] = useState<PackagingLine[]>(
    version.packaging.map((p) => ({ key: p.id, itemId: p.packaging_item_id, pieces: p.pieces.toString() })),
  );
  const [steps, setSteps] = useState<StepLine[]>(
    version.steps.length
      ? version.steps.map((s) => ({ key: s.id, instruction: s.instruction, media: s.media }))
      : [{ key: newKey(), instruction: "", media: null }],
  );
  const [removedStep, setRemovedStep] = useState<{ step: StepLine; index: number } | null>(null);
  const [photos, setPhotos] = useState<Photo[]>(version.photos);
  const [revision, setRevision] = useState(version.revision);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "submitting" | "uploading">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [cost, setCost] = useState<CostResult | null>(props.initialCost);
  const [showPreview, setShowPreview] = useState(false);
  const [publishErrors, setPublishErrors] = useState<string[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Counts edits, so a save that finishes after a newer edit leaves the draft marked unsaved.
  const [edits, setEdits] = useState(0);
  const editsRef = useRef(0);
  const saveRunning = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // One key per page load, so a double click cannot publish twice.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  // Warn before leaving with unsaved changes (ch. 21).
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      editsRef.current += 1;
      setEdits(editsRef.current);
    };
  }
  const setField = (name: string, value: string) => change(setFields)({ ...fields, [name]: value });
  const setIngredientLines = change(setIngredients);
  // Reordering or removing ingredients moves their letters; steps follow along.
  const updateIngredients = (next: IngredientLine[]) => {
    const before = ingredients.map((line) => ({ key: line.key, name: optionName(line.ref) }));
    const relabelled = relabelSteps(
      steps.map((step) => step.instruction),
      before,
      next,
    );
    if (relabelled.some((text, index) => text !== steps[index].instruction)) {
      updateSteps(steps.map((step, index) => ({ ...step, instruction: relabelled[index] })));
    }
    setIngredientLines(next);
  };
  const updatePackaging = change(setPackaging);
  const updateSteps = change(setSteps);
  const updatePhotos = change(setPhotos);
  const ingredientDrag = useDragSort(ingredients, (next) => updateIngredients(next));
  const stepDrag = useDragSort(steps, (next) => updateSteps(next));

  // Puts [A] at the cursor of a step, or at its end.
  function insertReference(key: string, letter: string) {
    const field = document.getElementById(`step-${key}`) as HTMLTextAreaElement | null;
    const step = steps.find((s) => s.key === key);
    if (!step) return;
    const at = field && document.activeElement === field ? field.selectionStart : step.instruction.length;
    const token = `[${letter}]`;
    const instruction = step.instruction.slice(0, at) + token + step.instruction.slice(at);
    updateSteps(steps.map((s) => (s.key === key ? { ...s, instruction } : s)));
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  const optionName = (ref: string) =>
    ref.startsWith("p:")
      ? (preps.find((p) => `p:${p.id}` === ref)?.name ?? "—")
      : (materials.find((m) => `m:${m.id}` === ref)?.name ?? "—");

  // Empty ingredient lines are not saved, so letters after them move up.
  function savedInstructions() {
    return relabelSteps(
      steps.map((step) => step.instruction),
      ingredients.map((line) => ({ key: line.key, name: optionName(line.ref) })),
      ingredients.filter((i) => i.ref),
    );
  }

  function draftPayload(): Json {
    const instructions = savedInstructions();
    return {
      ...fields,
      style: isPrep ? "PREP_MATERIAL" : fields.style || null,
      temperature: fields.temperature || null,
      yield_quantity: isPrep ? numberOrNull(fields.yield_quantity) : null,
      yield_unit: isPrep ? fields.yield_unit || null : null,
      ...Object.fromEntries(TASTES.map((k) => [`taste_${k}`, numberOrNull(tastes[k])])),
      ingredients: ingredients
        .filter((i) => i.ref)
        .map((i) => ({
          material_id: i.ref.startsWith("m:") ? i.ref.slice(2) : null,
          prep_recipe_id: i.ref.startsWith("p:") ? i.ref.slice(2) : null,
          quantity: numberOrNull(i.quantity),
          unit: i.unit || null,
          notes: i.notes || null,
        })),
      packaging: packaging
        .filter((p) => p.itemId && Number(p.pieces) > 0)
        .map((p) => ({ packaging_item_id: p.itemId, pieces: Number(p.pieces) })),
      steps: steps.map((s, index) => ({ instruction: instructions[index], media_asset_id: s.media?.id ?? null })),
      photos: photos.map((p) => p.id),
    };
  }

  async function save(): Promise<number | null> {
    saveRunning.current = true;
    const startEdits = editsRef.current;
    const { data, error } = await supabase.rpc("save_recipe_draft", {
      p_version_id: version.id,
      p_revision: revision,
      p_draft: draftPayload(),
    });
    saveRunning.current = false;
    if (error) {
      setMessage(error.code === "40001" ? t("conflict") : `${t("saveFailed")} ${error.message}`);
      setSaveFailed(true);
      return null;
    }
    setSaveFailed(false);
    setRevision(data);
    setDirty(editsRef.current !== startEdits);
    setSavedAt(new Date());
    setCost(await getRecipeCost(supabase, version.id));
    return data;
  }

  // Autosave: a few seconds after the last edit, unless a save is already running or
  // the last one failed (the message stays until the person acts).
  useEffect(() => {
    if (!dirty || saving !== "idle" || saveFailed) return;
    const timer = window.setTimeout(async () => {
      if (saveRunning.current) return;
      setSaving("saving");
      await save();
      setSaving("idle");
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // save() reads the latest state through this render's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, dirty, saving, saveFailed]);

  async function handleSave() {
    setSaving("saving");
    setMessage(null);
    await save();
    setSaving("idle");
  }

  async function handleSubmit() {
    setSaving("submitting");
    setMessage(null);
    setErrors([]);
    const saved = await save();
    if (saved == null) {
      setSaving("idle");
      return;
    }
    const { data, error } = await supabase.rpc("submit_recipe_version", {
      p_version_id: version.id,
      p_revision: saved,
    });
    setSaving("idle");
    if (error) {
      setMessage(`${t("actionFailed")} ${error.message}`);
      return;
    }
    const result = data as { errors?: ValidationError[] };
    if (result.errors?.length) {
      setErrors(result.errors);
      document.getElementById("submit-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    router.push(`/recipes/${recipeId}`);
  }

  // Admin: save, then submit and approve in one step; the checks are those of approval.
  async function handlePublish() {
    setSaving("submitting");
    setMessage(null);
    setErrors([]);
    setPublishErrors(null);
    const saved = await save();
    if (saved == null) {
      setSaving("idle");
      return;
    }
    const result = await publishRecipeVersion(version.id, saved, idempotencyKey);
    setSaving("idle");
    if (result.ok) {
      router.push(`/recipes/${recipeId}`);
      return;
    }
    if ("errors" in result) {
      setErrors(result.errors);
    } else {
      setPublishErrors(explainApprovalError(t, result.message ?? result.error, result.details));
    }
    document.getElementById("submit-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Puts one file in storage and records it; returns its id and a signed URL, or null.
  async function uploadMedia(file: File) {
    const id = crypto.randomUUID();
    const path = `${outletId}/${id}.${extensionFor(file.type)}`;
    const upload = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type });
    if (upload.error) {
      setMessage(`${t("uploadFailed")} ${upload.error.message}`);
      return null;
    }
    // No .select(): the new row is not visible to the select policy within the insert.
    const insert = await supabase.from("media_assets").insert({
      id,
      bucket: MEDIA_BUCKET,
      object_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      owner_outlet_id: outletId,
      upload_status: "READY",
    });
    if (insert.error) {
      setMessage(`${t("uploadFailed")} ${insert.error.message}`);
      return null;
    }
    const signed = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
    return { id, url: signed.data?.signedUrl ?? null };
  }

  async function handleStepMedia(key: string, input: HTMLInputElement) {
    const original = input.files?.[0];
    input.value = "";
    if (!original) return;
    setMessage(null);
    const prepared = await prepareStepMedia(original);
    if (!prepared.ok) {
      setMessage(
        prepared.error === "size" ? t("stepMediaSize") : prepared.error === "convert" ? t("photoConvert") : t("stepMediaType"),
      );
      return;
    }
    setSaving("uploading");
    const uploaded = await uploadMedia(prepared.file);
    setSaving("idle");
    if (!uploaded) return;
    const media = { ...uploaded, isVideo: Boolean(prepared.isVideo) };
    setSteps((current) => current.map((s) => (s.key === key ? { ...s, media } : s)));
    setDirty(true);
    editsRef.current += 1;
    setEdits(editsRef.current);
  }

  async function handlePhotos(files: FileList | null) {
    if (!files?.length) return;
    setMessage(null);
    const room = MAX_PHOTOS - photos.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setMessage(t("photoLimit", { max: MAX_PHOTOS }));
    setSaving("uploading");
    const added: Photo[] = [];
    for (const original of chosen) {
      // HEIC/HEIF from iPhones is converted to JPEG first.
      const prepared = await prepareImage(original);
      if (!prepared.ok) {
        setMessage(
          prepared.error === "size" ? t("photoSize") : prepared.error === "convert" ? t("photoConvert") : t("photoType"),
        );
        continue;
      }
      const uploaded = await uploadMedia(prepared.file);
      if (uploaded) added.push(uploaded);
    }
    if (added.length) updatePhotos([...photos, ...added]);
    setSaving("idle");
    if (fileInput.current) fileInput.current.value = "";
  }

  const errorFor = (field: string, line?: number) =>
    errors.filter((e) => e.field === field && (line === undefined || e.line === line));
  const fieldError = (field: string) =>
    errorFor(field).length > 0 ? "ring-2 ring-brand-red ring-offset-2" : "";

  const sopData = {
    productName: fields.product_name,
    style: isPrep ? ("PREP_MATERIAL" as const) : (fields.style || null) as FullVersion["style"],
    temperature: (fields.temperature || null) as FullVersion["temperature"],
    versionNo: version.version_no,
    yieldQuantity: isPrep ? numberOrNull(fields.yield_quantity) : null,
    yieldUnit: (fields.yield_unit || null) as MeasureUnit | null,
    appearanceNotes: fields.appearance_notes || null,
    ingredients: ingredients
      .filter((i) => i.ref)
      .map((i) => ({
        key: i.key,
        name: optionName(i.ref),
        isPrep: i.ref.startsWith("p:"),
        quantity: numberOrNull(i.quantity),
        unit: (i.unit || null) as MeasureUnit | null,
      })),
    steps: savedInstructions().map((instruction, index) => ({ key: steps[index].key, instruction, media: steps[index].media })),
    photos,
  };

  const busy = saving !== "idle";
  const completion = [
    Boolean(fields.product_name.trim()),
    isPrep || Boolean(fields.style),
    isPrep ? Boolean(fields.yield_quantity) : Boolean(fields.temperature),
    ingredients.some((i) => i.ref && i.quantity && i.unit),
    steps.some((s) => s.instruction.trim()),
    photos.length > 0,
  ];

  return (
    <div className="flex flex-col gap-6 pb-28">
      <div className="flex flex-col gap-2">
        <Link href={`/recipes/${recipeId}`} className="text-sm underline">
          {t("backToRecipe")}
        </Link>
        <h1 className="font-serif text-[32px] font-normal">{fields.product_name || t("untitled")}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-[#3d3f3a]">
          <span>{outletName}</span>
          <span>·</span>
          <span>{isPrep ? t("prep") : t("drink")}</span>
          <span>·</span>
          <span>V{version.version_no}</span>
          <StatusBadge status={version.status} />
          <span>· {t("completion", { done: completion.filter(Boolean).length, total: completion.length })}</span>
        </p>
        {props.returnReason && (
          <p className={alertClass}>
            <span className="font-semibold">{t("returnReason")}</span> {props.returnReason}
          </p>
        )}
      </div>

      {publishErrors && (
        <ul id="submit-errors" role="alert" className={`${alertClass} flex flex-col gap-1`}>
          {publishErrors.map((line, index) => (
            <li key={index} className={index === 0 ? "font-semibold" : ""}>
              {line}
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <div id="submit-errors" role="alert" className={`${alertClass} flex flex-col gap-1`}>
          <p className="font-semibold">{t("submitBlocked")}</p>
          <ul className="list-disc pl-5">
            {errors.map((e, index) => (
              <li key={index}>
                <a href={`#field-${e.field}`} className="underline">
                  {t(`errors.${e.code}`)}
                  {e.line ? ` (${t("line", { no: e.line })})` : ""}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-1 lg:hidden" role="tablist">
        {[false, true].map((preview) => (
          <button
            key={String(preview)}
            type="button"
            role="tab"
            aria-selected={showPreview === preview}
            onClick={() => setShowPreview(preview)}
            className={
              showPreview === preview
                ? "rounded-full bg-black px-4 py-2 text-sm font-semibold text-white"
                : "rounded-full px-4 py-2 text-sm hover:bg-black/10"
            }
          >
            {preview ? t("preview") : t("edit")}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div className={`flex flex-col gap-4 ${showPreview ? "hidden lg:flex" : ""}`}>
          {/* Basic Details */}
          <section className={card} aria-labelledby="sec-basic">
            <h2 id="sec-basic" className="text-base font-semibold">
              {t("sections.basic")}
            </h2>
            <label className="flex flex-col gap-1.5" id="field-product_name">
              <span className="text-sm font-semibold">{t("fields.productName")} *</span>
              <input
                value={fields.product_name}
                maxLength={80}
                onChange={(e) => setField("product_name", e.target.value)}
                className={`${inputClass} ${fieldError("product_name")}`}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{t("fields.purpose")}</span>
                <select value={fields.purpose} onChange={(e) => setField("purpose", e.target.value)} className={inputClass}>
                  <option value="RND">{t("purpose.RND")}</option>
                  <option value="OFFICIAL_RELEASE">{t("purpose.OFFICIAL_RELEASE")}</option>
                </select>
              </label>
              {!isPrep && (
                <label className="flex flex-col gap-1.5" id="field-style">
                  <span className="text-sm font-semibold">{t("fields.style")} *</span>
                  <select
                    value={fields.style}
                    onChange={(e) => setField("style", e.target.value)}
                    className={`${inputClass} ${fieldError("style")}`}
                  >
                    <option value="">—</option>
                    {props.styles.map((s) => (
                      <option key={s} value={s}>
                        {t(`style.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1.5" id="field-temperature">
                <span className="text-sm font-semibold">
                  {t("fields.temperature")}
                  {!isPrep && " *"}
                </span>
                <select
                  value={fields.temperature}
                  onChange={(e) => setField("temperature", e.target.value)}
                  className={`${inputClass} ${fieldError("temperature")}`}
                >
                  <option value="">—</option>
                  {props.temps.map((s) => (
                    <option key={s} value={s}>
                      {t(`temp.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
              {isPrep && (
                <div className="flex flex-col gap-1.5" id="field-yield_quantity">
                  <span className="text-sm font-semibold">{t("fields.yield")} *</span>
                  <div className="flex gap-2">
                    <input
                      inputMode="decimal"
                      value={fields.yield_quantity}
                      onChange={(e) => setField("yield_quantity", e.target.value)}
                      aria-label={t("fields.yield")}
                      className={`${inputClass} ${fieldError("yield_quantity")}`}
                    />
                    <select
                      value={fields.yield_unit}
                      onChange={(e) => setField("yield_unit", e.target.value)}
                      aria-label={t("fields.unit")}
                      className={`${inputClass} w-24`}
                    >
                      <option value="">—</option>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">{t("fields.changeSummary")}</span>
              <input
                value={fields.change_summary}
                onChange={(e) => setField("change_summary", e.target.value)}
                className={inputClass}
              />
            </label>
          </section>

          {/* Ingredients */}
          <section className={card} aria-labelledby="sec-ingredients" id="field-ingredients">
            <h2 id="sec-ingredients" className="text-base font-semibold">
              {t("sections.ingredients")} *
            </h2>
            <ol className="flex flex-col gap-3">
              {ingredients.map((line, index) => (
                <li
                  key={line.key}
                  ref={ingredientDrag.rowRef(index)}
                  className={`flex flex-col gap-2 rounded-[12px] border border-black/15 p-3 ${
                    errorFor("ingredients", index + 1).length ? "ring-2 ring-brand-red" : ""
                  } ${ingredientDrag.dragging === index ? "opacity-50" : ""} ${
                    ingredientDrag.over === index && ingredientDrag.dragging !== index ? "ring-2 ring-black" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      {...ingredientDrag.handleProps(index)}
                      aria-hidden
                      title={t("dragToSort")}
                      className="flex h-11 w-5 shrink-0 cursor-grab select-none items-center justify-center text-lg text-[#3d3f3a]"
                    >
                      ⠿
                    </span>
                    <span
                      className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border-[1.5px] border-black px-1 text-xs font-semibold"
                      aria-label={t("ingredientLetter", { letter: letterFor(index) })}
                    >
                      {letterFor(index)}
                    </span>
                    <select
                      value={line.ref}
                      aria-label={t("fields.ingredient")}
                      onChange={(e) =>
                        updateIngredients(ingredients.map((l) => (l.key === line.key ? { ...l, ref: e.target.value } : l)))
                      }
                      className={inputClass}
                    >
                      <option value="">{t("chooseIngredient")}</option>
                      <optgroup label={t("sharedMaterials")}>
                        {materials.map((m) => (
                          <option key={m.id} value={`m:${m.id}`}>
                            {m.name}
                            {m.approved ? "" : ` (${t("notApproved")})`}
                          </option>
                        ))}
                      </optgroup>
                      {preps.length > 0 && (
                        <optgroup label={t("outletPreps")}>
                          {preps.map((p) => (
                            <option key={p.id} value={`p:${p.id}`}>
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-[3.25rem]">
                    <input
                      inputMode="decimal"
                      value={line.quantity}
                      placeholder={t("fields.quantity")}
                      aria-label={t("fields.quantity")}
                      onChange={(e) =>
                        updateIngredients(
                          ingredients.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value.replace(",", ".") } : l)),
                        )
                      }
                      className={`${inputClass} w-28`}
                    />
                    <select
                      value={line.unit}
                      aria-label={t("fields.unit")}
                      onChange={(e) =>
                        updateIngredients(
                          ingredients.map((l) => (l.key === line.key ? { ...l, unit: e.target.value as MeasureUnit } : l)),
                        )
                      }
                      className={`${inputClass} w-20`}
                    >
                      <option value="">—</option>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <span className="ml-auto flex gap-1">
                      <button type="button" className={smallButton} aria-label={t("moveUp")} disabled={index === 0} onClick={() => updateIngredients(move(ingredients, index, -1))}>
                        ↑
                      </button>
                      <button type="button" className={smallButton} aria-label={t("moveDown")} disabled={index === ingredients.length - 1} onClick={() => updateIngredients(move(ingredients, index, 1))}>
                        ↓
                      </button>
                      <button type="button" className={smallButton} aria-label={t("remove")} onClick={() => updateIngredients(ingredients.filter((l) => l.key !== line.key))}>
                        ✕
                      </button>
                    </span>
                  </div>
                  {errorFor("ingredients", index + 1).map((e, i) => (
                    <p key={i} className="pl-[3.25rem] text-sm font-semibold">
                      {t(`errors.${e.code}`)}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => updateIngredients([...ingredients, { key: newKey(), ref: "", quantity: "", unit: "", notes: "" }])}
            >
              {t("addIngredient")}
            </button>

            <h3 className="pt-2 text-sm font-semibold" id="field-packaging">
              {t("packaging")}
            </h3>
            {packaging.map((line, index) => (
              <div key={line.key} className="flex flex-wrap items-center gap-2">
                <select
                  value={line.itemId}
                  aria-label={t("packaging")}
                  onChange={(e) => updatePackaging(packaging.map((l) => (l.key === line.key ? { ...l, itemId: e.target.value } : l)))}
                  className={`${inputClass} min-w-0 flex-1 basis-48 ${errorFor("packaging", index + 1).length ? "ring-2 ring-brand-red" : ""}`}
                >
                  <option value="">—</option>
                  {packagingItems.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.approved ? "" : ` (${t("notApproved")})`}
                    </option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  value={line.pieces}
                  aria-label={t("pieces")}
                  placeholder={t("pieces")}
                  onChange={(e) => updatePackaging(packaging.map((l) => (l.key === line.key ? { ...l, pieces: e.target.value } : l)))}
                  className={`${inputClass} w-24`}
                />
                <button type="button" className={smallButton} aria-label={t("remove")} onClick={() => updatePackaging(packaging.filter((l) => l.key !== line.key))}>
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className={secondaryButton}
              onClick={() => updatePackaging([...packaging, { key: newKey(), itemId: "", pieces: "1" }])}
            >
              {t("addPackaging")}
            </button>
          </section>

          {/* Processing Method */}
          <section className={`${card} ${fieldError("steps")}`} aria-labelledby="sec-method" id="field-steps">
            <h2 id="sec-method" className="text-base font-semibold">
              {t("sections.method")} *
            </h2>
            <ol className="flex flex-col gap-3">
              {steps.map((step, index) => (
                <li
                  key={step.key}
                  ref={stepDrag.rowRef(index)}
                  className={`flex flex-col gap-2 rounded-[12px] border border-black/15 p-3 ${
                    stepDrag.dragging === index ? "opacity-50" : ""
                  } ${stepDrag.over === index && stepDrag.dragging !== index ? "ring-2 ring-black" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      {...stepDrag.handleProps(index)}
                      aria-hidden
                      title={t("dragToSort")}
                      className="flex h-11 w-5 shrink-0 cursor-grab select-none items-center justify-center text-lg text-[#3d3f3a]"
                    >
                      ⠿
                    </span>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <span className="ml-auto flex gap-1">
                      <button type="button" className={smallButton} aria-label={t("moveUp")} disabled={index === 0} onClick={() => updateSteps(move(steps, index, -1))}>
                        ↑
                      </button>
                      <button type="button" className={smallButton} aria-label={t("moveDown")} disabled={index === steps.length - 1} onClick={() => updateSteps(move(steps, index, 1))}>
                        ↓
                      </button>
                      <button
                        type="button"
                        className={smallButton}
                        aria-label={t("remove")}
                        onClick={() => {
                          setRemovedStep({ step, index });
                          updateSteps(steps.filter((s) => s.key !== step.key));
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  <textarea
                    id={`step-${step.key}`}
                    value={step.instruction}
                    aria-label={t("stepLabel", { no: index + 1 })}
                    onChange={(e) => updateSteps(steps.map((s) => (s.key === step.key ? { ...s, instruction: e.target.value } : s)))}
                    className={textareaClass}
                  />
                  <div className="flex flex-col gap-2">
                    {step.media && <StepMediaView media={step.media} stepNo={index + 1} />}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className={`${smallButton} cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
                        {step.media ? t("stepMediaReplace") : t("stepMediaAdd")}
                        <input
                          type="file"
                          accept={STEP_MEDIA_ACCEPT}
                          className="sr-only"
                          disabled={busy}
                          onChange={(e) => handleStepMedia(step.key, e.currentTarget)}
                        />
                      </label>
                      {step.media && (
                        <button
                          type="button"
                          className={smallButton}
                          onClick={() => updateSteps(steps.map((s) => (s.key === step.key ? { ...s, media: null } : s)))}
                        >
                          {t("stepMediaRemove")}
                        </button>
                      )}
                    </div>
                    <p className="text-[13px] text-[#3d3f3a]">{t("stepMediaRules")}</p>
                  </div>
                  {ingredients.some((i) => i.ref) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] text-[#3d3f3a]">{t("insertIngredient")}</span>
                      {ingredients.map((line, i) =>
                        line.ref ? (
                          <button
                            key={line.key}
                            type="button"
                            title={optionName(line.ref)}
                            aria-label={t("insertLetter", { letter: letterFor(i), name: optionName(line.ref) })}
                            onClick={() => insertReference(step.key, letterFor(i))}
                            className="flex h-8 min-w-8 items-center justify-center rounded-md border-[1.5px] border-black px-1.5 text-xs font-semibold hover:bg-black hover:text-white"
                          >
                            {letterFor(i)}
                          </button>
                        ) : null,
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {removedStep && (
              <p className="flex items-center gap-2 text-sm">
                {t("stepRemoved")}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => {
                    const next = [...steps];
                    next.splice(Math.min(removedStep.index, next.length), 0, removedStep.step);
                    updateSteps(next);
                    setRemovedStep(null);
                  }}
                >
                  {t("undo")}
                </button>
              </p>
            )}
            <button
              type="button"
              className={secondaryButton}
              onClick={() => updateSteps([...steps, { key: newKey(), instruction: "", media: null }])}
            >
              {t("addStep")}
            </button>
          </section>

          {/* Appearance */}
          <section className={`${card} ${fieldError("photos")}`} aria-labelledby="sec-appearance" id="field-photos">
            <h2 id="sec-appearance" className="text-base font-semibold">
              {t("sections.appearance")} *
            </h2>
            <p className="text-[13px] text-[#3d3f3a]">{t("photoRules", { max: MAX_PHOTOS })}</p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((photo, index) => (
                <li key={photo.id} className="flex flex-col gap-1.5">
                  {photo.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
                    <img src={photo.url} alt={t("photoAlt", { no: index + 1 })} className="aspect-square w-full rounded-[10px] object-cover" />
                  ) : (
                    <div className="aspect-square w-full rounded-[10px] bg-[#eceee8]" />
                  )}
                  <span className="flex gap-1">
                    <button type="button" className={smallButton} aria-label={t("moveUp")} disabled={index === 0} onClick={() => updatePhotos(move(photos, index, -1))}>
                      ←
                    </button>
                    <button type="button" className={smallButton} aria-label={t("moveDown")} disabled={index === photos.length - 1} onClick={() => updatePhotos(move(photos, index, 1))}>
                      →
                    </button>
                    <button type="button" className={smallButton} aria-label={t("remove")} onClick={() => updatePhotos(photos.filter((p) => p.id !== photo.id))}>
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {photos.length < MAX_PHOTOS && (
              <label className={`${secondaryButton} cursor-pointer`}>
                {saving === "uploading" ? t("uploading") : t("addPhoto")}
                <input
                  ref={fileInput}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  multiple
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => handlePhotos(e.target.files)}
                />
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">{t("fields.appearanceNotes")}</span>
              <textarea
                value={fields.appearance_notes}
                onChange={(e) => setField("appearance_notes", e.target.value)}
                className={textareaClass}
              />
            </label>
          </section>

          {/* Supplementary */}
          <details className={card}>
            <summary className="cursor-pointer text-base font-semibold">{t("sections.more")}</summary>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-semibold">{t("fields.taste")}</legend>
              <p className="text-[13px] text-[#3d3f3a]">{t("tasteHint")}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {TASTES.map((k) => (
                  <label key={k} className="flex flex-col gap-1">
                    <span className="text-sm">{t(`taste.${k}`)}</span>
                    <select
                      value={tastes[k]}
                      onChange={(e) => change(setTastes)({ ...tastes, [k]: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">{t("notAssessed")}</option>
                      {Array.from({ length: 11 }, (_, n) => n).map((n) => (
                        <option key={n} value={n}>
                          {t(`strength.${n}`) === String(n) ? n : `${n} · ${t(`strength.${n}`)}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              {TEXT_FIELDS.map((f) => (
                <label key={f} className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold">{t(`fields.${f}`)}</span>
                  <input value={fields[f]} onChange={(e) => setField(f, e.target.value)} className={inputClass} />
                </label>
              ))}
            </div>
          </details>
        </div>

        <aside className={`flex flex-col gap-4 lg:sticky lg:top-4 ${showPreview ? "" : "hidden lg:flex"}`}>
          <SopView data={sopData} draft />
          <CostSummary cost={cost} title={t("estimatedCost")} />
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-black/15 bg-brand-base/95 px-4 py-3 backdrop-blur md:left-60 md:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm" aria-live="polite">
            {saving === "saving" || saving === "submitting"
              ? t("saving")
              : message
                ? message
                : dirty
                  ? t("unsaved")
                  : savedAt
                    ? t("savedAt", { time: savedAt.toLocaleTimeString() })
                    : ""}
          </p>
          <button type="button" className={secondaryButton} disabled={busy} onClick={handleSave}>
            {t("saveDraft")}
          </button>
          {adminDirect ? (
            <button type="button" className={primaryButton} disabled={busy} onClick={handlePublish}>
              {t("saveAndApply")}
            </button>
          ) : (
            <button type="button" className={primaryButton} disabled={busy} onClick={handleSubmit}>
              {t("submit")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
