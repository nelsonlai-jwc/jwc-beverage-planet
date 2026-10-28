import { createClient, isAuthRetryableFetchError } from "@supabase/supabase-js";

export type ResetEmailResult = "sent" | "rateLimited" | "networkError" | "failed";

/**
 * Asks Supabase to email a password reset link that opens /<locale>/reset-password.
 * Uses the implicit flow so the link works in any browser, not only the one that
 * asked (an Admin sends it for someone else, or a user opens the email on another device).
 */
export async function sendPasswordResetEmail(email: string, locale: string): Promise<ResetEmailResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/${locale}/reset-password`,
  });
  if (!error) return "sent";
  if (isAuthRetryableFetchError(error)) return "networkError";
  if (error.status === 429) return "rateLimited";
  return "failed";
}
