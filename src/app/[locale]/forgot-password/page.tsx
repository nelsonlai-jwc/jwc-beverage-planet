import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { AuthLayout } from "@/components/login/AuthLayout";
import { ForgotPasswordForm } from "@/components/login/ForgotPasswordForm";

export default function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);

  return (
    <AuthLayout locale={locale} path="/forgot-password">
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
