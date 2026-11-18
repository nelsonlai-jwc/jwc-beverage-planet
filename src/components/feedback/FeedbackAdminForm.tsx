"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { cardClass, errorText, inputClass, labelClass, primaryButton } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { updateFeedback } from "@/app/[locale]/(app)/feedback/actions";
import { FEEDBACK_STATUSES, MAX_REPLY, type FeedbackStatus } from "@/lib/feedback/types";

/** Super Admin: set the status and write the reply the submitter sees. */
export function FeedbackAdminForm({
  id,
  status: initialStatus,
  reply: initialReply,
}: {
  id: string;
  status: FeedbackStatus;
  reply: string;
}) {
  const t = useTranslations("Feedback");
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [reply, setReply] = useState(initialReply);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const result = await updateFeedback(id, { status, reply });
    setSaving(false);
    if (!result.ok) {
      setError(t(`errors.${result.error}`));
      return;
    }
    toast("saved");
    router.refresh();
  }

  return (
    <form onSubmit={save} className={`${cardClass} flex flex-col gap-4`}>
      <h2 className="text-lg font-semibold">{t("manage")}</h2>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("statusLabel")}</span>
        <select
          className={`${inputClass} sm:max-w-xs`}
          value={status}
          onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
        >
          {FEEDBACK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("replyLabel")}</span>
        <textarea
          className={`${inputClass} h-auto min-h-24 py-2`}
          value={reply}
          maxLength={MAX_REPLY}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t("replyPlaceholder")}
        />
      </label>
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
      <button type="submit" className={`${primaryButton} w-fit`} disabled={saving}>
        {saving ? t("saving") : t("save")}
      </button>
    </form>
  );
}
