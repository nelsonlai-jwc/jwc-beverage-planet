"use client";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

// Same minimum as sign-up (supabase/config.toml minimum_password_length).
const MIN_PASSWORD_LENGTH = 6;

const inputClass = "h-12 rounded-[10px] border-[1.5px] border-black px-3.5 text-base";

// Set once the reset link's session is in place, so switching language
// (which drops the link's #fragment) keeps the form open.
let recoveryReady = false;

export function ResetPasswordForm() {
  const t = useTranslations("ResetPassword");
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      // The email link lands here with the recovery session in the #fragment.
      const params = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (params.get("type") === "recovery" && accessToken && refreshToken) {
        window.history.replaceState(null, "", window.location.pathname);
        const { error: sessionError } = await createClient().auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        recoveryReady = !sessionError;
      }
      if (!cancelled) setState(recoveryReady ? "ready" : "invalid");
    }
    start();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("tooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("mismatch"));
      return;
    }

    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(
        isAuthRetryableFetchError(updateError)
          ? t("networkError")
          : updateError.code === "weak_password"
            ? t("tooShort", { min: MIN_PASSWORD_LENGTH })
            : updateError.code === "same_password"
              ? t("samePassword")
              : t("failed"),
      );
      setPending(false);
      return;
    }
    // Sign out so the account status is checked again at sign-in.
    await supabase.auth.signOut();
    recoveryReady = false;
    setState("done");
    setPending(false);
  }

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-5 rounded-[20px] bg-white p-6 sm:p-10">
      <h1 className="font-serif text-[32px] font-normal">{t("title")}</h1>
      {state === "checking" && <p className="text-sm text-[#3d3f3a]">{t("checking")}</p>}
      {state === "invalid" && (
        <>
          <p role="alert" className="text-sm font-semibold text-[#c4161c]">
            {t("invalidLink")}
          </p>
          <Link href="/forgot-password" className="self-start text-sm underline">
            {t("requestNew")}
          </Link>
        </>
      )}
      {state === "done" && (
        <>
          <p role="status" className="text-sm font-semibold text-[#2f6b1f]">
            {t("saved")}
          </p>
          <Link
            href="/login"
            className="flex h-[52px] items-center justify-center rounded-xl bg-black text-base font-semibold text-white"
          >
            {t("toLogin")}
          </Link>
        </>
      )}
      {state === "ready" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <p className="text-sm text-[#3d3f3a]">{t("rule", { min: MIN_PASSWORD_LENGTH })}</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-password" className="text-sm font-semibold">
              {t("new")}
            </label>
            <div className="flex gap-2">
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="h-12 rounded-[10px] border-[1.5px] border-black bg-white px-3.5 text-sm"
              >
                {showPassword ? t("hide") : t("show")}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-new-password" className="text-sm font-semibold">
              {t("confirm")}
            </label>
            <input
              id="confirm-new-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={inputClass}
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
            {pending ? t("saving") : t("submit")}
          </button>
        </form>
      )}
    </div>
  );
}
