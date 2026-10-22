"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { MenuStatus } from "@/components/menus/MenuStatus";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  cardClass,
  errorText,
  inputClass,
  labelClass,
  mutedText,
  primaryButton,
} from "@/components/ui/styles";
import { Link, useRouter } from "@/i18n/navigation";
import type { Outlet } from "@/lib/auth/currentUser";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type Menu = {
  id: string;
  name: string;
  status: Database["public"]["Enums"]["menu_status"];
  outletId: string;
  publishedAt: string | null;
  itemCount: number;
  hasPendingChanges: boolean;
};

export function MenuList({ outlets, menus }: { outlets: Outlet[]; menus: Menu[] }) {
  const t = useTranslations("Menus");
  const router = useRouter();
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    const { data, error: insertError } = await createClient()
      .from("menus")
      .insert({ outlet_id: outletId, name: trimmed })
      .select("id")
      .single();
    if (insertError || !data) {
      setError(t("createFailed"));
      setPending(false);
      return;
    }
    router.push(`/menus/${data.id}`);
  }

  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const grouped = outlets
    .map((outlet) => ({ outlet, menus: menus.filter((m) => m.outletId === outlet.id) }))
    .filter((group) => group.menus.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreate} className={`${cardClass} flex flex-col gap-4`}>
        <h2 className="text-base font-semibold">{t("newMenu")}</h2>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-menu-outlet" className={labelClass}>
              {t("outlet")}
            </label>
            <select
              id="new-menu-outlet"
              value={outletId}
              onChange={(event) => setOutletId(event.target.value)}
              className={inputClass}
            >
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-menu-name" className={labelClass}>
              {t("menuName")}
            </label>
            <input
              id="new-menu-name"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </div>
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? t("creating") : t("create")}
          </button>
        </div>
        {error && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </form>

      {grouped.length === 0 ? (
        <p className={`${cardClass} text-sm`}>{t("noMenus")}</p>
      ) : (
        grouped.map((group) => (
          <section key={group.outlet.id} className="flex flex-col gap-3" aria-label={group.outlet.name}>
            <h2 className="text-base font-semibold">{outletName.get(group.outlet.id)}</h2>
            <ul className="grid gap-3 lg:grid-cols-2">
              {group.menus.map((menu) => (
                <li key={menu.id}>
                  <Link
                    href={`/menus/${menu.id}`}
                    className={`${cardClass} flex flex-col gap-2 hover:outline hover:outline-2 hover:outline-black`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">{menu.name}</span>
                      <MenuStatus status={menu.status} />
                      {menu.hasPendingChanges && (
                        <StatusBadge tone="purple">{t("pendingChanges")}</StatusBadge>
                      )}
                    </div>
                    <span className={mutedText}>{t("itemCount", { count: menu.itemCount })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
