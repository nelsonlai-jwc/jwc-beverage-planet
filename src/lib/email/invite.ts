import { sendEmail } from "./resend";

/** Sends the invite link through Resend, English first then Chinese. Returns false on any failure. */
export async function sendInviteEmail({ to, url }: { to: string; url: string }): Promise<boolean> {
  const text = [
    "You have been invited to JWC Beverage Planet.",
    "Open this link to set up your account. It is valid for 72 hours and works once:",
    url,
    "",
    "您已被邀请加入 JWC Beverage Planet。",
    "请打开以下链接建立账号。链接 72 小时内有效，只能使用一次：",
    url,
  ].join("\n");

  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#000">
<p>You have been invited to <strong>JWC Beverage Planet</strong>.</p>
<p>Open this link to set up your account. It is valid for 72 hours and works once.</p>
<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#000;color:#fff;border-radius:999px;text-decoration:none">Set up account</a></p>
<hr style="border:none;border-top:1px solid #c7c9c2;margin:24px 0">
<p>您已被邀请加入 <strong>JWC Beverage Planet</strong>。</p>
<p>请打开以下链接建立账号。链接 72 小时内有效，只能使用一次。</p>
<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#000;color:#fff;border-radius:999px;text-decoration:none">建立账号</a></p>
<p style="color:#555;font-size:13px">${url}</p>
</div>`;

  return sendEmail({
    to,
    subject: "Your JWC Beverage Planet invitation / JWC Beverage Planet 邀请",
    text,
    html,
  });
}
