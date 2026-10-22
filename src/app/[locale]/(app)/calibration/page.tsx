import { getTranslations, setRequestLocale } from "next-intl/server";
import { CalibrationBoard } from "@/components/calibration/CalibrationBoard";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { addDays, isIsoDate, malaysiaToday } from "@/lib/calibration/dates";
import { createClient } from "@/lib/supabase/server";

export default async function CalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; date?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Calibration");
  const user = await getCurrentUser();
  if (!user) return null;
  const query = await searchParams;

  const today = malaysiaToday();
  const outlet = user.outlets.find((o) => o.id === query.outlet) ?? user.outlets[0];
  const date = isIsoDate(query.date) && query.date <= today ? query.date : today;
  const canManage = user.role !== "BARISTA";
  // Barista: today only. Manager/Admin: the last 7 days (O13).
  const editable = canManage ? date >= addDays(today, -7) : date === today;

  const supabase = await createClient();
  const { data: beans } = await supabase
    .from("materials")
    .select("id, name, brand")
    .eq("is_coffee_bean", true)
    .eq("status", "APPROVED")
    .order("name");
  const { data: records } = outlet
    ? await supabase
        .from("calibrations")
        .select(
          `id, coffee_bean_material_id, dose_g, yield_g, extraction_time_seconds, grind_setting,
           taste_notes, deleted_at, delete_reason, updated_at, revision`,
        )
        .eq("outlet_id", outlet.id)
        .eq("business_date", date)
    : { data: [] };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={t("note")} />
      {!outlet ? (
        <p className="rounded-[20px] bg-white p-6 text-sm">{t("noOutlet")}</p>
      ) : (
        <CalibrationBoard
          key={`${outlet.id}-${date}`}
          outlets={user.outlets}
          outletId={outlet.id}
          date={date}
          today={today}
          editable={editable}
          canManage={canManage}
          beans={(beans ?? []).map((bean) => ({
            id: bean.id,
            name: bean.brand ? `${bean.name} · ${bean.brand}` : bean.name,
          }))}
          records={records ?? []}
        />
      )}
    </div>
  );
}
