import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { InviteForm } from "@/components/invite/InviteForm";

export default function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = use(params);
  setRequestLocale(locale);

  return (
    <main className="flex min-h-dvh items-start justify-center bg-[#c7c9c2] px-4 py-6 text-black md:items-center md:py-10">
      <InviteForm token={token} />
    </main>
  );
}
