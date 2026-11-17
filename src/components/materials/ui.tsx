import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Database } from "@/types/database";

export type ApprovalStatus = Database["public"]["Enums"]["approval_status"];

export const inputClass =
  "h-10 w-full min-w-0 rounded-xl border border-black/35 bg-white px-3 text-base focus:border-black focus:outline-none disabled:bg-[#eceee8]";
export const labelClass = "text-sm font-semibold";
export const cardClass = "flex flex-col gap-4 rounded-[20px] bg-white p-4 sm:p-5";
export const primaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-black px-5 text-sm font-semibold text-white hover:bg-black/85 disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-black bg-white px-4 text-sm font-semibold hover:bg-black/5 disabled:opacity-50";
export const errorClass = "text-sm font-semibold text-[#c4161c]";

// Colour plus text, never colour alone (ch. 17.3).
const statusStyles: Record<ApprovalStatus, string> = {
  DRAFT: "bg-white border-black/40",
  PENDING: "bg-brand-orange border-brand-orange",
  APPROVED: "bg-brand-green border-brand-green",
  RETURNED: "bg-brand-red border-brand-red",
  SUPERSEDED: "bg-transparent border-black/40 text-[#3d3f3a]",
  ARCHIVED: "bg-transparent border-black/40 text-[#3d3f3a]",
};

export function StatusBadge({ status }: { status: ApprovalStatus }) {
  const t = useTranslations("RawMaterials.status");
  return (
    <span
      className={`inline-flex items-center rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${statusStyles[status]}`}
    >
      {t(status)}
    </span>
  );
}

/**
 * Materials | Packaging | Pending approval tabs. The approval tab shows only when `pending`
 * is given (reviewers), with a red count like the recipe "Pending approval" tab.
 */
export function SectionTabs({
  active,
  basePath = "/raw-materials",
  pending,
}: {
  active: "materials" | "packaging" | "approvals";
  basePath?: string;
  pending?: number;
}) {
  const t = useTranslations("RawMaterials");
  const tRecipes = useTranslations("Recipes");
  const tabs: { key: typeof active; href: string; label: string }[] = [
    { key: "materials", href: basePath, label: t("tabMaterials") },
    { key: "packaging", href: `${basePath}?tab=packaging`, label: t("tabPackaging") },
  ];
  if (pending !== undefined) tabs.push({ key: "approvals", href: "/raw-materials/approvals", label: t("approvals") });
  return (
    <nav aria-label={t("sections")} className="flex flex-wrap gap-1">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={
            active === tab.key
              ? "flex h-8 items-center rounded-full bg-black px-3.5 text-[13px] font-semibold text-white"
              : "flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold text-black/70 hover:bg-black/5"
          }
        >
          {tab.label}
          {tab.key === "approvals" && pending !== undefined && pending > 0 && (
            <span
              aria-label={tRecipes("pendingCount", { count: pending })}
              className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff6062] px-1.5 align-middle text-xs font-semibold leading-none text-white"
            >
              {pending}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="self-start text-sm underline">
      ← {label}
    </Link>
  );
}
