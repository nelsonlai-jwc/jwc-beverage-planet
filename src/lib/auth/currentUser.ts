import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type UserRole = Database["public"]["Enums"]["user_role"];

export type Outlet = { id: string; name: string };

export type CurrentUser = {
  id: string;
  role: UserRole;
  // Outlets the user belongs to; every active outlet for an Admin.
  outlets: Outlet[];
};

// Signed-in, active user with role and outlet scope, or null. Cached per request.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, status, user_outlets(outlets(id, name, sort_order))")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.status !== "ACTIVE") return null;

  let outlets: Outlet[];
  if (profile.role === "ADMIN") {
    const { data } = await supabase
      .from("outlets")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order");
    outlets = data ?? [];
  } else {
    outlets = profile.user_outlets
      .flatMap((row) => (row.outlets ? [row.outlets] : []))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, name }) => ({ id, name }));
  }

  return { id: profile.id, role: profile.role, outlets };
});
