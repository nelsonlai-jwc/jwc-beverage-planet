"use client";

import { useTranslations } from "next-intl";
import type { Outlet } from "@/lib/recipes/types";

// Tick boxes for the outlets a recipe is made for; allowAll adds "All outlets" (Admin only).
export function OutletChecklist({
  outlets,
  allowAll,
  outletIds,
  allOutlets,
  onChange,
}: {
  outlets: Outlet[];
  allowAll: boolean;
  outletIds: string[];
  allOutlets: boolean;
  onChange: (outletIds: string[], allOutlets: boolean) => void;
}) {
  const t = useTranslations("Recipes");
  return (
    <div className="grid gap-x-4 sm:grid-cols-2">
      {allowAll && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold sm:col-span-2">
          <input
            type="checkbox"
            className="size-5 accent-black"
            checked={allOutlets}
            onChange={(e) => onChange(outletIds, e.target.checked)}
          />
          {t("allOutletsOption")}
        </label>
      )}
      {outlets.map((o) => (
        <label
          key={o.id}
          className={`flex min-h-11 items-center gap-3 text-sm ${allOutlets ? "opacity-50" : "cursor-pointer"}`}
        >
          <input
            type="checkbox"
            className="size-5 accent-black"
            disabled={allOutlets}
            checked={allOutlets || outletIds.includes(o.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...outletIds, o.id] : outletIds.filter((id) => id !== o.id), allOutlets)
            }
          />
          {o.name}
        </label>
      ))}
    </div>
  );
}
