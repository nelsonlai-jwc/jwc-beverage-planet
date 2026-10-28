"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  archiveItem,
  deleteDraft,
  restoreItem,
} from "@/app/[locale]/(app)/raw-materials/actions";
import { useRouter } from "@/i18n/navigation";
import { errorClass, primaryButtonClass, secondaryButtonClass } from "./ui";

type Entity = "MATERIAL" | "PACKAGING_ITEM";

/**
 * Delete for a never-submitted draft, otherwise archive ("delete" that keeps history).
 * An Admin archives an approved item at once; a Manager sends a request with a reason.
 */
export function DeleteButton({
  entity,
  id,
  mode,
  listHref,
}: {
  entity: Entity;
  id: string;
  mode: "delete" | "archive" | "request";
  listHref: string;
}) {
  const t = useTranslations("RawMaterials.remove");
  const te = useTranslations("RawMaterials.errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = mode === "delete" ? await deleteDraft(entity, id) : await archiveItem(entity, id, reason);
      if (!result.ok) {
        setError(te.has(result.error) ? te(result.error) : te("UNKNOWN"));
        return;
      }
      if ("outcome" in result && result.outcome === "REQUESTED") {
        setOpen(false);
        setNotice(t("requested"));
        router.refresh();
        return;
      }
      router.push(listHref);
      router.refresh();
    });
  }

  if (notice) return <p role="status" className="text-sm font-semibold">{notice}</p>;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        {mode === "request" ? t("request") : t("delete")}
      </button>
    );
  }

  return (
    <div role="dialog" aria-label={t("delete")} className="flex w-full flex-col gap-3 rounded-[20px] border-[1.5px] border-black bg-white p-5">
      <p className="text-sm font-semibold">
        {mode === "delete" ? t("deleteNote") : mode === "archive" ? t("archiveNote") : t("requestNote")}
      </p>
      {mode !== "delete" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`archive-${id}`} className="text-sm font-semibold">
            {mode === "request" ? t("reason") : t("reasonOptional")}
          </label>
          <textarea
            id={`archive-${id}`}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-[10px] border-[1.5px] border-black bg-white px-3.5 py-3 text-base"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || (mode === "request" && !reason.trim())}
          onClick={confirm}
          className={primaryButtonClass}
        >
          {mode === "delete" ? t("confirmDelete") : mode === "archive" ? t("confirmArchive") : t("confirmRequest")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          {t("cancel")}
        </button>
      </div>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}

export function RestoreButton({ entity, id }: { entity: Entity; id: string }) {
  const t = useTranslations("RawMaterials.remove");
  const te = useTranslations("RawMaterials.errors");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        className={primaryButtonClass}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await restoreItem(entity, id);
            if (!result.ok) {
              setError(te.has(result.error) ? te(result.error) : te("UNKNOWN"));
              return;
            }
            router.refresh();
          })
        }
      >
        {t("restore")}
      </button>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
