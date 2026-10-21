"use client";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type Invitation = Database["public"]["Functions"]["get_invitation"]["Returns"][number];
type DocumentType = Database["public"]["Enums"]["id_document_type"];

// Matches the profiles.full_name check: letters, spaces, ' / @ - (O17).
const NAME_PATTERN = /^[\p{L} '/@-]+$/u;

const inputClass = "h-12 rounded-[10px] border-[1.5px] border-black px-3.5 text-base";
const readOnlyClass = "rounded-[10px] bg-[#eceee8] px-3.5 py-3 text-base";

export function InviteForm({ token }: { token: string }) {
  const t = useTranslations("Invite");
  const format = useFormatter();
  const router = useRouter();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "invalid" | "error">("loading");
  const [fullName, setFullName] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("NRIC");
  const [documentNumber, setDocumentNumber] = useState("");
  const [showDocument, setShowDocument] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("get_invitation", { p_token: token })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) {
          setLoadState("error");
        } else if (!data?.length) {
          setLoadState("invalid");
        } else {
          setInvitation(data[0]);
          setLoadState("ready");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !invitation) return;

    const name = fullName.trim().replace(/\s+/g, " ").toUpperCase();
    if (!name || name.length > 100 || !NAME_PATTERN.test(name)) {
      setError(t("nameInvalid"));
      return;
    }
    const number = documentNumber.replace(/\s/g, "").toUpperCase();
    if (number.length < 4 || number.length > 32) {
      setError(t("documentInvalid"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setPending(true);
    setError(null);
    const supabase = createClient();
    // The database creates the account only when this token and email match a
    // pending invitation, then removes the token and number from the metadata.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: invitation.email,
      password,
      options: {
        data: {
          invite_token: token,
          full_name: name,
          document_type: documentType,
          document_number: number,
        },
      },
    });
    if (signUpError) {
      setError(
        isAuthRetryableFetchError(signUpError)
          ? t("networkError")
          : signUpError.code === "weak_password"
            ? t("weakPassword")
            : t("activationFailed"),
      );
      setPending(false);
      return;
    }
    if (!data.session) {
      setError(t("signInAfterActivation"));
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  if (loadState === "loading") {
    return (
      <section className="w-full max-w-[480px] rounded-[20px] bg-white p-6 sm:p-10" aria-busy="true">
        <p className="text-sm">{t("loading")}</p>
      </section>
    );
  }

  if (loadState !== "ready" || !invitation || invitation.status !== "PENDING") {
    const reason =
      loadState === "error"
        ? t("networkError")
        : invitation?.status === "EXPIRED"
          ? t("expired")
          : invitation?.status === "ACCEPTED"
            ? t("used")
            : invitation?.status === "REVOKED"
              ? t("revoked")
              : t("notFound");
    return (
      <section className="flex w-full max-w-[480px] flex-col gap-3 rounded-[20px] bg-white p-6 sm:p-10">
        <h1 className="font-serif text-[28px] font-normal">{t("invalidTitle")}</h1>
        <p className="text-sm">{reason}</p>
        <p className="text-sm text-[#3d3f3a]">{t("contactAdmin")}</p>
      </section>
    );
  }

  return (
    <form
      className="flex w-full max-w-[480px] flex-col gap-5 rounded-[20px] bg-white p-6 sm:p-10"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{t("title")}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("intro")}</p>
      </div>

      <dl className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-semibold">{t("email")}</dt>
          <dd className={readOnlyClass}>{invitation.email}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-semibold">{t("role")}</dt>
          <dd className={readOnlyClass}>{t(`roles.${invitation.role}`)}</dd>
        </div>
        {invitation.outlet_names.length > 0 && (
          <div className="flex flex-col gap-1">
            <dt className="text-sm font-semibold">{t("outlets")}</dt>
            <dd className={readOnlyClass}>{invitation.outlet_names.join(", ")}</dd>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-semibold">{t("expires")}</dt>
          <dd className={readOnlyClass}>
            {format.dateTime(new Date(invitation.expires_at), {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Kuala_Lumpur",
            })}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="full-name" className="text-sm font-semibold">
          {t("fullName")}
        </label>
        <input
          id="full-name"
          autoComplete="name"
          required
          maxLength={100}
          value={fullName}
          onChange={(event) => setFullName(event.target.value.toUpperCase())}
          aria-describedby="full-name-hint"
          className={inputClass}
        />
        <p id="full-name-hint" className="text-[13px] text-[#3d3f3a]">
          {t("fullNameHint")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="document-type" className="text-sm font-semibold">
          {t("documentType")}
        </label>
        <select
          id="document-type"
          value={documentType}
          onChange={(event) => setDocumentType(event.target.value as DocumentType)}
          className={`${inputClass} bg-white`}
        >
          <option value="NRIC">{t("documentTypes.NRIC")}</option>
          <option value="PASSPORT">{t("documentTypes.PASSPORT")}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="document-number" className="text-sm font-semibold">
          {documentType === "NRIC" ? t("nricNumber") : t("passportNumber")}
        </label>
        <div className="flex gap-2">
          <input
            id="document-number"
            type={showDocument ? "text" : "password"}
            autoComplete="off"
            required
            value={documentNumber}
            onChange={(event) => setDocumentNumber(event.target.value)}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => setShowDocument((value) => !value)}
            className="h-12 rounded-[10px] border-[1.5px] border-black bg-white px-3.5 text-sm"
          >
            {showDocument ? t("hide") : t("show")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-semibold">
          {t("password")}
        </label>
        <div className="flex gap-2">
          <input
            id="password"
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
        <label htmlFor="confirm-password" className="text-sm font-semibold">
          {t("confirmPassword")}
        </label>
        <input
          id="confirm-password"
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
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
