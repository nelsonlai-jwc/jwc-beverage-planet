import { getTranslations, setRequestLocale } from "next-intl/server";
import { CalibrationTable } from "@/components/calibration/CalibrationTable";
import {
  BREW_COLUMNS,
  ESPRESSO_COLUMNS,
  FILTER_COLUMNS,
  NO_OUTLET,
  SHOT_COLUMNS,
  withUses,
} from "@/components/calibration/data";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { addDays, isIsoDate, malaysiaToday } from "@/lib/calibration/dates";
import { createClient } from "@/lib/supabase/server";

/** Coffee Calibration: pick an outlet and a day (default today) and see its Finals. */
export default async function CalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; date?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("Calibration");
  const user = await getCurrentUser();
  if (!user) return null;

  const today = malaysiaToday();
  const outlet = user.outlets.find((o) => o.id === query.outlet) ?? user.outlets[0];
  const date = isIsoDate(query.date) && query.date <= today ? query.date : today;
  const canManage = user.role !== "BARISTA";
  const dailyEditable = canManage ? date >= addDays(today, -7) : date === today;

  const supabase = await createClient();
  const outletId = outlet?.id ?? NO_OUTLET;
  // Daily Finals of the outlet, plus custom ones (mine; the Super Admin sees everyone's).
  const mine = `and(purpose.eq.DAILY,outlet_id.eq.${outletId}),purpose.eq.CUSTOM`;
  const [{ data: espRows }, { data: filRows }, { data: shots }, { data: brews }] = await Promise.all([
    supabase.from("calibrations").select(ESPRESSO_COLUMNS).eq("business_date", date).or(mine),
    supabase.from("filter_calibrations").select(FILTER_COLUMNS).eq("business_date", date).or(mine),
    supabase.from("calibration_shots").select(`${SHOT_COLUMNS}, purpose, created_by`).eq("business_date", date).or(mine).order("created_at"),
    supabase.from("filter_calibration_brews").select(`${BREW_COLUMNS}, purpose, created_by`).eq("business_date", date).or(mine).order("created_at"),
  ]);
  const { espresso, filter } = await withUses(supabase, espRows ?? [], filRows ?? []);

  const all = [...espresso, ...filter];
  const ids = (list: (string | null)[]) => [...new Set(list.filter((x): x is string => !!x))];
  const beanIds = ids(all.map((r) => r.coffee_bean_material_id));
  const grinderIds = ids([...all, ...(shots ?? []), ...(brews ?? [])].map((r) => r.grinder_id));
  const machineIds = ids([...espresso, ...(shots ?? [])].map((r) => r.espresso_machine_id));
  const brewerIds = ids([...filter, ...(brews ?? [])].map((r) => r.brewer_id));
  const peopleIds = ids(all.map((r) => r.created_by));
  const none = { data: [] as { id: string; name: string }[] };
  const [{ data: beans }, { data: grinders }, { data: machines }, { data: brewers }, { data: profiles }] = await Promise.all([
    beanIds.length ? supabase.from("materials").select("id, name, brand").in("id", beanIds) : { data: [] },
    grinderIds.length ? supabase.from("grinders").select("id, name").in("id", grinderIds) : none,
    machineIds.length ? supabase.from("espresso_machines").select("id, name").in("id", machineIds) : none,
    brewerIds.length ? supabase.from("brewers").select("id, name").in("id", brewerIds) : none,
    peopleIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", peopleIds) : { data: [] },
  ]);
  const names = (list: { id: string; name: string }[] | null) => new Map((list ?? []).map((x) => [x.id, x.name]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={t("note")} />
      <CalibrationTable
        key={`${outlet?.id ?? "none"}-${date}`}
        userId={user.id}
        isSuperAdmin={user.role === "ADMIN"}
        outlets={user.outlets}
        outletId={outlet?.id ?? null}
        date={date}
        today={today}
        canManage={canManage}
        dailyEditable={dailyEditable}
        espresso={espresso}
        filter={filter}
        shots={shots ?? []}
        brews={brews ?? []}
        beanNames={new Map((beans ?? []).map((b) => [b.id, b.brand ? `${b.name} · ${b.brand}` : b.name]))}
        grinderNames={names(grinders)}
        machineNames={names(machines)}
        brewerNames={names(brewers)}
        people={new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]))}
      />
    </div>
  );
}
