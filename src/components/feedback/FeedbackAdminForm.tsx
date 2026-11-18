"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { cardClass, errorText, inputClass, labelClass, mutedText, primaryButton } from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import { updateFeedback } from "@/app/[locale]/(app)/feedback/actions";
import {
  FEEDBACK_PRIORITIES,
  FEEDBACK_STATUSES,
  MAX_NOTE,
  MAX_REPLY,
  REJECT_REASONS,
  type FeedbackKind,
  type FeedbackPriority,
  type FeedbackStatus,
} from "@/lib/feedback/types";
import { CopyForClaudeButton } from "./CopyForClaudeButton";

const choice = (active: boolean) =>
  `inline-flex h-8 items-center gap-1 rounded-full border px-3.5 text-[13px] font-semibold ${
    active ? "border-black bg-black text-white" : "border-black/25 bg-white text-black/80 hover:border-black"
  }`;

/** Super Admin: status, one-tap reasons when not taking it up, reply, and the internal priority + note. */
export function FeedbackAdminForm({
  id,
  kind,
  status: initialStatus,
  reply: initialReply,
  rejectReasons: initialReasons,
  priority: initialPriority,
  note: initialNote,
}: {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  reply: string;
  rejectReasons: string[];
  priority: FeedbackPriority | null;
  note: string;
}) {
  const t = useTranslations("Feedback");
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [reasons, setReasons] = useState<string[]>(initialReasons);
  const [reply, setReply] = useState(initialReply);
  const [priority, setPriority] = useState<FeedbackPriority | null>(initialPriority);
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleReason = (reason: string) =>
    setReasons((list) => (list.includes(reason) ? list.filter((r) => r !== reason) : [...list, reason]));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const result = await updateFeedback(id, { status, reply, rejectReasons: reasons, priority, note });
    setSaving(false);
    if (!result.ok) {
      setError(t(`errors.${result.error}`));
      return;
    }
    toast("saved");
    router.refresh();
  }

  return (
    <form onSubmit={save} className={`${cardClass} flex flex-col gap-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("manage")}</h2>
        <CopyForClaudeButton ids={[id]} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={`${labelClass} mb-2`}>{t("statusLabel")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={status === s} className={choice(status === s)} onClick={() => setStatus(s)}>
              {t(`status.${s}`)}
            </button>
          ))}
        </div>
      </fieldset>

      {status === "REJECTED" && (
        <fieldset className="flex flex-col gap-2">
          <legend className={`${labelClass} mb-1`}>{t("rejectReasonsLabel")}</legend>
          <p className={mutedText}>{t("rejectReasonsHint")}</p>
          <ul className="flex flex-col gap-1.5">
            {REJECT_REASONS[kind].map((reason) => {
              const on = reasons.includes(reason);
              return (
                <li key={reason}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleReason(reason)}
                    className={`flex w-full items-start gap-2.5 rounded-2xl border-[1.5px] p-3 text-left ${on ? "border-black bg-black text-white" : "border-black/20 bg-white hover:border-black"}`}
                  >
                    <span
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${on ? "border-white bg-white text-black" : "border-black/40"}`}
                    >
                      {on && <Check size={13} strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold">{t(`reasons.${reason}.label`)}</span>
                      <span className={`text-[13px] ${on ? "text-white/80" : "text-[#3d3f3a]"}`}>
                        {t(`reasons.${reason}.text`)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("replyLabel")}</span>
        <textarea
          className={`${inputClass} h-auto min-h-20 py-2`}
          value={reply}
          maxLength={MAX_REPLY}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t("replyPlaceholder")}
        />
      </label>

      <div className="flex flex-col gap-4 rounded-2xl bg-[#eceee8] p-4">
        <p className="text-[13px] font-semibold text-[#3d3f3a]">{t("internalTitle")}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className={`${labelClass} mb-2`}>{t("priorityLabel")}</legend>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={priority === null} className={choice(priority === null)} onClick={() => setPriority(null)}>
              {t("priorityNone")}
            </button>
            {FEEDBACK_PRIORITIES.map((p) => (
              <button key={p} type="button" aria-pressed={priority === p} className={choice(priority === p)} onClick={() => setPriority(p)}>
                {t(`priority.${p}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>{t("noteLabel")}</span>
          <textarea
            className={`${inputClass} h-auto min-h-20 py-2`}
            value={note}
            maxLength={MAX_NOTE}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
          />
        </label>
      </div>

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
