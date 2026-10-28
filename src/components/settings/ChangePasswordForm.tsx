"use client";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

// Same minimum as sign-up (supabase/config.toml minimum_password_length).
const MIN_PASSWORD_LENGTH = 6;

const inputClass = "h-12 rounded-[10px] border-[1.5px] border-black px-3.5 text-base";

export function ChangePasswordForm() {
  const t = useTranslations("Settings.password");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setSaved(false);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t("tooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("mismatch"));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t("samePassword"));
      return;
    }

    setPending(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      setError(t("failed"));
      setPending(false);
      return;
    }

    // Check the current password first, so an unattended signed-in device
    // cannot be used to change it.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) {
      setError(
        isAuthRetryableFetchError(verifyError) ? t("networkError") : t("wrongCurrent"),
      );
      setPending(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
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

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setSaved(true);
    setPending(false);
  }

  return (
    <section
      aria-labelledby="change-password"
      className="flex flex-col gap-4 rounded-[20px] bg-white p-5 sm:p-6 lg:max-w-xl"
    >
      <div className="flex flex-col gap-1">
        <h2 id="change-password" className="text-base font-semibold">
          {t("title")}
        </h2>
        <p className="text-[13px] text-[#3d3f3a]">{t("rule", { min: MIN_PASSWORD_LENGTH })}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current-password" className="text-sm font-semibold">
            {t("current")}
          </label>
          <div className="flex gap-2">
            <input
              id="current-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
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
          <label htmlFor="new-password" className="text-sm font-semibold">
            {t("new")}
          </label>
          <input
            id="new-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={inputClass}
          />
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
        {saved && (
          <p role="status" className="text-sm font-semibold text-[#2f6b1f]">
            {t("saved")}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-xl bg-black text-base font-semibold text-white disabled:opacity-60 sm:w-fit sm:px-6"
        >
          {pending ? t("saving") : t("submit")}
        </button>
      </form>
    </section>
  );
}
