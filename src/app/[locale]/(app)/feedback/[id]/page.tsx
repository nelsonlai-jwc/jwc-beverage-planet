import { Bug, Lightbulb } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { FeedbackAdminForm } from "@/components/feedback/FeedbackAdminForm";
import { BackLink } from "@/components/materials/ui";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cardClass, labelClass, mutedText } from "@/components/ui/styles";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { FEEDBACK_BUCKET, isPriority, isStatus, priorityTone, statusTone } from "@/lib/feedback/types";
import { createClient } from "@/lib/supabase/server";

const localeNames: Record<string, string> = { en: "English", "zh-CN": "简体中文", ms: "Bahasa Melayu" };

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Feedback");
  const format = await getFormatter();
  const user = await getCurrentUser();
  if (!user) return null;
  const isSuperAdmin = user.role === "ADMIN";

  const supabase = await createClient();
  const { data: report } = await supabase.from("feedback_reports").select("*").eq("id", id).maybeSingle();
  if (!report) notFound();

  const [{ data: submitter }, { data: outlets }, photos, { data: replier }, { data: triage }] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", report.created_by).maybeSingle(),
    supabase.from("user_outlets").select("outlets(name, sort_order)").eq("user_id", report.created_by),
    report.photo_paths.length
      ? supabase.storage.from(FEEDBACK_BUCKET).createSignedUrls(report.photo_paths, 3600)
      : Promise.resolve({ data: [] as { signedUrl: string | null }[] }),
    report.replied_by
      ? supabase.from("profiles").select("full_name").eq("id", report.replied_by).maybeSingle()
      : Promise.resolve({ data: null }),
    isSuperAdmin
      ? supabase.from("feedback_triage").select("priority, note").eq("report_id", report.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const outletNames = (outlets ?? [])
    .flatMap((row) => (row.outlets ? [row.outlets] : []))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((o) => o.name);
  const photoUrls = (photos.data ?? []).flatMap((p) => (p.signedUrl ? [p.signedUrl] : []));
  const when = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });
  const status = isStatus(report.status) ? report.status : "NEW";
  const KindIcon = report.kind === "BUG" ? Bug : Lightbulb;
  // Submitters see "In progress" where the Super Admin sees "With Claude".
  const statusText = (value: string) => (isSuperAdmin ? t(`status.${value}`) : t(`statusUser.${value}`));

  const info: [string, React.ReactNode][] = [
    [t("info.submittedBy"), submitter ? `${submitter.full_name} (${submitter.email})` : "—"],
    [t("info.outlets"), outletNames.length ? outletNames.join(", ") : "—"],
    [t("info.submittedAt"), when(report.created_at)],
    [t("info.page"), report.page_url ? <span className="font-mono text-[12px] break-all">{report.page_url}</span> : "—"],
    [t("info.device"), report.device ? t(`device.${report.device}`) : "—"],
    [t("info.language"), report.locale ? (localeNames[report.locale] ?? report.locale) : "—"],
  ];
  if (isSuperAdmin && report.user_agent) {
    info.push([t("info.browser"), <span key="ua" className="text-[12px] break-all">{report.user_agent}</span>]);
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/feedback" label={t("back")} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={report.kind === "BUG" ? "red" : "purple"}>
            <span className="inline-flex items-center gap-1">
              <KindIcon size={12} aria-hidden />
              {t(`kind.${report.kind}`)}
            </span>
          </StatusBadge>
          <StatusBadge tone={statusTone[status]}>{statusText(status)}</StatusBadge>
          {isSuperAdmin && isPriority(triage?.priority) && (
            <StatusBadge tone={priorityTone[triage.priority]}>{t(`priority.${triage.priority}`)}</StatusBadge>
          )}
        </div>
        <h1 className="font-serif text-[26px] leading-tight font-normal break-words md:text-[28px]">
          <span className="text-[#3d3f3a]">#{report.number}</span> {report.title}
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className={`${cardClass} flex flex-col gap-2`}>
            <h2 className={labelClass}>{t("form.description")}</h2>
            <p className="text-sm whitespace-pre-wrap break-words">{report.description}</p>
          </section>

          {photoUrls.length > 0 && (
            <section className={`${cardClass} flex flex-col gap-2`}>
              <h2 className={labelClass}>{t("form.photos")}</h2>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photoUrls.map((url, index) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
                      <img
                        src={url}
                        alt={t("photoAlt", { n: index + 1 })}
                        className="aspect-square w-full rounded-[14px] object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!isSuperAdmin && (
            <section className={`${cardClass} flex flex-col gap-2`}>
              <h2 className={labelClass}>{t("replyLabel")}</h2>
              {status === "REJECTED" && report.reject_reasons.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {report.reject_reasons.map((reason) => (
                    <li key={reason}>{t.has(`reasons.${reason}.text`) ? t(`reasons.${reason}.text`) : reason}</li>
                  ))}
                </ul>
              )}
              {report.admin_reply ? (
                <>
                  <p className="text-sm whitespace-pre-wrap break-words">{report.admin_reply}</p>
                  {report.replied_at && (
                    <p className={mutedText}>
                      {replier?.full_name ? `${replier.full_name} · ` : ""}
                      {when(report.replied_at)}
                    </p>
                  )}
                </>
              ) : (
                !report.reject_reasons.length && <p className={mutedText}>{t("noReply")}</p>
              )}
            </section>
          )}

          {isSuperAdmin && (
            <FeedbackAdminForm
              id={report.id}
              kind={report.kind === "IDEA" ? "IDEA" : "BUG"}
              status={status}
              reply={report.admin_reply ?? ""}
              rejectReasons={report.reject_reasons}
              priority={isPriority(triage?.priority) ? triage.priority : null}
              note={triage?.note ?? ""}
            />
          )}
        </div>

        <section className={`${cardClass} flex h-fit flex-col gap-3`}>
          <h2 className={labelClass}>{t("info.title")}</h2>
          <dl className="flex flex-col gap-2 text-sm">
            {info.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className={mutedText}>{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
