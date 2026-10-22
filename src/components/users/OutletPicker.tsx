"use client";

import { useTranslations } from "next-intl";
import type { Outlet, UserRole } from "@/lib/auth/currentUser";

// Barista: exactly one outlet; Manager: one or more; Admin: global, none (D02).
export function OutletPicker({
  idPrefix,
  role,
  outlets,
  value,
  onChange,
}: {
  idPrefix: string;
  role: UserRole;
  outlets: Outlet[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("Users");

  if (role === "ADMIN") {
    return <p className="text-sm">{t("adminAllOutlets")}</p>;
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold">
        {role === "BARISTA" ? t("outletOne") : t("outletMany")}
      </legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {outlets.map((outlet) => {
          const id = `${idPrefix}-outlet-${outlet.id}`;
          const checked = value.includes(outlet.id);
          return (
            <label key={outlet.id} htmlFor={id} className="flex min-h-11 items-center gap-2.5 text-sm">
              <input
                id={id}
                type={role === "BARISTA" ? "radio" : "checkbox"}
                name={`${idPrefix}-outlets`}
                checked={checked}
                onChange={() =>
                  onChange(
                    role === "BARISTA"
                      ? [outlet.id]
                      : checked
                        ? value.filter((v) => v !== outlet.id)
                        : [...value, outlet.id],
                  )
                }
                className="size-5 accent-black"
              />
              {outlet.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
