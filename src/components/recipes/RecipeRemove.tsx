"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { archiveRecipe, restoreRecipe, type RecipeActionResult } from "@/app/[locale]/(app)/recipes/actions";
import { useRouter } from "@/i18n/navigation";
import { alertClass, primaryButton, secondaryButton, textareaClass } from "./ui";

function useRecipeAction() {
  const t = useTranslations("Recipes.actionErrors");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<RecipeActionResult>, onDone: (result: RecipeActionResult) => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(t.has(result.error) ? t(result.error) : `${t("UNKNOWN")} ${result.message ?? ""}`);
        return;
      }
      onDone(result);
    });
  }
  return { error, pending, run };
}

/**
 * "Delete" of a recipe that was submitted at least once: it is archived, keeping its
 * history. An Admin (or the outlet's Manager, while nothing is approved) archives at
 * once; a Manager asks the Admin, with a reason, to archive an approved recipe.
 */
export function ArchiveRecipeButton({ recipeId, mode }: { recipeId: string; mode: "archive" | "request" }) {
  const t = useTranslations("Recipes.archive");
  const router = useRouter();
  const { error, pending, run } = useRecipeAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  if (notice) return <p role="status" className="text-sm font-semibold">{notice}</p>;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${secondaryButton} self-start`}>
        {mode === "request" ? t("request") : t("delete")}
      </button>
    );
  }

  return (
    <div role="dialog" aria-label={t("delete")} className="flex flex-col gap-3 rounded-[12px] border-[1.5px] border-black p-4">
      <p className="text-sm font-semibold">{mode === "archive" ? t("archiveNote") : t("requestNote")}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">{mode === "request" ? t("reason") : t("reasonOptional")}</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={pending || (mode === "request" && !reason.trim())}
          onClick={() =>
            run(
              () => archiveRecipe(recipeId, reason),
              (result) => {
                if (result.ok && result.outcome === "REQUESTED") {
                  setNotice(t("requested"));
                  router.refresh();
                } else {
                  router.push("/recipes");
                }
              },
            )
          }
        >
          {mode === "archive" ? t("confirmArchive") : t("confirmRequest")}
        </button>
        <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>
          {t("cancel")}
        </button>
      </div>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
    </div>
  );
}

export function RestoreRecipeButton({ recipeId }: { recipeId: string }) {
  const t = useTranslations("Recipes.archive");
  const router = useRouter();
  const { error, pending, run } = useRecipeAction();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={`${primaryButton} self-start`}
        disabled={pending}
        onClick={() => run(() => restoreRecipe(recipeId), () => router.refresh())}
      >
        {t("restore")}
      </button>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
    </div>
  );
}
