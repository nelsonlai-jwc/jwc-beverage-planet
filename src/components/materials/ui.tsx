import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Database } from "@/types/database";

export type ApprovalStatus = Database["public"]["Enums"]["approval_status"];

export const inputClass =
  "h-12 w-full rounded-[10px] border-[1.5px] border-black bg-white px-3.5 text-base disabled:opacity-60";
export const labelClass = "text-sm font-semibold";
export const cardClass = "flex flex-col gap-4 rounded-[20px] bg-white p-5 sm:p-6";
export const primaryButtonClass =
  "inline-flex h-12 items-center justify-center rounded-xl bg-black px-5 text-sm font-semibold text-white disabled:opacity-60";
export const secondaryButtonClass =
  "inline-flex h-12 items-center justify-center rounded-xl border-[1.5px] border-black bg-white px-5 text-sm font-semibold disabled:opacity-60";
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

export function SectionTabs({
  active,
  basePath = "/raw-materials",
}: {
  active: "materials" | "packaging";
  basePath?: string;
}) {
  const t = useTranslations("RawMaterials");
  const tabs = [
    { key: "materials", href: basePath, label: t("tabMaterials") },
    { key: "packaging", href: `${basePath}?tab=packaging`, label: t("tabPackaging") },
  ] as const;
  return (
    <nav aria-label={t("sections")} className="flex gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={
            active === tab.key
              ? "flex h-11 items-center rounded-full bg-black px-4 text-sm font-semibold text-white"
              : "flex h-11 items-center rounded-full border-[1.5px] border-black bg-white px-4 text-sm"
          }
        >
          {tab.label}
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
