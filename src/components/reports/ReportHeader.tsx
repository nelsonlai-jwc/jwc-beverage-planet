import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function ReportHeader({ title, note }: { title: string; note: string }) {
  const t = useTranslations("Reports");
  return (
    <div className="flex flex-col gap-2">
      <Link href="/reports" className="self-start text-sm underline print:hidden">
        {t("backToReports")}
      </Link>
      <h1 className="font-serif text-[32px] font-normal">{title}</h1>
      <p className="text-sm text-[#3d3f3a]">{note}</p>
    </div>
  );
}
