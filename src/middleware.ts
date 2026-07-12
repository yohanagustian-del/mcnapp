import { createServerClient } from "@supabase/ssr";
import { after, NextResponse, type NextRequest } from "next/server";

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
    request.nextUrl.pathname.startsWith("/auth");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Log adopsi sistem (M3/QA): page-view per user → tool_usage_logs (RLS: insert own).
  // Non-blocking via after() — halaman tidak menunggu penulisan log selesai; kegagalan diabaikan.
  if (
    user &&
    !isPublic &&
    request.method === "GET" &&
    request.headers.get("purpose") !== "prefetch" &&
    request.headers.get("next-router-prefetch") === null &&
    (request.headers.get("accept") ?? "").includes("text/html")
  ) {
    after(async () => {
      try {
        await supabase
          .from("tool_usage_logs")
          .insert({ member_id: user.id, path: request.nextUrl.pathname });
      } catch {
        // abaikan — usage log adalah best-effort
      }
    });
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
