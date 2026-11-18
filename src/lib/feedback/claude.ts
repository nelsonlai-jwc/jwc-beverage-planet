import { FEEDBACK_BUCKET } from "@/lib/feedback/types";
import { createClient } from "@/lib/supabase/server";

const APP_URL = "https://jwc-beverage-planet.justwantcoffee.com";
const PHOTO_LINK_SECONDS = 7 * 24 * 3600;

const kst = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));

/**
 * Markdown task for Claude Code: one section per report, in report-number order, with the
 * user's words verbatim, where it happened, the internal note and priority, and photo links
 * that work for 7 days. Written in English so it reads the same whatever the app language.
 */
export async function claudeTask(ids: string[]): Promise<string | null> {
  const supabase = await createClient();
  const { data: reports } = await supabase
    .from("feedback_reports")
    .select("*")
    .in("id", ids)
    .order("number");
  if (!reports?.length) return null;

  const people = [...new Set(reports.map((r) => r.created_by))];
  const [{ data: profiles }, { data: links }, { data: triage }] = await Promise.all([
    supabase.from("profiles").select("id, role, is_super_admin").in("id", people),
    supabase.from("user_outlets").select("user_id, outlets(name)").in("user_id", people),
    supabase.from("feedback_triage").select("*").in("report_id", ids),
  ]);
  const roleOf = new Map((profiles ?? []).map((p) => [p.id, p.is_super_admin ? "SUPER ADMIN" : p.role]));
  const outletsOf = new Map<string, string[]>();
  for (const link of links ?? []) {
    if (link.outlets) outletsOf.set(link.user_id, [...(outletsOf.get(link.user_id) ?? []), link.outlets.name]);
  }
  const triageOf = new Map((triage ?? []).map((t) => [t.report_id, t]));

  const sections = await Promise.all(
    reports.map(async (r) => {
      const t = triageOf.get(r.id);
      const photos = r.photo_paths.length
        ? ((await supabase.storage.from(FEEDBACK_BUCKET).createSignedUrls(r.photo_paths, PHOTO_LINK_SECONDS)).data ?? [])
        : [];
      const lines = [
        `## Feedback #${r.number}: ${r.title}`,
        "",
        `- Type: ${r.kind === "BUG" ? "Bug" : "Idea"}`,
        t?.priority ? `- Priority: ${t.priority}` : null,
        `- Sent: ${kst(r.created_at)} (Malaysia time) by a ${roleOf.get(r.created_by) ?? "user"}` +
          (outletsOf.get(r.created_by)?.length ? ` at ${outletsOf.get(r.created_by)!.join(", ")}` : ""),
        r.page_url ? `- Page: ${APP_URL}${r.page_url}` : null,
        r.device ? `- Device: ${r.device.toLowerCase()}${r.locale ? `, app language ${r.locale}` : ""}` : null,
        r.user_agent ? `- Browser: ${r.user_agent}` : null,
        `- In the app: ${APP_URL}/en/feedback/${r.id}`,
        "",
        "User's description:",
        "",
        ...r.description.split("\n").map((line) => `> ${line}`),
      ];
      if (t?.note) lines.push("", "Nelson's note:", "", ...t.note.split("\n").map((line) => `> ${line}`));
      const urls = photos.flatMap((p) => (p.signedUrl ? [p.signedUrl] : []));
      if (urls.length) lines.push("", "Photos (links work for 7 days):", ...urls.map((u, i) => `${i + 1}. ${u}`));
      return lines.filter((line) => line !== null).join("\n");
    }),
  );

  const numbers = reports.map((r) => `#${r.number}`).join(", ");
  return [
    `# JWC Beverage Planet feedback ${numbers}`,
    "",
    "Repository: nelsonlai-jwc/jwc-beverage-planet. Please look into each report below.",
    "For each one: find the cause, send me a short plan to confirm before changing code,",
    "then open a PR with phone and desktop screenshots (zh / en / ms).",
    "When a fix is live, set the report to DONE and reply to the user.",
    "",
    sections.join("\n\n---\n\n"),
    "",
  ].join("\n");
}
