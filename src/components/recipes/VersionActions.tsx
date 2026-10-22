"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ApprovalStatus } from "@/lib/recipes/types";
import { alertClass, primaryButton, secondaryButton } from "./ui";

type Props = {
  recipeId: string;
  open: { id: string; status: ApprovalStatus; versionNo: number; submittedByMe: boolean } | null;
  hasApproved: boolean;
  canReview: boolean;
};

export function VersionActions({ recipeId, open, hasApproved, canReview }: Props) {
  const t = useTranslations("Recipes");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>, after?: () => void) {
    setPending(true);
    setError(null);
    const { error: rpcError } = await action();
    setPending(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (after) after();
    else router.refresh();
  }

  const supabase = createClient();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {open && (open.status === "DRAFT" || open.status === "RETURNED") && (
          <Link href={`/recipes/${recipeId}/edit`} className={primaryButton}>
            {t("editDraft")}
          </Link>
        )}
        {open?.status === "PENDING" && open.submittedByMe && (
          <button
            type="button"
            disabled={pending}
            className={secondaryButton}
            onClick={() => run(() => supabase.rpc("withdraw_recipe_version", { p_version_id: open.id }))}
          >
            {t("withdraw")}
          </button>
        )}
        {open?.status === "PENDING" && canReview && (
          <Link href={`/recipes/${recipeId}/review`} className={primaryButton}>
            {t("review")}
          </Link>
        )}
        {!open && hasApproved && (
          <button
            type="button"
            disabled={pending}
            className={primaryButton}
            onClick={() =>
              run(
                () => supabase.rpc("create_recipe_version", { p_recipe_id: recipeId }),
                () => router.push(`/recipes/${recipeId}/edit`),
              )
            }
          >
            {t("newVersion")}
          </button>
        )}
        {open?.status === "DRAFT" && (
          <button
            type="button"
            disabled={pending}
            className={secondaryButton}
            onClick={() => {
              if (!window.confirm(t("deleteDraftConfirm"))) return;
              // A recipe that was never approved goes with its only draft.
              run(
                () =>
                  hasApproved
                    ? supabase.from("recipe_versions").delete().eq("id", open.id)
                    : supabase.from("recipes").delete().eq("id", recipeId),
                () => (hasApproved ? router.refresh() : router.push("/recipes")),
              );
            }}
          >
            {t("deleteDraft")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={alertClass}>
          {t("actionFailed")} {error}
        </p>
      )}
    </div>
  );
}
