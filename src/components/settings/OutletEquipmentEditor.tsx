"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setOutletEquipment, type EquipmentKind } from "@/app/[locale]/(app)/settings/equipment-actions";
import { alertClass } from "@/components/recipes/ui";
import { useRouter } from "@/i18n/navigation";

export type OutletEquipmentOption = { id: string; name: string; active: boolean };
export type OutletEquipmentOutlet = {
  id: string;
  name: string;
  /** Equipment ids this outlet uses, by kind. */
  used: Record<EquipmentKind, string[]>;
};

const KINDS: EquipmentKind[] = ["MACHINE", "GRINDER", "BREWER"];

/** Settings card body: which machines, grinders and hand brew kits each outlet uses. */
export function OutletEquipmentEditor({
  outlets,
  equipment,
  editable,
}: {
  outlets: OutletEquipmentOutlet[];
  equipment: Record<EquipmentKind, OutletEquipmentOption[]>;
  editable: boolean;
}) {
  const t = useTranslations("Settings.outletEquipment");
  const tEdit = useTranslations("Settings.edit");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(outletId: string, kind: EquipmentKind, id: string, used: boolean) {
    setError(null);
    setBusy(`${outletId}:${id}`);
    startTransition(async () => {
      const result = await setOutletEquipment(outletId, kind, id, used);
      setBusy(null);
      if (!result.ok) {
        setError(tEdit.has(`errors.${result.error}`) ? tEdit(`errors.${result.error}`) : tEdit("errors.UNKNOWN"));
        return;
      }
      router.refresh();
    });
  }

  if (outlets.length === 0) return <p className="text-sm text-[#3d3f3a]">{t("noOutlets")}</p>;

  return (
    <div className="flex flex-col gap-4">
      {outlets.map((outlet) => (
        <section key={outlet.id} className="flex flex-col gap-3 rounded-[12px] border border-black/15 p-3">
          <h3 className="font-semibold">{outlet.name}</h3>
          {KINDS.map((kind) => {
            const used = new Set(outlet.used[kind]);
            // Disabled equipment is offered only while the outlet still has it, so it can be removed.
            const options = equipment[kind].filter((e) => e.active || used.has(e.id));
            const shown = editable ? options : options.filter((e) => used.has(e.id));
            return (
              <div key={kind} className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-[#3d3f3a]">{t(`kinds.${kind}`)}</span>
                {shown.length === 0 ? (
                  <span className="text-sm text-[#3d3f3a]">{editable ? t("noneSetUp") : t("noneUsed")}</span>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {shown.map((e) => {
                      const checked = used.has(e.id);
                      return (
                        <li key={e.id}>
                          {editable ? (
                            <label
                              className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-3 py-1 text-sm ${
                                checked ? "border-black bg-black text-white" : "border-black/40"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="size-4 accent-[#2CFD53]"
                                checked={checked}
                                disabled={busy !== null}
                                onChange={(ev) => toggle(outlet.id, kind, e.id, ev.target.checked)}
                              />
                              <span>{e.name}</span>
                              {!e.active && <span className="text-xs opacity-80">({tEdit("disabled")})</span>}
                            </label>
                          ) : (
                            <span className="inline-block rounded-full border-[1.5px] border-black px-3 py-1 text-sm">
                              {e.name}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      ))}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
    </div>
  );
}
