import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authMode } from "@/lib/auth";
import { PUBLIC_PAGES } from "@/lib/pages";
import { supabasePublicConfig } from "@/lib/supabase-server";

// Runs before every request (Next 16's renamed middleware). Two jobs only (plans/auth.md A4):
//   1. Refresh the Supabase session and write the new cookies, so pages and route handlers in
//      this request see a valid token.
//   2. Optimistic redirect: signed-out page requests go to /welcome.
// It is not the security boundary: route handlers check the user themselves (lib/auth.ts) and
// row-level security checks again in the database. API requests are never redirected; they get 401.

export function isPublicPath(path: string): boolean {
  if (path.startsWith("/api/") || path.startsWith("/auth/")) return true;
  return PUBLIC_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
}

export default async function proxy(request: NextRequest) {
  const config = supabasePublicConfig();
  if (authMode() !== "supabase" || !config) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub || isPublicPath(request.nextUrl.pathname)) return response;

  const to = request.nextUrl.clone();
  to.pathname = "/welcome";
  to.search = "";
  const redirect = NextResponse.redirect(to);
  // Keep any cookie changes (e.g. a cleared, expired session) on the redirect too.
  for (const c of response.cookies.getAll()) redirect.cookies.set(c);
  return redirect;
}

export const config = {
  // Everything except build output, image optimisation and static files in public/.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
