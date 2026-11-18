"use client";

import { Bug, Lightbulb, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import {
  cardClass,
  errorText,
  inputClass,
  labelClass,
  mutedText,
  primaryButton,
  secondaryButton,
} from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { submitFeedback } from "@/app/[locale]/(app)/feedback/actions";
import {
  FEEDBACK_BUCKET,
  MAX_DESCRIPTION,
  MAX_FEEDBACK_PHOTOS,
  MAX_TITLE,
  type FeedbackDevice,
  type FeedbackKind,
} from "@/lib/feedback/types";
import { prepareImage } from "@/lib/media/prepareImage";
import { createClient } from "@/lib/supabase/client";

type Photo = { path: string; preview: string };

function currentDevice(): FeedbackDevice {
  const width = window.innerWidth;
  if (width < 640) return "PHONE";
  if (width < 1024) return "TABLET";
  return "DESKTOP";
}

/** New bug report or idea, with up to 5 photos uploaded to the user's own folder. */
export function FeedbackForm({ userId, fromPath }: { userId: string; fromPath: string | null }) {
  const t = useTranslations("Feedback");
  const locale = useLocale();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<FeedbackKind>("BUG");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = MAX_FEEDBACK_PHOTOS - photos.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setError(t("errors.tooManyPhotos", { max: MAX_FEEDBACK_PHOTOS }));
    setUploading(true);
    try {
      const supabase = createClient();
      for (const original of chosen) {
        const prepared = await prepareImage(original);
        if (!prepared.ok) {
          setError(t(`errors.photo.${prepared.error}`));
          continue;
        }
        const file = prepared.file;
        const path = `${userId}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
        const upload = await supabase.storage.from(FEEDBACK_BUCKET).upload(path, file, { contentType: file.type });
        if (upload.error) {
          setError(t("errors.photo.upload"));
          continue;
        }
        const photo = { path, preview: URL.createObjectURL(file) };
        setPhotos((list) => [...list, photo]);
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const result = await submitFeedback({
      kind,
      title,
      description,
      pageUrl: fromPath,
      locale,
      device: currentDevice(),
      userAgent: navigator.userAgent,
      photoPaths: photos.map((p) => p.path),
    });
    if (!result.ok) {
      setSaving(false);
      setError(t(`errors.${result.error}`));
      return;
    }
    toast("reported");
    router.push("/feedback");
    router.refresh();
  }

  const kinds: { value: FeedbackKind; icon: typeof Bug }[] = [
    { value: "BUG", icon: Bug },
    { value: "IDEA", icon: Lightbulb },
  ];

  return (
    <form onSubmit={submit} className={`${cardClass} flex max-w-2xl flex-col gap-5`}>
      <fieldset className="flex flex-col gap-2">
        <legend className={`${labelClass} mb-2`}>{t("form.kind")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {kinds.map(({ value, icon: Icon }) => (
            <label
              key={value}
              className={`flex cursor-pointer flex-col gap-1 rounded-2xl border-[1.5px] p-3 ${kind === value ? "border-black bg-black text-white" : "border-black/25 hover:border-black"}`}
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={16} aria-hidden />
                {t(`kind.${value}`)}
              </span>
              <span className={`text-[13px] ${kind === value ? "text-white/80" : "text-[#3d3f3a]"}`}>
                {t(`kindHint.${value}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("form.title")}</span>
        <input
          className={inputClass}
          value={title}
          maxLength={MAX_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t(`form.titlePlaceholder.${kind}`)}
          required
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("form.description")}</span>
        <textarea
          className={`${inputClass} h-auto min-h-36 py-2`}
          value={description}
          maxLength={MAX_DESCRIPTION}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t(`form.descriptionPlaceholder.${kind}`)}
          required
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className={labelClass}>
          {t("form.photos")} ({photos.length}/{MAX_FEEDBACK_PHOTOS})
        </span>
        {photos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {photos.map((photo) => (
              <li key={photo.path} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local previews */}
                <img src={photo.preview} alt="" className="h-24 w-24 rounded-[14px] object-cover" />
                <button
                  type="button"
                  aria-label={t("form.removePhoto")}
                  onClick={() => setPhotos((list) => list.filter((p) => p.path !== photo.path))}
                  className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-black text-white"
                >
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {photos.length < MAX_FEEDBACK_PHOTOS && (
          <label className={`${secondaryButton} w-fit cursor-pointer`}>
            {uploading ? t("form.uploading") : t("form.addPhotos")}
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => addPhotos(e.target.files)}
            />
          </label>
        )}
        <p className={mutedText}>{t("form.photosHint", { max: MAX_FEEDBACK_PHOTOS })}</p>
      </div>

      {fromPath && (
        <p className={mutedText}>
          {t("form.page")}: <span className="break-all font-mono text-[12px]">{fromPath}</span>
        </p>
      )}

      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryButton} disabled={saving || uploading}>
          {saving ? t("form.sending") : t("form.send")}
        </button>
        <button type="button" className={secondaryButton} onClick={() => router.back()} disabled={saving}>
          {t("form.cancel")}
        </button>
      </div>
    </form>
  );
}
