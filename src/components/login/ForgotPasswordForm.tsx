"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { sendPasswordResetEmail } from "@/lib/auth/passwordReset";

export function ForgotPasswordForm() {
  const t = useTranslations("ForgotPassword");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await sendPasswordResetEmail(email, locale);
    setPending(false);
    if (result === "sent") {
      setSent(true);
      return;
    }
    setError(
      result === "networkError"
        ? t("networkError")
        : result === "rateLimited"
          ? t("rateLimited")
          : t("failed"),
    );
  }

  return (
    <form
      className="flex w-full max-w-[400px] flex-col gap-5 rounded-[20px] bg-white p-6 sm:p-10"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{t("title")}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("intro")}</p>
      </div>
      {sent ? (
        // Same message whether or not the email has an account.
        <p role="status" className="text-sm font-semibold text-[#2f6b1f]">
          {t("sent")}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-semibold">
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-12 rounded-[10px] border-[1.5px] border-black px-3.5 text-base"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm font-semibold text-[#c4161c]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="h-[52px] rounded-xl bg-black text-base font-semibold text-white disabled:opacity-60"
          >
            {pending ? t("submitting") : t("submit")}
          </button>
        </>
      )}
      <Link href="/login" className="self-start text-sm underline">
        {t("backToLogin")}
      </Link>
    </form>
  );
}
