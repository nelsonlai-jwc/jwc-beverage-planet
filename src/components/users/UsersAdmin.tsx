"use client";

import { toast } from "@/components/ui/toast";
import { useFormatter, useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  cardClass,
  errorText,
  inputClass,
  labelClass,
  mutedText,
  primaryButton,
  secondaryButton,
} from "@/components/ui/styles";
import { useRouter } from "@/i18n/navigation";
import type { Outlet, UserRole } from "@/lib/auth/currentUser";
import { inviteUser } from "@/app/[locale]/(app)/users/actions";
import { sendPasswordResetEmail } from "@/lib/auth/passwordReset";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { OutletPicker } from "./OutletPicker";

type UserStatus = Database["public"]["Enums"]["user_status"];
type InvitationStatus = Database["public"]["Enums"]["invitation_status"];

type User = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  revision: number;
  superAdmin: boolean;
  outletIds: string[];
  documentType: Database["public"]["Enums"]["id_document_type"] | null;
  documentLast4: string | null;
};

type Invitation = {
  id: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  outletIds: string[];
};

const roles: UserRole[] = ["BARISTA", "MANAGER", "ADMIN"];
const statuses: UserStatus[] = ["ACTIVE", "SUSPENDED", "DEACTIVATED"];

const statusTone = {
  ACTIVE: "green",
  INVITED: "grey",
  SUSPENDED: "orange",
  DEACTIVATED: "red",
  PENDING: "purple",
  ACCEPTED: "green",
  EXPIRED: "grey",
  REVOKED: "grey",
} as const;

// Desktop (xl+) columns: name, email, role, outlets, ID, status, menu.
const userGrid =
  "xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_7.5rem_2rem] xl:gap-4";

type MenuItem = { label: string; disabled?: boolean; onSelect: () => void };

// "⋯" button that opens a small menu of row actions.
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        ref.current?.contains(event.target as Node)
      )
        return;
      setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5"
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-9 right-0 z-20 flex min-w-56 flex-col rounded-xl border border-black/15 bg-white p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap hover:bg-black/5 disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Outlet list fits the role: Barista at most one.
function fitOutlets(role: UserRole, ids: string[]): string[] {
  if (role === "BARISTA") return ids.slice(0, 1);
  return ids;
}

