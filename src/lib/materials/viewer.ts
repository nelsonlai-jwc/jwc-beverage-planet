import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type Role = Database["public"]["Enums"]["user_role"];

/**
 * The signed-in user's id and role; role is null for inactive accounts. An outlet Admin
 * gets role "MANAGER" (their permissions here) and outletAdmin true; only the Super
 * Admin gets "ADMIN".
 */
export async function getViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, userId: null, role: null as Role | null, outletAdmin: false };
  const { data } = await supabase
    .from("profiles")
    .select("role, status, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();
  const active = data?.status === "ACTIVE" ? data : null;
  const outletAdmin = active?.role === "ADMIN" && !active.is_super_admin;
  const role: Role | null = outletAdmin ? "MANAGER" : (active?.role ?? null);
  return { supabase, userId: user.id, role, outletAdmin };
}
