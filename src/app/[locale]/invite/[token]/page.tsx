import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { InviteForm } from "@/components/invite/InviteForm";
import { LocaleSwitch } from "@/components/shell/LocaleSwitch";

export default function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = use(params);
  setRequestLocale(locale);

  return (
    <main className="flex min-h-dvh flex-col gap-6 bg-[#c7c9c2] px-4 py-6 text-black md:py-10">
      <div className="flex justify-end">
        <LocaleSwitch />
      </div>
      <div className="flex flex-1 items-start justify-center md:items-center">
        <InviteForm token={token} />
      </div>
    </main>
  );
}
