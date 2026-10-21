import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { PlaceholderPage } from "@/components/shell/PlaceholderPage";

export default function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);

  return <PlaceholderPage navKey="users" />;
}
