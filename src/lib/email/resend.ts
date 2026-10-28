const FROM = "JWC Beverage Planet <noreply@justwantcoffee.com>";

/** Sends one email through Resend. Returns false on any failure, never throws. */
export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...message, from: FROM, to: [message.to] }),
    });
    if (!response.ok) console.error("Email failed", response.status, await response.text());
    return response.ok;
  } catch (error) {
    console.error("Email failed", error);
    return false;
  }
}
