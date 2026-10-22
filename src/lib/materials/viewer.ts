import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type Role = Database["public"]["Enums"]["user_role"];

/** The signed-in user's id and role; role is null for inactive accounts. */
export async function getViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, userId: null, role: null as Role | null };
  const { data } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();
  const role = data?.status === "ACTIVE" ? data.role : null;
  return { supabase, userId: user.id, role };
}
