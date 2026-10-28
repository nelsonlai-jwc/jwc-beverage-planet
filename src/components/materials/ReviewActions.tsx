"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  review,
  reviewChangeRequest,
  type ActionResult,
  type ReviewKind,
} from "@/app/[locale]/(app)/raw-materials/actions";
import { useRouter } from "@/i18n/navigation";
import { errorClass, inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";

export function useAction() {
  const t = useTranslations("RawMaterials");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t("errors.UNKNOWN"));
        return;
      }
      onDone?.();
      router.refresh();
    });
  }
  return { error, pending, run };
}

/** Admin: Approve, or Return with a reason (ch. 19.3). "change" is an edit or delete request. */
export function ReviewActions({ kind, id }: { kind: ReviewKind | "change"; id: string }) {
  const t = useTranslations("RawMaterials.review");
  const { error, pending, run } = useAction();
  const decide = (decision: "approve" | "return", reason = "") =>
    kind === "change" ? reviewChangeRequest(id, decision, reason) : review(kind, id, decision, reason);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="flex flex-col gap-3">
      {returning ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`reason-${id}`} className="text-sm font-semibold">
            {t("reason")}
          </label>
          <textarea
            id={`reason-${id}`}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-[10px] border-[1.5px] border-black bg-white px-3.5 py-3 text-base"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => run(() => decide("return", reason), () => setReturning(false))}
              className={primaryButtonClass}
            >
              {t("confirmReturn")}
            </button>
            <button type="button" onClick={() => setReturning(false)} className={secondaryButtonClass}>
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => decide("approve"))}
            className={primaryButtonClass}
          >
            {t("approve")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setReturning(true)}
            className={secondaryButtonClass}
          >
            {t("return")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Sends a draft or returned item for approval. */
export function SubmitButton({
  id,
  action,
}: {
  id: string;
  action: (id: string) => Promise<ActionResult>;
}) {
  const t = useTranslations("RawMaterials.form");
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => action(id))}
        className={primaryButtonClass}
      >
        {pending ? t("saving") : t("submit")}
      </button>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * New price for an approved pack or packaging item: shows old, new and the change
 * before sending it for approval. The current price stays in effect until then.
 */
export function PriceChangeForm({
  id,
  oldPrice,
  affected,
  submit,
}: {
  id: string;
  oldPrice: number | null;
  affected: number;
  submit: (id: string, amount: string, freeReason: string) => Promise<ActionResult>;
}) {
  const t = useTranslations("RawMaterials.priceChange");
  const { error, pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [freeReason, setFreeReason] = useState("");

  const newPrice = /^\d+(\.\d+)?$/.test(amount) ? Number(amount) : null;
  const change =
    newPrice !== null && oldPrice !== null && oldPrice > 0
      ? ((newPrice - oldPrice) / oldPrice) * 100
      : null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        {t("open")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-brand-base/60 p-4">
      <p className="text-[13px] font-semibold">{t("notice")}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`price-${id}`} className="text-sm font-semibold">
          {t("newPrice")}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">RM</span>
          <input
            id={`price-${id}`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(",", "."))}
            className={inputClass}
          />
        </div>
      </div>
      {newPrice === 0 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`free-${id}`} className="text-sm font-semibold">
            {t("freeReason")}
          </label>
          <input
            id={`free-${id}`}
            value={freeReason}
            onChange={(event) => setFreeReason(event.target.value)}
            className={inputClass}
          />
        </div>
      )}
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-[#3d3f3a]">{t("old")}</dt>
          <dd className="font-semibold tabular-nums">{oldPrice !== null ? `RM${oldPrice.toFixed(2)}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[#3d3f3a]">{t("new")}</dt>
          <dd className="font-semibold tabular-nums">{newPrice !== null ? `RM${newPrice.toFixed(2)}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[#3d3f3a]">{t("change")}</dt>
          <dd className="font-semibold tabular-nums">
            {change !== null ? `${change > 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}
          </dd>
        </div>
      </dl>
      <p className="text-[13px] text-[#3d3f3a]">{t("affected", { count: affected })}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || newPrice === null}
          onClick={() => run(() => submit(id, amount, freeReason), () => setOpen(false))}
          className={primaryButtonClass}
        >
          {t("submit")}
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
