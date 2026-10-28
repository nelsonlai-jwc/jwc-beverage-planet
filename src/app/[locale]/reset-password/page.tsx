import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { AuthLayout } from "@/components/login/AuthLayout";
import { ResetPasswordForm } from "@/components/login/ResetPasswordForm";

export default function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);

  return (
    <AuthLayout locale={locale} path="/reset-password">
      <ResetPasswordForm />
    </AuthLayout>
  );
}
