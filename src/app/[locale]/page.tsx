import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";

export default function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("HomePage");

  return (
    <main className="p-4">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
    </main>
  );
}
