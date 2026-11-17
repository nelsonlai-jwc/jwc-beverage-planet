import { useTranslations } from "next-intl";
import type { ApprovalStatus, RecipePurpose } from "@/lib/recipes/types";

// Shared Tailwind classes for recipe screens, matching the app shell cards.
export const card = "flex flex-col gap-4 rounded-[20px] bg-white p-4 sm:p-5";
export const inputClass =
  "h-10 w-full min-w-0 rounded-xl border border-black/35 bg-white px-3 text-base focus:border-black focus:outline-none disabled:bg-[#eceee8]";
export const textareaClass =
  "min-h-20 w-full rounded-xl border border-black/35 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
export const primaryButton =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-black px-5 text-sm font-medium text-white hover:bg-black/85 disabled:opacity-50";
export const secondaryButton =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-black bg-white px-4 text-sm font-medium hover:bg-black/5 disabled:opacity-50";
export const smallButton =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-black/70 bg-white px-3 text-[13px] font-medium hover:bg-black/5 disabled:opacity-40";

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

// Tags of a beverage, shown on the SOP and the list cards.
export function TagList({ tags, className = "" }: { tags: string[]; className?: string }) {
  if (!tags.length) return null;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {tags.map((tag) => (
        <li key={tag} className="inline-flex rounded-full bg-[#eceee8] px-2.5 py-0.5 text-xs font-semibold">
          {tag}
        </li>
      ))}
    </ul>
  );
}
