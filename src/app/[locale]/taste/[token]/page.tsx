import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitch } from "@/components/shell/LocaleSwitch";
import { SurveyForm, type SurveyInfo } from "@/components/surveys/SurveyForm";
import { createClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE } from "@/lib/tasting/scale";

// Public survey: anyone with the QR code fills it, no sign-in.
export default async function TastePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Tasting");
  const device = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{20,64}$/.test(token)
    ? await supabase.rpc("get_survey", { p_token: token, p_device_id: device })
    : { data: null };
  const survey = data as SurveyInfo | null;

  return (
    <main className="flex min-h-dvh flex-col gap-6 bg-[#c7c9c2] px-4 py-6 text-black md:py-10">
      <div className="flex items-center justify-between gap-3">
        <span className="font-serif text-2xl">JWC</span>
        <LocaleSwitch />
      </div>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        {!survey || survey.audience !== "PUBLIC" ? (
          <p className="rounded-[20px] bg-white p-6 text-base font-semibold">{t("notFound")}</p>
        ) : !survey.open ? (
          <p className="rounded-[20px] bg-white p-6 text-base font-semibold">{t("closed")}</p>
        ) : (
          <SurveyForm token={token} survey={survey} />
        )}
      </div>
    </main>
  );
}
