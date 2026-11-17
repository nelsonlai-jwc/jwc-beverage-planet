import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function ReportHeader({ title, note }: { title: string; note: string }) {
  const t = useTranslations("Reports");
  return (
    <div className="flex flex-col gap-2">
      <Link href="/reports" className="self-start text-sm underline print:hidden">
        {t("backToReports")}
      </Link>
      <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] md:text-[28px]">{title}</h1>
      <p className="text-sm text-[#3d3f3a]">{note}</p>
    </div>
  );
}
