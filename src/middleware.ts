import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh + auth gate. Role-level checks happen server-side in
 * requireMember/requirePermission (lib/rbac.ts) and in Postgres RLS —
 * middleware only guarantees "no session → /login".
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const isPublic =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    // M7 v2 §3.5/§6.6: public signup link + its submit endpoint — anonymous by
    // design, no team_members/creator_users session involved at all.
    request.nextUrl.pathname.startsWith("/join") ||
    request.nextUrl.pathname.startsWith("/api/join") ||
    // PRD R36/PR-18: invite-token activation — the creator has no session yet
    // (that's what this page creates), so it must be reachable unauthenticated.
    request.nextUrl.pathname.startsWith("/aktivasi") ||
    // Server-to-server bridges (PX-M3-A push out; PX catalog push in) — bearer
    // secret IS the access control (route handler itself), no Supabase session.
    request.nextUrl.pathname.startsWith("/api/bridge");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Log adopsi sistem (M3/QA): aktivitas per user → tool_usage_logs (RLS: insert own).
  // "Aktivitas" = full page load (GET + text/html), navigasi client-side App Router
  // (GET + header `rsc`, dikirim tiap kali user pindah halaman lewat <Link> tanpa
  // reload penuh) DAN submit Server Action (POST + header `next-action`, dikirim
  // tiap kali user menekan tombol yang memicu server action — upload, simpan
  // jadwal, dst). Tanpa dua yang terakhir, last access/last activity ketinggalan
  // jauh dari aktivitas nyata karena SPA navigation & form submit tidak pernah
  // memuat ulang HTML.
  // Prefetch (hover/viewport) selalu dikecualikan supaya tidak tercatat sebagai
  // aktivitas — hover di atas link belum tentu user benar-benar membuka halamannya.
  const isPrefetch =
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("next-router-prefetch") !== null;
  const isFullPageLoad =
    request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  const isClientNavigation = request.method === "GET" && request.headers.get("rsc") !== null;
  const isServerAction = request.method === "POST" && request.headers.get("next-action") !== null;

  if (user && !isPublic && !isPrefetch && (isFullPageLoad || isClientNavigation || isServerAction)) {
    try {
      await supabase
        .from("tool_usage_logs")
        .insert({ member_id: user.id, path: request.nextUrl.pathname });
    } catch {
      // ignore — usage log is best-effort
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
