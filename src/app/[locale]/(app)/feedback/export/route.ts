import { getFormatter, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { isKind, isPriority, isStatus } from "@/lib/feedback/types";
import { toCsv } from "@/lib/reports/csv";
import { createClient } from "@/lib/supabase/server";

/** Super Admin: every report (with the list's type/status filters) as CSV. */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Feedback" });
  const format = await getFormatter({ locale });
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") return new Response(t("noAccess"), { status: 403 });

  const search = new URL(request.url).searchParams;
  const kind = search.get("kind");
  const status = search.get("status");
  const supabase = await createClient();
  let query = supabase.from("feedback_reports").select("*").order("created_at", { ascending: false });
  if (isKind(kind)) query = query.eq("kind", kind);
  if (isStatus(status)) query = query.eq("status", status);
  const { data: reports } = await query;

  const ids = [...new Set((reports ?? []).flatMap((r) => [r.created_by]))];
  const reportIds = (reports ?? []).map((r) => r.id);
  const [{ data: people }, { data: links }, { data: triage }] = ids.length
    ? await Promise.all([
        supabase.from("profiles").select("id, full_name, email").in("id", ids),
        supabase.from("user_outlets").select("user_id, outlets(name)").in("user_id", ids),
        supabase.from("feedback_triage").select("report_id, priority, note").in("report_id", reportIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const triageOf = new Map((triage ?? []).map((row) => [row.report_id, row]));
  const person = new Map((people ?? []).map((p) => [p.id, p]));
  const outletsOf = new Map<string, string[]>();
  for (const link of links ?? []) {
    if (!link.outlets) continue;
    outletsOf.set(link.user_id, [...(outletsOf.get(link.user_id) ?? []), link.outlets.name]);
  }
  const when = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }) : "";

  const header = [
    t("csv.number"),
    t("csv.submittedAt"),
    t("csv.kind"),
    t("csv.status"),
    t("csv.priority"),
    t("csv.title"),
    t("csv.description"),
    t("csv.submittedBy"),
    t("csv.email"),
    t("csv.outlets"),
    t("csv.page"),
    t("csv.device"),
    t("csv.language"),
    t("csv.photos"),
    t("csv.rejectReasons"),
    t("csv.reply"),
    t("csv.repliedAt"),
    t("csv.note"),
  ];
  const rows = (reports ?? []).map((r) => [
    `#${r.number}`,
    when(r.created_at),
    isKind(r.kind) ? t(`kind.${r.kind}`) : r.kind,
    isStatus(r.status) ? t(`status.${r.status}`) : r.status,
    isPriority(triageOf.get(r.id)?.priority) ? t(`priority.${triageOf.get(r.id)!.priority}`) : "",
    r.title,
    r.description,
    person.get(r.created_by)?.full_name ?? "",
    person.get(r.created_by)?.email ?? "",
    (outletsOf.get(r.created_by) ?? []).join(", "),
    r.page_url,
    r.device ? t(`device.${r.device}`) : "",
    r.locale,
    r.photo_paths.length,
    r.reject_reasons.map((reason) => (t.has(`reasons.${reason}.label`) ? t(`reasons.${reason}.label`) : reason)).join("; "),
    r.admin_reply,
    when(r.replied_at),
    triageOf.get(r.id)?.note ?? "",
  ]);
  const meta: [string, string][] = [
    [t("csv.report"), t("title")],
    [t("csv.generatedAt"), when(new Date().toISOString())],
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  // BOM so Excel opens Chinese text correctly.
  return new Response("﻿" + toCsv(meta, header, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="feedback-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
