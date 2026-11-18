import { getTranslations, setRequestLocale } from "next-intl/server";
import { SurveyForm, type SurveyInfo } from "@/components/surveys/SurveyForm";
import { secondaryButton } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

/** Outlet survey, answered after signing in by the staff ticked for it. */
export default async function FillSurveyPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Tasting");
  const s = await getTranslations("Surveys");
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{20,64}$/.test(token)
    ? await supabase.rpc("get_survey", { p_token: token })
    : { data: null };
  const survey = data as SurveyInfo | null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <Link href="/surveys" className={`${secondaryButton} self-start`}>
        {s("back")}
      </Link>
      {!survey || survey.audience !== "OUTLET" ? (
        <p className="rounded-[20px] bg-white p-6 text-base font-semibold">{t("notFound")}</p>
      ) : !survey.open ? (
        <p className="rounded-[20px] bg-white p-6 text-base font-semibold">{t("closed")}</p>
      ) : (
        <SurveyForm token={token} survey={survey} />
      )}
    </div>
  );
}
