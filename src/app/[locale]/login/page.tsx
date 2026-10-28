import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { AuthLayout } from "@/components/login/AuthLayout";
import { LoginForm } from "@/components/login/LoginForm";

export default function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);

  return (
    <AuthLayout locale={locale} path="/login">
      <LoginForm />
    </AuthLayout>
  );
}
