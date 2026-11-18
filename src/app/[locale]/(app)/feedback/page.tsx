import { Bug, Download, ImageIcon, Lightbulb, MessageSquareReply, Plus } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cardClass, mutedText, primaryButton, secondaryButton } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, isKind, isStatus, statusTone } from "@/lib/feedback/types";
import { createClient } from "@/lib/supabase/server";

const chip = (active: boolean) =>
  active
    ? "flex h-8 items-center rounded-full bg-black px-3.5 text-[13px] font-semibold text-white"
    : "flex h-8 items-center rounded-full border border-black/20 bg-white px-3.5 text-[13px] font-semibold text-black/70 hover:border-black";

export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string; status?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Feedback");
  const format = await getFormatter();
  const user = await getCurrentUser();
  if (!user) return null;
  const isSuperAdmin = user.role === "ADMIN";
  const kind = isSuperAdmin && isKind(query.kind) ? query.kind : null;
  const status = isSuperAdmin && isStatus(query.status) ? query.status : null;

  const supabase = await createClient();
  let request = supabase
    .from("feedback_reports")
    .select("id, kind, title, status, created_by, created_at, photo_paths, admin_reply")
    .order("created_at", { ascending: false })
    .limit(500);
  // The Super Admin's policy shows every report; the list for anyone else is their own.
  if (!isSuperAdmin) request = request.eq("created_by", user.id);
  if (kind) request = request.eq("kind", kind);
  if (status) request = request.eq("status", status);
  const { data: reports } = await request;

  const people = new Map<string, string>();
  if (isSuperAdmin && reports?.length) {
    const ids = [...new Set(reports.map((r) => r.created_by))];
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of data ?? []) people.set(p.id, p.full_name);
  }

  const href = (next: { kind?: string | null; status?: string | null }) => {
    const params = new URLSearchParams();
    const k = next.kind === undefined ? kind : next.kind;
    const s = next.status === undefined ? status : next.status;
    if (k) params.set("kind", k);
    if (s) params.set("status", s);
    const qs = params.toString();
    return qs ? `/feedback?${qs}` : "/feedback";
  };
  const exportParams = new URLSearchParams();
  if (kind) exportParams.set("kind", kind);
  if (status) exportParams.set("status", status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={t("title")} note={isSuperAdmin ? t("noteAdmin") : t("note")} />
        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && (
            // Plain link: a route handler download, not a page.
            <a
              href={`/${locale}/feedback/export${exportParams.size ? `?${exportParams}` : ""}`}
              className={secondaryButton}
            >
              <Download size={16} aria-hidden />
              {t("exportCsv")}
            </a>
          )}
          <Link href="/feedback/new" className={primaryButton}>
            <Plus size={16} aria-hidden />
            {t("newReport")}
          </Link>
        </div>
      </div>

      {isSuperAdmin && (
        <div className="flex flex-col gap-2">
          <nav aria-label={t("filterKind")} className="flex flex-wrap gap-1.5">
            <Link href={href({ kind: null })} className={chip(!kind)}>
              {t("allKinds")}
            </Link>
            {FEEDBACK_KINDS.map((k) => (
              <Link key={k} href={href({ kind: k })} className={chip(kind === k)}>
                {t(`kind.${k}`)}
              </Link>
            ))}
          </nav>
          <nav aria-label={t("filterStatus")} className="flex flex-wrap gap-1.5">
            <Link href={href({ status: null })} className={chip(!status)}>
              {t("allStatuses")}
            </Link>
            {FEEDBACK_STATUSES.map((s) => (
              <Link key={s} href={href({ status: s })} className={chip(status === s)}>
                {t(`status.${s}`)}
              </Link>
            ))}
          </nav>
        </div>
      )}

      {!reports?.length ? (
        <p className={`${cardClass} text-sm`}>{isSuperAdmin ? t("emptyAdmin") : t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((report) => {
            const KindIcon = report.kind === "BUG" ? Bug : Lightbulb;
            return (
              <li key={report.id}>
                <Link
                  href={`/feedback/${report.id}`}
                  className={`${cardClass} flex flex-col gap-2 hover:outline hover:outline-2 hover:outline-black`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={report.kind === "BUG" ? "red" : "purple"}>
                      <span className="inline-flex items-center gap-1">
                        <KindIcon size={12} aria-hidden />
                        {t(`kind.${report.kind}`)}
                      </span>
                    </StatusBadge>
                    {isStatus(report.status) && (
                      <StatusBadge tone={statusTone[report.status]}>{t(`status.${report.status}`)}</StatusBadge>
                    )}
                  </div>
                  <span className="text-base font-semibold break-words">{report.title}</span>
                  <span className={`${mutedText} flex flex-wrap items-center gap-x-3 gap-y-1`}>
                    {isSuperAdmin && <span>{people.get(report.created_by) ?? "—"}</span>}
                    <span>{format.dateTime(new Date(report.created_at), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" })}</span>
                    {report.photo_paths.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon size={14} aria-hidden />
                        {report.photo_paths.length}
                      </span>
                    )}
                    {report.admin_reply && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquareReply size={14} aria-hidden />
                        {t("replied")}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
