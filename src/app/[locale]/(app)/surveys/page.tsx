import { getTranslations, setRequestLocale } from "next-intl/server";
import { SurveyList, type SurveyRow } from "@/components/surveys/SurveyList";
import { SURVEY_COLUMNS, canManageSurvey, loadSurveyInfo } from "@/components/surveys/load";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { createClient } from "@/lib/supabase/server";

/** Surveys: the ones waiting for my answer, and the ones I run. */
export default async function SurveysPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Surveys");
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const [{ data: invited }, { data: visible }] = await Promise.all([
    supabase.from("survey_invitees").select("survey_id").eq("user_id", user.id),
    user.role === "BARISTA"
      ? Promise.resolve({ data: [] as never[] })
      : supabase.from("surveys").select(SURVEY_COLUMNS).order("created_at", { ascending: false }).limit(50),
  ]);
  const invitedIds = (invited ?? []).map((i) => i.survey_id);
  const { data: invitedSurveys } = invitedIds.length
    ? await supabase.from("surveys").select(SURVEY_COLUMNS).in("id", invitedIds).is("closed_at", null)
    : { data: [] };
  const run = (visible ?? []).filter((s) => canManageSurvey(user, s));

  const all = [...(invitedSurveys ?? []), ...run];
  const info = await loadSurveyInfo(supabase, [...new Set(all.map((s) => s.token))]);
  const runIds = run.map((s) => s.id);
  const { data: answers } = runIds.length
    ? await supabase.from("survey_responses").select("survey_id").in("survey_id", runIds)
    : { data: [] };
  const counts = new Map<string, number>();
  (answers ?? []).forEach((a) => counts.set(a.survey_id, (counts.get(a.survey_id) ?? 0) + 1));

  const row = (s: (typeof all)[number]): SurveyRow | null => {
    const i = info.get(s.token);
    return i ? { id: s.id, token: s.token, info: i, answers: counts.get(s.id) ?? 0 } : null;
  };
  const pending = (invitedSurveys ?? [])
    .map(row)
    .filter((r): r is SurveyRow => !!r && r.info.open && r.info.drinks.some((d) => !r.info.answered.includes(d)))
    .sort((a, b) => a.info.closes_at.localeCompare(b.info.closes_at));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={t("note")} />
      <SurveyList
        pending={pending}
        run={run.map(row).filter((r): r is SurveyRow => !!r)}
        canCreate={user.role !== "BARISTA"}
      />
    </div>
  );
}
