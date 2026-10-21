"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

export function LoginForm() {
  const t = useTranslations("Login");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      className="flex w-full max-w-[400px] flex-col gap-5 rounded-[20px] bg-white p-6 sm:p-10"
      onSubmit={(event) => event.preventDefault()}
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
      <button
        type="submit"
        className="h-[52px] rounded-xl bg-black text-base font-semibold text-white"
      >
        {t("submit")}
      </button>
      <p className="text-[13px] text-[#3d3f3a]">{t("suspended")}</p>
    </form>
  );
}
