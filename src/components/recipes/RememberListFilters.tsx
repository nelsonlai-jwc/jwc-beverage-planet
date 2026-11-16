"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { LIST_KEYS, recalledRecipeList, rememberRecipeList } from "@/lib/recipes/listMemory";

// On the recipe list: a URL that names any filter (even empty, as a search form sends it) is the
// user's choice and is remembered; a bare list URL (back link, side menu, tab, after saving)
// gets this tab's remembered filters back.
export function RememberListFilters({ tab }: { tab: string }) {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (LIST_KEYS.some((key) => params.has(key))) {
      rememberRecipeList();
      return;
    }
    const saved = recalledRecipeList(tab);
    if (!saved) return;
    const next = new URLSearchParams(saved);
    if (tab !== "mine") next.set("tab", tab);
    router.replace(`/recipes?${next.toString()}`, { scroll: false });
  }, [tab, router]);
  return null;
}