export function UsersAdmin({
  currentUserId,
  outlets,
  users,
  invitations,
}: {
  currentUserId: string;
  outlets: Outlet[];
  users: User[];
  invitations: Invitation[];
}) {
  const t = useTranslations("Users");
  const format = useFormatter();
  const router = useRouter();
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const outletNames = (ids: string[]) =>
    ids.map((id) => outletName.get(id) ?? "—").join(", ");
  const dateTime = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuala_Lumpur",
    });

  // Invite ---------------------------------------------------------------
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("BARISTA");
  const [inviteOutlets, setInviteOutlets] = useState<string[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [link, setLink] = useState<{
    email: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  const [sent, setSent] = useState<{ email: string; expiresAt: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  async function createInvite(target: {
    email: string;
    role: UserRole;
    outletIds: string[];
  }) {
    setInviteBusy(true);
    setInviteError(null);
    setLink(null);
    setSent(null);
    setCopied(false);
    const result = await inviteUser(target).catch(() => null);
    setInviteBusy(false);
    if (!result?.ok) {
      setInviteError(
        result?.error === "EMAIL_HAS_ACCOUNT"
          ? t("emailHasAccount")
          : result?.error === "OUTLET_RULE"
            ? t("outletRule")
            : result?.error === "NOT_ALLOWED"
              ? t("notAllowed")
              : t("inviteFailed"),
      );
      return false;
    }
    if (result.emailed) {
      setSent({ email: result.email, expiresAt: result.expiresAt });
      toast("invited");
    } else {
      // Only shown now: the database keeps a hash of the token, not the token.
      setLink({
        email: result.email,
        url: result.url,
        expiresAt: result.expiresAt,
      });
    }
    router.refresh();
    return true;
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inviteBusy) return;
    if (inviteRole === "ADMIN" && !window.confirm(t("adminConfirm"))) return;
    const ok = await createInvite({
      email: email.trim(),
      role: inviteRole,
      outletIds: fitOutlets(inviteRole, inviteOutlets),
    });
    if (ok) {
      setEmail("");
      setInviteOutlets([]);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // Pending invites past their expiry show as Expired.
  const shownStatus = (invitation: Invitation): InvitationStatus =>
    invitation.status === "PENDING" &&
    new Date(invitation.expiresAt) <= new Date()
      ? "EXPIRED"
      : invitation.status;

  // Each Resend adds a record, so show one card per email: the latest send, plus its history.
  const invitationGroups: Invitation[][] = [];
  const groupByEmail = new Map<string, Invitation[]>();
  for (const invitation of invitations) {
    const key = invitation.email.trim().toLowerCase();
    const group = groupByEmail.get(key);
    if (group) group.push(invitation);
    else {
      const created = [invitation];
      groupByEmail.set(key, created);
      invitationGroups.push(created);
    }
  }
  for (const group of invitationGroups) {
    group.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  invitationGroups.sort((a, b) => b[0].createdAt.localeCompare(a[0].createdAt));

  async function deleteInvitations(email: string) {
    if (!window.confirm(t("deleteInvitesConfirm", { email }))) return;
    setInviteError(null);
    const { error } = await createClient().rpc("delete_invitations", {
      p_email: email,
    });
    if (error) setInviteError(t("actionFailed"));
    else toast("deleted");
    router.refresh();
  }

  async function revoke(invitation: Invitation) {
    if (!window.confirm(t("revokeConfirm", { email: invitation.email })))
      return;
    const { error } = await createClient().rpc("revoke_invitation", {
      p_invitation_id: invitation.id,
    });
    if (error) setInviteError(t("actionFailed"));
    router.refresh();
  }

  // Users ----------------------------------------------------------------
  const [editing, setEditing] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>("BARISTA");
  const [editStatus, setEditStatus] = useState<UserStatus>("ACTIVE");
  const [editOutlets, setEditOutlets] = useState<string[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  function startEdit(user: User) {
    setEditing(user.id);
    setEditRole(user.role);
    setEditStatus(user.status === "INVITED" ? "ACTIVE" : user.status);
    setEditOutlets(user.outletIds);
    setEditError(null);
  }

  async function saveUser(event: FormEvent<HTMLFormElement>, user: User) {
    event.preventDefault();
    if (editBusy) return;
    if (
      editRole === "ADMIN" &&
      user.role !== "ADMIN" &&
      !window.confirm(t("adminConfirm"))
    )
      return;
    setEditBusy(true);
    setEditError(null);
    const { error } = await createClient().rpc("admin_update_user", {
      p_user_id: user.id,
      p_role: editRole,
      p_status: editStatus,
      p_outlet_ids: fitOutlets(editRole, editOutlets),
      p_expected_revision: user.revision,
    });
    setEditBusy(false);
    if (error) {
      setEditError(
        error.message === "REVISION_CONFLICT"
          ? t("conflict")
          : error.message.includes("last active Admin")
            ? t("lastAdmin")
            : error.code === "23514"
              ? t("outletRule")
              : error.code === "42501"
                ? t("notAllowed")
                : t("actionFailed"),
      );
      router.refresh();
      return;
    }
    setEditing(null);
    toast("saved");
    router.refresh();
  }

  // Password reset ---------------------------------------------------------
  const [resetBusy, setResetBusy] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});

  async function sendReset(user: User) {
    if (resetBusy || !window.confirm(t("resetConfirm", { email: user.email })))
      return;
    setResetBusy(user.id);
    // English by default; the reset page has a language switch.
    const result = await sendPasswordResetEmail(user.email, "en");
    setResetBusy(null);
    setResetResult({
      ...resetResult,
      [user.id]:
        result === "sent"
          ? { ok: true, message: t("resetSent", { email: user.email }) }
          : {
              ok: false,
              message:
                result === "rateLimited"
                  ? t("resetRateLimited")
                  : t("resetFailed"),
            },
    });
  }

  async function reveal(user: User) {
    const { data, error } = await createClient().rpc("reveal_identity_number", {
      p_user_id: user.id,
    });
    if (!error && data) setRevealed({ ...revealed, [user.id]: data });
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleInvite}
        className={`${cardClass} flex flex-col gap-4`}
      >
        <h2 className="text-base font-semibold">{t("inviteTitle")}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-email" className={labelClass}>
              {t("email")}
            </label>
            <input
              id="invite-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-role" className={labelClass}>
              {t("role")}
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(event) => {
                const role = event.target.value as UserRole;
                setInviteRole(role);
                setInviteOutlets(fitOutlets(role, inviteOutlets));
              }}
              className={inputClass}
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <OutletPicker
          idPrefix="invite"
          role={inviteRole}
          outlets={outlets}
          value={inviteOutlets}
          onChange={setInviteOutlets}
        />
        <p className={mutedText}>{t("inviteHint")}</p>
        {inviteError && (
          <p role="alert" className={errorText}>
            {inviteError}
          </p>
        )}
        <button
          type="submit"
          disabled={inviteBusy}
          className={`${primaryButton} self-start`}
        >
          {inviteBusy ? t("creatingLink") : t("createLink")}
        </button>
        {sent && (
          <div
            className="flex flex-col gap-2 rounded-[14px] border-[1.5px] border-brand-leaf p-4"
            role="status"
          >
            <p className="text-sm font-semibold">
              {t("emailSent", { email: sent.email })}
            </p>
            <p className={mutedText}>
              {t("emailSentNote", { date: dateTime(sent.expiresAt) })}
            </p>
          </div>
        )}
        {link && (
          <div
            className="flex flex-col gap-2 rounded-[14px] border-[1.5px] border-brand-orange p-4"
            role="status"
          >
            <p className="text-sm font-semibold">
              {t("emailFailed", { email: link.email })}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={link.url}
                aria-label={t("inviteLink")}
                onFocus={(event) => event.target.select()}
                className={`${inputClass} w-full text-sm sm:flex-1`}
              />
              <button
                type="button"
                onClick={copyLink}
                className={`${secondaryButton} shrink-0`}
              >
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
            <p className={mutedText}>
              {t("linkNote", { date: dateTime(link.expiresAt) })}
            </p>
          </div>
        )}
      </form>

      {invitations.length > 0 && (
        <section
          className="flex flex-col gap-3"
          aria-labelledby="invitations-heading"
        >
          <h2 id="invitations-heading" className="text-base font-semibold">
            {t("invitations")}
          </h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {invitationGroups.map((group) => {
              const invitation = group[0];
              const status = shownStatus(invitation);
              return (
                <li
                  key={invitation.id}
                  className={`${cardClass} flex flex-col gap-2`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold break-all">
                      {invitation.email}
                    </span>
                    <StatusBadge tone={statusTone[status]}>
                      {t(`invitationStatus.${status}`)}
                    </StatusBadge>
                  </div>
                  <p className="text-sm">
                    {t(`roles.${invitation.role}`)}
                    {invitation.outletIds.length > 0 &&
                      ` · ${outletNames(invitation.outletIds)}`}
                  </p>
                  <p className={mutedText}>
                    {t("lastSent", { date: dateTime(invitation.createdAt) })}
                    {group.length > 1 &&
                      ` · ${t("sentCount", { count: group.length })}`}
                  </p>
                  {status === "PENDING" && (
                    <p className={mutedText}>
                      {t("expires", { date: dateTime(invitation.expiresAt) })}
                    </p>
                  )}
                  {group.length > 1 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium">
                        {t("sendHistory")}
                      </summary>
                      <ol className="mt-2 flex flex-col gap-1">
                        {group.map((sentInvite) => {
                          const sentStatus = shownStatus(sentInvite);
                          return (
                            <li
                              key={sentInvite.id}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <span>{dateTime(sentInvite.createdAt)}</span>
                              <StatusBadge tone={statusTone[sentStatus]}>
                                {t(`invitationStatus.${sentStatus}`)}
                              </StatusBadge>
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={inviteBusy}
                      onClick={() =>
                        createInvite({
                          email: invitation.email,
                          role: invitation.role,
                          outletIds: invitation.outletIds,
                        })
                      }
                      className={secondaryButton}
                    >
                      {t("newLink")}
                    </button>
                    {status === "PENDING" && (
                      <button
                        type="button"
                        onClick={() => revoke(invitation)}
                        className={secondaryButton}
                      >
                        {t("revoke")}
                      </button>
                    )}
                    {(status === "REVOKED" || status === "EXPIRED") && (
                      <button
                        type="button"
                        onClick={() => deleteInvitations(invitation.email)}
                        className={secondaryButton}
                      >
                        {t("deleteInvites")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="users-heading">
        <h2 id="users-heading" className="text-base font-semibold">
          {t("users")}
        </h2>
        <div className="rounded-[20px] bg-white">
          <div
            aria-hidden="true"
            className={`${userGrid} hidden border-b border-black/15 px-5 py-3 text-[13px] font-semibold text-[#3d3f3a] xl:grid`}
          >
            <span>{t("name")}</span>
            <span>{t("email")}</span>
            <span>{t("role")}</span>
            <span>{t("outlets")}</span>
            <span>{t("idNumber")}</span>
            <span>{t("status")}</span>
            <span className="w-8" />
          </div>
          <ul>
            {users.map((user) => {
              const roleText = user.superAdmin
                ? t("superAdmin")
                : t(`roles.${user.role}`);
              const outletText = user.superAdmin
                ? "—"
                : outletNames(user.outletIds);
              const idText = user.documentType
                ? (revealed[user.id] ?? `••••${user.documentLast4}`)
                : "—";
              const canEdit = !user.superAdmin;
              const canReset = !user.superAdmin && user.status === "ACTIVE";
              const canReveal =
                Boolean(user.documentType) && !revealed[user.id];
              const badge = (
                <StatusBadge tone={statusTone[user.status]}>
                  {t(`userStatus.${user.status}`)}
                </StatusBadge>
              );
              return (
                <li
                  key={user.id}
                  className="border-b border-black/10 px-4 py-3 last:border-0 sm:px-5"
                >
                  <div
                    className={`${userGrid} flex items-start gap-3 text-sm xl:items-center`}
                  >
                    {/* Phone / tablet: two compact lines */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1 xl:hidden">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{user.fullName}</span>
                        {badge}
                      </div>
                      <p className="text-[13px] [overflow-wrap:anywhere] text-[#3d3f3a]">
                        {[
                          user.email,
                          roleText,
                          ...(user.superAdmin ? [] : [outletText]),
                          ...(user.documentType
                            ? [
                                `${t(`documentTypes.${user.documentType}`)} ${idText}`,
                              ]
                            : []),
                        ].join(" · ")}
                      </p>
                    </div>
                    {/* Desktop: one row, info in columns */}
                    <span
                      className="hidden min-w-0 truncate font-semibold xl:block"
                      title={user.fullName}
                    >
                      {user.fullName}
                    </span>
                    <span
                      className="hidden min-w-0 truncate xl:block"
                      title={user.email}
                    >
                      {user.email}
                    </span>
                    <span className="hidden xl:block">{roleText}</span>
                    <span
                      className="hidden min-w-0 truncate xl:block"
                      title={outletText}
                    >
                      {outletText}
                    </span>
                    <span className="hidden font-mono whitespace-nowrap xl:block">
                      {user.documentType
                        ? `${t(`documentTypes.${user.documentType}`)} ${idText}`
                        : "—"}
                    </span>
                    <span className="hidden xl:block">{badge}</span>
                    {canEdit || canReset || canReveal ? (
                      <RowMenu
                        label={t("moreActions", { name: user.fullName })}
                        items={[
                          ...(canEdit
                            ? [
                                {
                                  label: t("edit"),
                                  onSelect: () => startEdit(user),
                                },
                              ]
                            : []),
                          ...(canReset
                            ? [
                                {
                                  label:
                                    resetBusy === user.id
                                      ? t("resetSending")
                                      : t("resetPassword"),
                                  disabled: resetBusy !== null,
                                  onSelect: () => sendReset(user),
                                },
                              ]
                            : []),
                          ...(canReveal
                            ? [
                                {
                                  label: t("showFull"),
                                  onSelect: () => reveal(user),
                                },
                              ]
                            : []),
                        ]}
                      />
                    ) : (
                      <span className="w-8 shrink-0" />
                    )}
                  </div>
                  {user.superAdmin && (
                    <p className={`${mutedText} mt-1`}>{t("superAdminNote")}</p>
                  )}

                  {editing === user.id && (
                    <form
                      onSubmit={(event) => saveUser(event, user)}
                      className="flex flex-col gap-3 pt-3"
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <label
                            htmlFor={`role-${user.id}`}
                            className={labelClass}
                          >
                            {t("role")}
                          </label>
                          <select
                            id={`role-${user.id}`}
                            value={editRole}
                            onChange={(event) => {
                              const role = event.target.value as UserRole;
                              setEditRole(role);
                              setEditOutlets(fitOutlets(role, editOutlets));
                            }}
                            className={inputClass}
                          >
                            {roles.map((role) => (
                              <option key={role} value={role}>
                                {t(`roles.${role}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label
                            htmlFor={`status-${user.id}`}
                            className={labelClass}
                          >
                            {t("status")}
                          </label>
                          <select
                            id={`status-${user.id}`}
                            value={editStatus}
                            disabled={user.id === currentUserId}
                            onChange={(event) =>
                              setEditStatus(event.target.value as UserStatus)
                            }
                            className={inputClass}
                          >
                            {statuses.map((status) => (
                              <option key={status} value={status}>
                                {t(`userStatus.${status}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <OutletPicker
                        idPrefix={`edit-${user.id}`}
                        role={editRole}
                        outlets={outlets}
                        value={editOutlets}
                        onChange={setEditOutlets}
                      />
                      {editError && (
                        <p role="alert" className={errorText}>
                          {editError}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={editBusy}
                          className={primaryButton}
                        >
                          {editBusy ? t("saving") : t("save")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className={secondaryButton}
                        >
                          {t("cancel")}
                        </button>
                      </div>
                    </form>
                  )}
                  {resetResult[user.id] && (
                    <p
                      role={resetResult[user.id].ok ? "status" : "alert"}
                      className={`mt-2 ${resetResult[user.id].ok ? "text-sm font-semibold text-[#2f6b1f]" : errorText}`}
                    >
                      {resetResult[user.id].message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
