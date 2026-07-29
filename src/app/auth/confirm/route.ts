import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/password-reset";

/**
 * Landing point for links in Supabase auth emails (recovery / invite / email change).
 *
 * Handles both link shapes so the flow works whichever email template the
 * project uses:
 *   - `token_hash` + `type`  → custom template using {{ .TokenHash }} (works
 *     even when the email is opened on another device).
 *   - `code`                 → default {{ .ConfirmationURL }} template with the
 *     PKCE flow; the verifier cookie was written by this same server client.
 *
 * The implicit-flow variant puts the tokens in a URL fragment, which never
 * reaches the server — /auth/reset-password picks that case up in the browser.
 *
 * On success the session is written to cookies and we forward to `next`;
 * on failure the user goes back to the request form with a plain error.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
    console.error("verifyOtp failed:", error.message);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    console.error("exchangeCodeForSession failed:", error.message);
  }

  return NextResponse.redirect(new URL("/login/lupa-password?error=link", origin));
}
