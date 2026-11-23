import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  BREW_COLUMNS,
  BREWER_COLUMNS,
  ESPRESSO_COLUMNS,
  FILTER_COLUMNS,
  GRINDER_COLUMNS,
  MACHINE_COLUMNS,
  NO_OUTLET,
  SHOT_COLUMNS,
  withUses,
} from "@/components/calibration/data";
import { NewCalibration } from "@/components/calibration/NewCalibration";
import { cardClass } from "@/components/ui/styles";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { addDays, isIsoDate, malaysiaToday } from "@/lib/calibration/dates";
import { createClient } from "@/lib/supabase/server";

const isUuid = (value: string | undefined): value is string => !!value && /^[0-9a-f-]{36}$/i.test(value);

/**
 * New calibration: Daily / Custom, Espresso / Filter, bean, then test shots and the Final.
 * With ?edit=<session>&kind=ESPRESSO|FILTER the same form edits a saved session.
 */
export default async function NewCalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; date?: string; edit?: string; kind?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("Calibration");
  const user = await getCurrentUser();
  if (!user) return null;

  const today = malaysiaToday();
  const canManage = user.role !== "BARISTA";
  const supabase = await createClient();

  // Editing a saved session: its current Finals, when this person may edit them.
  let edit: React.ComponentProps<typeof NewCalibration>["edit"];
  if (query.edit !== undefined) {
    const kind = query.kind === "FILTER" ? "FILTER" : "ESPRESSO";
    const { data: rows } = !isUuid(query.edit)
      ? { data: [] }
      : kind === "ESPRESSO"
        ? await supabase.from("calibrations").select(ESPRESSO_COLUMNS).eq("session_id", query.edit).order("created_at")
        : await supabase.from("filter_calibrations").select(FILTER_COLUMNS).eq("session_id", query.edit).order("created_at");
    const records = await withUses(
      supabase,
      kind === "ESPRESSO" ? ((rows ?? []) as Parameters<typeof withUses>[1]) : [],
      kind === "FILTER" ? ((rows ?? []) as Parameters<typeof withUses>[2]) : [],
    );
    const list = kind === "ESPRESSO" ? records.espresso : records.filter;
    const owner = list[0];
    const current = list.filter((r) => !r.deleted_at && r.uses.some((u) => !u.superseded_by));
    // Daily: its creator, or a Manager / Admin of the outlet, on the same day. Custom: its creator or the Super Admin.
    const allowed =
      !!owner &&
      current.length > 0 &&
      (owner.purpose === "DAILY"
        ? owner.business_date === today && (owner.created_by === user.id || (canManage && user.outlets.some((o) => o.id === owner.outlet_id)))
        : owner.created_by === user.id || user.role === "ADMIN");
    if (!owner || !allowed) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title={t("editTitle")} />
          <p className={`${cardClass} text-sm`}>{t("editNotAllowed")}</p>
        </div>
      );
    }
    edit = {
      session: query.edit,
      purpose: owner.purpose,
      kind,
      beanId: owner.coffee_bean_material_id,
      espresso: kind === "ESPRESSO" ? (current as typeof records.espresso) : [],
      filter: kind === "FILTER" ? (current as typeof records.filter) : [],
    };
    query.date = owner.business_date;
    if (owner.outlet_id) query.outlet = owner.outlet_id;
  }

  const outlet = user.outlets.find((o) => o.id === query.outlet) ?? user.outlets[0];
  const date = edit ? (query.date ?? today) : isIsoDate(query.date) && query.date <= today ? query.date : today;
  // Daily: Barista today only, Manager/Admin the last 7 days (O13). Custom: any date.
  const dailyAllowed = !!outlet && (canManage ? date >= addDays(today, -7) : date === today);

  const outletId = outlet?.id ?? NO_OUTLET;
  const recentFrom = addDays(date, -7);
  const [
    { data: espressoBeans },
    { data: filterBeans },
    { data: espressoTargets },
    { data: filterTargets },
    { data: grinders },
    { data: machines },
    { data: brewers },
    { data: outletEquipment },
    { data: espDaily },
    { data: espCustom },
    { data: filDaily },
    { data: filCustom },
    { data: shots },
    { data: brews },
  ] = await Promise.all([
    supabase.from("materials").select("id, name, brand").eq("espresso_calibration", true).eq("status", "APPROVED").order("name"),
    supabase.from("materials").select("id, name, brand").eq("filter_calibration", true).eq("status", "APPROVED").order("name"),
    supabase.from("coffee_bean_targets").select("*"),
    supabase.from("coffee_bean_filter_targets").select("*"),
    supabase.from("grinders").select(`${GRINDER_COLUMNS}, all_outlets`).order("name"),
    supabase.from("espresso_machines").select(`${MACHINE_COLUMNS}, all_outlets`).order("name"),
    supabase.from("brewers").select(`${BREWER_COLUMNS}, all_outlets`).order("name"),
    supabase.from("outlet_equipment").select("grinder_id, espresso_machine_id, brewer_id").eq("outlet_id", outletId),
    // Recent beans and yesterday's values (daily); my earlier records (custom).
    supabase
      .from("calibrations")
      .select(ESPRESSO_COLUMNS)
      .eq("purpose", "DAILY")
      .eq("outlet_id", outletId)
      .gte("business_date", recentFrom)
      .lte("business_date", date)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("calibrations")
      .select(ESPRESSO_COLUMNS)
      .eq("purpose", "CUSTOM")
      .eq("created_by", user.id)
      .lte("business_date", date)
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("filter_calibrations")
      .select(FILTER_COLUMNS)
      .eq("purpose", "DAILY")
      .eq("outlet_id", outletId)
      .gte("business_date", recentFrom)
      .lte("business_date", date)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("filter_calibrations")
      .select(FILTER_COLUMNS)
      .eq("purpose", "CUSTOM")
      .eq("created_by", user.id)
      .lte("business_date", date)
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("calibration_shots")
      .select(`${SHOT_COLUMNS}, purpose, outlet_id, created_by`)
      .eq("business_date", date)
      .or(`and(purpose.eq.DAILY,outlet_id.eq.${outletId}),and(purpose.eq.CUSTOM,created_by.eq.${user.id})`)
      .order("created_at"),
    supabase
      .from("filter_calibration_brews")
      .select(`${BREW_COLUMNS}, purpose, outlet_id, created_by`)
      .eq("business_date", date)
      .or(`and(purpose.eq.DAILY,outlet_id.eq.${outletId}),and(purpose.eq.CUSTOM,created_by.eq.${user.id})`)
      .order("created_at"),
  ]);

  const espresso = [...(espDaily ?? []), ...(espCustom ?? [])];
  const filter = [...(filDaily ?? []), ...(filCustom ?? [])];
  const { espresso: espRecords, filter: filRecords } = await withUses(supabase, espresso, filter);

  // Daily: only equipment for this outlet ("All outlets" or ticked). Custom: any equipment in use.
  const usedIds = new Set(
    (outletEquipment ?? []).flatMap((e) => [e.grinder_id, e.espresso_machine_id, e.brewer_id].filter(Boolean)),
  );
  const both = <T extends { id: string; is_active: boolean; all_outlets: boolean }>(list: T[] | null) => ({
    DAILY: (list ?? []).map((x) => ({ ...x, is_active: x.is_active && (x.all_outlets || usedIds.has(x.id)) })),
    CUSTOM: list ?? [],
  });
  const before = (r: { business_date: string }) => r.business_date < date;
  const yesterday = (r: { business_date: string }) => r.business_date === addDays(date, -1);
  const beanList = (list: typeof espressoBeans) => (list ?? []).map((b) => ({ id: b.id, name: b.name, brand: b.brand }));
  const unique = (ids: string[]) => [...new Set(ids)];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={edit ? t("editTitle") : t("newTitle")} note={edit ? t("editNote") : t("newNote")} />
      <NewCalibration
        outletId={outlet?.id ?? null}
        outletName={outlet?.name ?? null}
        date={date}
        dailyAllowed={dailyAllowed}
        canManage={canManage}
        espressoBeans={beanList(espressoBeans)}
        filterBeans={beanList(filterBeans)}
        recent={{
          DAILY: unique([...espRecords, ...filRecords].filter((r) => r.purpose === "DAILY").map((r) => r.coffee_bean_material_id)),
          CUSTOM: unique(
            [...espRecords, ...filRecords]
              .filter((r) => r.purpose === "CUSTOM" && r.business_date >= recentFrom)
              .map((r) => r.coffee_bean_material_id),
          ),
        }}
        grinders={both(grinders)}
        machines={both(machines)}
        brewers={both(brewers)}
        espressoTargets={espressoTargets ?? []}
        filterTargets={filterTargets ?? []}
        previousEspresso={{
          DAILY: espRecords.filter((r) => r.purpose === "DAILY" && yesterday(r)),
          CUSTOM: espRecords.filter((r) => r.purpose === "CUSTOM" && before(r)),
        }}
        previousFilter={{
          DAILY: filRecords.filter((r) => r.purpose === "DAILY" && yesterday(r)),
          CUSTOM: filRecords.filter((r) => r.purpose === "CUSTOM" && before(r)),
        }}
        shots={{
          DAILY: (shots ?? []).filter((s) => s.purpose === "DAILY"),
          CUSTOM: (shots ?? []).filter((s) => s.purpose === "CUSTOM"),
        }}
        brews={{
          DAILY: (brews ?? []).filter((s) => s.purpose === "DAILY"),
          CUSTOM: (brews ?? []).filter((s) => s.purpose === "CUSTOM"),
        }}
        grinderNames={new Map((grinders ?? []).map((g) => [g.id, g.name]))}
        brewerNames={new Map((brewers ?? []).map((b) => [b.id, b.name]))}
        edit={edit}
      />
    </div>
  );
}
