import { useTranslations } from "next-intl";
import type { ApprovalStatus, RecipePurpose } from "@/lib/recipes/types";

// Shared Tailwind classes for recipe screens, matching the app shell cards.
export const card = "flex flex-col gap-4 rounded-[20px] bg-white p-5 sm:p-6";
export const inputClass =
  "h-11 w-full rounded-[10px] border-[1.5px] border-black bg-white px-3 text-base disabled:bg-[#eceee8]";
export const textareaClass =
  "min-h-20 w-full rounded-[10px] border-[1.5px] border-black bg-white px-3 py-2 text-base";
export const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-black px-5 text-sm font-semibold text-white disabled:opacity-50";
export const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border-[1.5px] border-black px-5 text-sm font-semibold disabled:opacity-50";
export const smallButton =
  "inline-flex min-h-9 min-w-9 items-center justify-center rounded-full border-[1.5px] border-black px-3 text-sm disabled:opacity-40";

const statusColors: Record<ApprovalStatus, string> = {
  DRAFT: "bg-[#eceee8]",
  PENDING: "bg-brand-orange",
  RETURNED: "bg-brand-red",
  APPROVED: "bg-brand-green",
  SUPERSEDED: "bg-[#eceee8]",
  ARCHIVED: "bg-[#eceee8]",
};

export function StatusBadge({ status }: { status: ApprovalStatus }) {
  const t = useTranslations("Recipes.status");
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColors[status]}`}>
      {t(status)}
    </span>
  );
}

export function PurposeBadge({ purpose }: { purpose: RecipePurpose }) {
  const t = useTranslations("Recipes.purpose");
  return (
    <span
      className={`inline-flex rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-semibold ${
        purpose === "RND" ? "border-brand-purple bg-brand-purple/15" : "border-black"
      }`}
    >
      {t(purpose)}
    </span>
  );
}

export const alertClass = "rounded-[10px] bg-brand-red/20 px-3 py-2 text-sm";
