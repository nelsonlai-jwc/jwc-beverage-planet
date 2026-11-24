import type { SurveyInfo } from "@/components/surveys/SurveyForm";
import type { CurrentUser } from "@/lib/auth/currentUser";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export const SURVEY_COLUMNS =
  "id, subject_type, outlet_id, outlet_ids, audience, drinks, note, token, closes_at, closed_at, max_responses, created_by, created_at";

/** Who runs a survey: its creator, the Super Admin, and Managers of any of its outlets. */
export const canManageSurvey = (
  user: CurrentUser,
  s: { created_by: string; outlet_ids: string[] },
) =>
  user.role === "ADMIN" ||
  s.created_by === user.id ||
  (user.role === "MANAGER" &&
    user.outlets.some((o) => s.outlet_ids.includes(o.id)));

/** Who may delete a survey: its creator, the Super Admin, and outlet Admins of any of its outlets. */
export const canDeleteSurvey = (
  user: CurrentUser,
  s: { created_by: string; outlet_ids: string[] },
) =>
  user.role === "ADMIN" ||
  s.created_by === user.id ||
  (user.outletAdmin && user.outlets.some((o) => s.outlet_ids.includes(o.id)));

/** Subject, outlet, date and open state of each survey, as its fill page shows them. */
export async function loadSurveyInfo(supabase: Client, tokens: string[]) {
  const infos = await Promise.all(
    tokens.map(
      async (token) =>
        (await supabase.rpc("get_survey", { p_token: token }))
          .data as SurveyInfo | null,
    ),
  );
  return new Map(tokens.map((token, i) => [token, infos[i]]));
}
