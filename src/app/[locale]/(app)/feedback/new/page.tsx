import { getTranslations, setRequestLocale } from "next-intl/server";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/materials/ui";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { safeFromPath } from "@/lib/feedback/types";

export default async function NewFeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { locale } = await params;
  const { from } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Feedback");
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/feedback" label={t("back")} />
      <PageHeader title={t("newTitle")} note={t("newNote")} />
      <FeedbackForm userId={user.id} fromPath={safeFromPath(from)} />
    </div>
  );
}
