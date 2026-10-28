"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { prepareImage } from "@/lib/media/prepareImage";
import { createClient } from "@/lib/supabase/client";
import { errorClass, labelClass, secondaryButtonClass } from "./ui";

const BUCKET = "recipe-media";

/** One optional product photo, stored under materials/ in the private media bucket. */
export function PhotoField({
  assetId,
  url,
  onChange,
}: {
  assetId: string | null;
  url: string | null;
  onChange: (assetId: string | null) => void;
}) {
  const t = useTranslations("RawMaterials.photo");
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(files: FileList | null) {
    const chosen = files?.[0];
    if (!chosen) return;
    setError(null);
    setBusy(true);
    try {
      const prepared = await prepareImage(chosen);
      if (!prepared.ok) {
        setError(t(`errors.${prepared.error}`));
        return;
      }
      const file = prepared.file;
      const supabase = createClient();
      const id = crypto.randomUUID();
      const path = `materials/${id}.${file.type.split("/")[1]}`;
      const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (upload.error) {
        setError(t("errors.upload"));
        return;
      }
      // No .select(): the new row is not visible to the select policy within the insert.
      const insert = await supabase.from("media_assets").insert({
        id,
        bucket: BUCKET,
        object_path: path,
        mime_type: file.type,
        size_bytes: file.size,
        upload_status: "READY",
      });
      if (insert.error) {
        setError(t("errors.upload"));
        return;
      }
      setPreview(URL.createObjectURL(file));
      onChange(id);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className={labelClass}>{t("label")}</span>
      {preview && assetId && (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs and local previews
        <img src={preview} alt={t("alt")} className="h-40 w-40 rounded-[14px] object-cover" />
      )}
      <div className="flex flex-wrap gap-2">
        <label className={`${secondaryButtonClass} cursor-pointer`}>
          {busy ? t("uploading") : assetId ? t("replace") : t("add")}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            className="sr-only"
            disabled={busy}
            onChange={(event) => choose(event.target.files)}
          />
        </label>
        {assetId && (
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              setPreview(null);
              onChange(null);
            }}
          >
            {t("remove")}
          </button>
        )}
      </div>
      <p className="text-[13px] text-[#3d3f3a]">{t("hint")}</p>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
