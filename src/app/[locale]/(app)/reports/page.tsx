import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { cardClass, mutedText } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";

const reports = [
  { href: "/reports/cost", key: "cost" },
  { href: "/reports/rnd", key: "rnd" },
  { href: "/reports/menus", key: "menus" },
] as const;

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Reports");
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={user.role === "BARISTA" ? undefined : t("note")} />
      {user.role === "BARISTA" ? (
        <p className={`${cardClass} text-sm`}>{t("noAccess")}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-3">
          {reports.map((report) => (
            <li key={report.key}>
              <Link
                href={report.href}
                className={`${cardClass} flex h-full flex-col gap-2 hover:outline hover:outline-2 hover:outline-black`}
              >
                <span className="text-lg font-semibold">{t(`${report.key}.title`)}</span>
                <span className={mutedText}>{t(`${report.key}.summary`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
