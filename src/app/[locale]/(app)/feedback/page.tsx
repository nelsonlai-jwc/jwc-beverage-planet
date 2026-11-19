import { ChevronDown, Download, ImageIcon, MessageSquare, MessageSquareReply, Plus, SearchX } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { CopyForClaudeButton } from "@/components/feedback/CopyForClaudeButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { mutedText, primaryButton, secondaryButton } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  CLOSED_STATUSES,
  FEEDBACK_KINDS,
  FEEDBACK_PRIORITIES,
  OPEN_STATUSES,
  isKind,
  isPriority,
  isStatus,
  priorityTone,
  statusTone,
} from "@/lib/feedback/types";
import { createClient } from "@/lib/supabase/server";

const TABS = ["bug", "idea", "closed"] as const;
type Tab = (typeof TABS)[number];
const tabColour: Record<Tab, string> = { bug: "#ff6062", idea: "#9a60ff", closed: "#2cfd53" };

export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; kind?: string; status?: string; sort?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Feedback");
  const format = await getFormatter();
  const user = await getCurrentUser();
  if (!user) return null;
  const isSuperAdmin = user.role === "ADMIN";

  // Bug and Idea tabs hold what is still open; "Closed" holds done and not-taken-up reports.
  const tab: Tab = (TABS as readonly string[]).includes(query.tab ?? "") ? (query.tab as Tab) : "bug";
  const tabStatuses: readonly string[] = tab === "closed" ? CLOSED_STATUSES : OPEN_STATUSES;
  const status = isStatus(query.status) && tabStatuses.includes(query.status) ? query.status : null;
  const kind = tab === "closed" && isKind(query.kind) ? query.kind : null;
  const sort = isSuperAdmin && query.sort === "priority" ? "priority" : null;

  const supabase = await createClient();
  let request = supabase
    .from("feedback_reports")
    .select("id, number, kind, title, status, created_by, created_at, photo_paths, admin_reply, reject_reasons")
    .order("created_at", { ascending: false })
    .limit(1000);
  // The Super Admin's policy shows every report; the list for anyone else is their own.
  if (!isSuperAdmin) request = request.eq("created_by", user.id);
  const { data: rows } = await request;
  const all = rows ?? [];
  const isOpen = (s: string) => (OPEN_STATUSES as readonly string[]).includes(s);
  const counts: Record<Tab, number> = {
    bug: all.filter((r) => r.kind === "BUG" && isOpen(r.status)).length,
    idea: all.filter((r) => r.kind === "IDEA" && isOpen(r.status)).length,
    closed: all.filter((r) => !isOpen(r.status)).length,
  };
  let reports = all.filter((r) => {
    if (tab === "bug" && (r.kind !== "BUG" || !isOpen(r.status))) return false;
    if (tab === "idea" && (r.kind !== "IDEA" || !isOpen(r.status))) return false;
    if (tab === "closed" && isOpen(r.status)) return false;
    if (status && r.status !== status) return false;
    if (kind && r.kind !== kind) return false;
    return true;
  });

  const people = new Map<string, string>();
  const priorityOf = new Map<string, (typeof FEEDBACK_PRIORITIES)[number]>();
  if (isSuperAdmin && reports.length) {
    const ids = [...new Set(reports.map((r) => r.created_by))];
    const [{ data }, { data: triage }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").in("id", ids),
      supabase.from("feedback_triage").select("report_id, priority").in("report_id", reports.map((r) => r.id)),
    ]);
    for (const p of data ?? []) people.set(p.id, p.full_name);
    for (const row of triage ?? []) if (isPriority(row.priority)) priorityOf.set(row.report_id, row.priority);
  }
  if (sort === "priority") {
    // High, medium, low, then none; newest first within each.
    const rank = (id: string) => {
      const p = priorityOf.get(id);
      return p ? FEEDBACK_PRIORITIES.indexOf(p) : FEEDBACK_PRIORITIES.length;
    };
    reports = [...reports].sort((a, b) => rank(a.id) - rank(b.id));
  }

  const href = (next: { tab?: Tab; kind?: string | null; status?: string | null; sort?: string | null }) => {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? tab;
    // Switching tabs clears the filters that belong to the old tab.
    const k = next.tab ? null : next.kind === undefined ? kind : next.kind;
    const s = next.tab ? null : next.status === undefined ? status : next.status;
    const o = next.sort === undefined ? sort : next.sort;
    if (nextTab !== "bug") params.set("tab", nextTab);
    if (k) params.set("kind", k);
    if (s) params.set("status", s);
    if (o) params.set("sort", o);
    const qs = params.toString();
    return qs ? `/feedback?${qs}` : "/feedback";
  };
  const exportParams = new URLSearchParams({ tab });
  if (kind) exportParams.set("kind", kind);
  if (status) exportParams.set("status", status);

  const statusText = (value: string) => (isSuperAdmin ? t(`status.${value}`) : t(`statusUser.${value}`));
  const when = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });
  const filterCount = (status ? 1 : 0) + (kind ? 1 : 0) + (sort ? 1 : 0);
  const filterLink = (active: boolean) =>
    `flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${active ? "bg-black text-white" : "hover:bg-black/5"}`;
  const cols = isSuperAdmin
    ? "md:grid-cols-[4rem_minmax(0,1fr)_10rem_9rem_6rem_10rem]"
    : "md:grid-cols-[4rem_minmax(0,1fr)_9rem_10rem]";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={t("title")} note={isSuperAdmin ? t("noteAdmin") : t("note")} />
        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && (
            // Plain link: a route handler download, not a page.
            <a href={`/${locale}/feedback/export?${exportParams}`} className={secondaryButton}>
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

      <section className="border border-black/10 bg-white">
        {/* Tab cards with counts */}
        <nav aria-label={t("tabs.label")} className="grid grid-cols-3 border-b border-black/10 sm:flex">
          {TABS.map((key) => {
            const active = tab === key;
            return (
              <Link
                key={key}
                href={href({ tab: key })}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-0 flex-col gap-0.5 border-r border-black/10 px-3 py-2 sm:min-w-44 sm:px-6 sm:py-2.5 ${
                  active ? "bg-white shadow-[inset_0_2px_0_#000]" : "bg-[#f4f5f2] text-black/60 hover:bg-[#eceee8]"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold sm:text-base">
                  <MessageSquare size={18} aria-hidden fill={tabColour[key]} color={tabColour[key]} className="shrink-0" />
                  <span className="truncate">{t(`tabs.${key}`)}</span>
                </span>
                <span className="text-[13px] sm:text-sm">{t(`tabs.${key}Count`, { count: counts[key] })}</span>
              </Link>
            );
          })}
        </nav>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-black/10 bg-[#f4f5f2] px-3 py-3 sm:px-4">
          <details key={`${tab}-${status}-${kind}-${sort}`} className="relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-xl border border-dashed border-black/30 bg-white px-4 text-sm text-black/70 hover:border-black [&::-webkit-details-marker]:hidden">
              {t("filter")}
              {filterCount > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-black text-[11px] font-semibold text-white">
                  {filterCount}
                </span>
              )}
              <ChevronDown size={16} aria-hidden />
            </summary>
            <div className="absolute left-0 z-20 mt-2 flex w-64 flex-col gap-3 rounded-2xl border border-black/10 bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
              <div className="flex flex-col">
                <p className={`${mutedText} px-3 pt-1 pb-1`}>{t("statusLabel")}</p>
                <Link href={href({ status: null })} className={filterLink(!status)}>
                  {tab === "closed" ? t("allClosed") : t("allOpen")}
                </Link>
                {tabStatuses.map((s) => (
                  <Link key={s} href={href({ status: s })} className={filterLink(status === s)}>
                    {statusText(s)}
                  </Link>
                ))}
              </div>
              {tab === "closed" && (
                <div className="flex flex-col">
                  <p className={`${mutedText} px-3 pt-1 pb-1`}>{t("typeLabel")}</p>
                  <Link href={href({ kind: null })} className={filterLink(!kind)}>
                    {t("allKinds")}
                  </Link>
                  {FEEDBACK_KINDS.map((k) => (
                    <Link key={k} href={href({ kind: k })} className={filterLink(kind === k)}>
                      {t(`kind.${k}`)}
                    </Link>
                  ))}
                </div>
              )}
              {isSuperAdmin && (
                <div className="flex flex-col">
                  <p className={`${mutedText} px-3 pt-1 pb-1`}>{t("sortBy")}</p>
                  <Link href={href({ sort: null })} className={filterLink(!sort)}>
                    {t("sortNewest")}
                  </Link>
                  <Link href={href({ sort: "priority" })} className={filterLink(sort === "priority")}>
                    {t("sortPriority")}
                  </Link>
                </div>
              )}
            </div>
          </details>
          {status && <StatusBadge tone="grey">{statusText(status)}</StatusBadge>}
          {kind && <StatusBadge tone="grey">{t(`kind.${kind}`)}</StatusBadge>}
          {sort && <StatusBadge tone="grey">{t("sortPriority")}</StatusBadge>}
          {isSuperAdmin && status === "ACCEPTED" && reports.length > 0 && (
            <div className="ml-auto">
              <CopyForClaudeButton
                ids={reports.slice(0, 50).map((r) => r.id)}
                label={t("copyAccepted", { count: Math.min(reports.length, 50) })}
              />
            </div>
          )}
        </div>

        {/* Table header (desktop) */}
        <div
          className={`hidden border-b border-black/10 font-mono text-[13px] text-black/80 md:grid ${cols} [&>span]:border-r [&>span]:border-black/10 [&>span]:px-4 [&>span]:py-3 [&>span:last-child]:border-r-0`}
        >
          <span>#</span>
          <span>{t("table.title")}</span>
          {isSuperAdmin && <span>{t("table.sentBy")}</span>}
          <span>{t("table.status")}</span>
          {isSuperAdmin && <span>{t("table.priority")}</span>}
          <span>{t("table.sentAt")}</span>
        </div>

        {reports.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <SearchX size={28} aria-hidden className="text-black/50" />
            {status || kind ? (
              <p className="text-base font-semibold">{t("emptyFiltered")}</p>
            ) : (
              <>
                <p className="text-base font-semibold">{t(`emptyTab.${tab}.title`)}</p>
                <p className={mutedText}>{t(`emptyTab.${tab}.text`)}</p>
              </>
            )}
          </div>
        ) : (
          <ul>
            {reports.map((report) => {
              const priority = priorityOf.get(report.id);
              const replied = report.admin_reply || report.reject_reasons.length > 0;
              return (
                <li key={report.id} className="border-b border-black/10 last:border-b-0">
                  <Link
                    href={`/feedback/${report.id}`}
                    className={`flex flex-col gap-1.5 px-4 py-3 hover:bg-[#f4f5f2] md:grid md:items-center md:gap-0 md:px-0 md:py-0 ${cols} md:[&>*]:px-4 md:[&>*]:py-3`}
                  >
                    <span className="hidden font-mono text-sm text-black/60 md:block">#{report.number}</span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm font-semibold break-words">
                        <span className="text-black/50 md:hidden">#{report.number} </span>
                        {report.title}
                      </span>
                      <span className={`${mutedText} flex flex-wrap items-center gap-x-3 gap-y-1`}>
                        {tab === "closed" && <span>{t(`kind.${report.kind}`)}</span>}
                        {report.photo_paths.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <ImageIcon size={14} aria-hidden />
                            {report.photo_paths.length}
                          </span>
                        )}
                        {replied && (
                          <span className="inline-flex items-center gap-1">
                            <MessageSquareReply size={14} aria-hidden />
                            {t("replied")}
                          </span>
                        )}
                      </span>
                    </span>
                    {isSuperAdmin && (
                      <span className="hidden truncate text-sm md:block">{people.get(report.created_by) ?? "—"}</span>
                    )}
                    {/* Phone: status, priority, sender and time on one wrapping line. */}
                    <span className="flex flex-wrap items-center gap-1.5 md:contents">
                      <span className="md:block md:px-4 md:py-3">
                        {isStatus(report.status) && (
                          <StatusBadge tone={statusTone[report.status]}>{statusText(report.status)}</StatusBadge>
                        )}
                      </span>
                      {isSuperAdmin && (
                        <span className="md:block md:px-4 md:py-3">
                          {priority && <StatusBadge tone={priorityTone[priority]}>{t(`priority.${priority}`)}</StatusBadge>}
                        </span>
                      )}
                      {isSuperAdmin && (
                        <span className={`${mutedText} md:hidden`}>{people.get(report.created_by) ?? "—"}</span>
                      )}
                      <span className={`${mutedText} md:block md:px-4 md:py-3`}>{when(report.created_at)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
