import { getTranslations, setRequestLocale } from "next-intl/server";
import { SurveyResults } from "@/components/surveys/SurveyResults";
import type { SurveyInfo } from "@/components/surveys/SurveyForm";
import { SURVEY_COLUMNS, canDeleteSurvey, canManageSurvey } from "@/components/surveys/load";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { createClient } from "@/lib/supabase/server";

/** Results of one survey, for those who run it. */
export default async function SurveyResultsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Surveys");
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const { data: survey } = /^[0-9a-f-]{36}$/.test(id)
    ? await supabase.from("surveys").select(SURVEY_COLUMNS).eq("id", id).maybeSingle()
    : { data: null };
  if (!survey || !canManageSurvey(user, survey)) {
    return <p className="rounded-[20px] bg-white p-6 text-sm">{t("notFound")}</p>;
  }

  const [{ data: info }, { data: responses }, { data: invitees }] = await Promise.all([
    supabase.rpc("get_survey", { p_token: survey.token }),
    supabase
      .from("survey_responses")
      .select("id, drink, scores, flavor_tags, milk_amount, comment, respondent_id, hidden, created_at")
      .eq("survey_id", survey.id)
      .order("created_at"),
    survey.audience === "OUTLET"
      ? supabase.rpc("survey_invitee_status", { p_survey_id: survey.id })
      : Promise.resolve({ data: [] as { id: string; full_name: string; answered: boolean }[] }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("resultsTitle")} />
      <SurveyResults
        survey={survey}
        info={info as SurveyInfo}
        responses={(responses ?? []).map((r) => ({ ...r, scores: r.scores as Record<string, number> }))}
        invitees={invitees ?? []}
        canDelete={canDeleteSurvey(user, survey)}
      />
    </div>
  );
}
