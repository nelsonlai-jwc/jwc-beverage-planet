"use client";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const t = useTranslations("Login");
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError || !data.user) {
      // Same message for unknown email and wrong password (ch. 18.1).
      setError(
        isAuthRetryableFetchError(signInError) ? t("networkError") : t("invalidCredentials"),
      );
      setPending(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile?.status !== "ACTIVE") {
      await supabase.auth.signOut();
      setError(t("accountInactive"));
      setPending(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form
      className="flex w-full max-w-[400px] flex-col gap-5 rounded-[20px] bg-white p-6 sm:p-10"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{t("title")}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("invitationOnly")}</p>
      </div>
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-semibold">
          {t("password")}
        </label>
        <div className="flex gap-2">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-12 min-w-0 flex-1 rounded-[10px] border-[1.5px] border-black px-3.5 text-base"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="h-12 rounded-[10px] border-[1.5px] border-black bg-white px-3.5 text-sm"
          >
            {showPassword ? t("hidePassword") : t("showPassword")}
          </button>
        </div>
      </div>
      <a href="#" className="self-start text-sm underline">
        {t("forgotPassword")}
      </a>
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
      <p className="text-[13px] text-[#3d3f3a]">{t("suspended")}</p>
    </form>
  );
}
