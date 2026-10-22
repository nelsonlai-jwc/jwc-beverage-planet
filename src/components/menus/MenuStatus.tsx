import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Database } from "@/types/database";

type MenuStatusValue = Database["public"]["Enums"]["menu_status"];

const tone = {
  DRAFT: "grey",
  PUBLISHED: "green",
  UNPUBLISHED: "orange",
  ARCHIVED: "grey",
} as const;

export function MenuStatus({ status }: { status: MenuStatusValue }) {
  const t = useTranslations("Menus.status");
  return <StatusBadge tone={tone[status]}>{t(status)}</StatusBadge>;
}
