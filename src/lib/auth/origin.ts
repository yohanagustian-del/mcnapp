import { headers } from "next/headers";

/**
 * Origin used to build absolute links sent outside the app (email, WA).
 * NEXT_PUBLIC_SITE_URL wins when set (stable across preview deploys);
 * otherwise derive from the proxy headers. Server-only (uses next/headers).
 */
export async function resolveOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
