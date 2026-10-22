import { getTranslations, setRequestLocale } from "next-intl/server";
import { UsersAdmin } from "@/components/users/UsersAdmin";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { createClient } from "@/lib/supabase/server";

export default async function UsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Users");
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "ADMIN") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} />
        <p className="rounded-[20px] bg-white p-6 text-sm">{t("adminOnly")}</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: profiles }, { data: invitations }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        `id, email, full_name, role, status, revision,
         user_outlets(outlet_id), user_identity(document_type, document_last4)`,
      )
      .order("full_name"),
    supabase
      .from("invitations")
      .select("id, email, role, status, expires_at, created_at, invitation_outlets(outlet_id)")
      .neq("status", "ACCEPTED")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} note={t("note")} />
      <UsersAdmin
        currentUserId={user.id}
        outlets={user.outlets}
        users={(profiles ?? []).map((p) => ({
          id: p.id,
          email: p.email,
          fullName: p.full_name,
          role: p.role,
          status: p.status,
          revision: p.revision,
          outletIds: p.user_outlets.map((uo) => uo.outlet_id),
          documentType: p.user_identity?.document_type ?? null,
          documentLast4: p.user_identity?.document_last4 ?? null,
        }))}
        invitations={(invitations ?? []).map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          status: i.status,
          expiresAt: i.expires_at,
          outletIds: i.invitation_outlets.map((io) => io.outlet_id),
        }))}
      />
    </div>
  );
}
