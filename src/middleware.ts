import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import type { Database } from "./types/database";

const intlMiddleware = createMiddleware(routing);

// Pages reachable without signing in (path after the locale prefix).
const publicPaths = [/^\/login$/, /^\/invite\/[^/]+$/, /^\/forgot-password$/, /^\/reset-password$/];

export default async function middleware(request: NextRequest) {
  const response = intlMiddleware(request);
  if (response.headers.has("location")) {
    return response;
  }

  // Refresh the Supabase session cookie on every request.
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [, first = "", ...rest] = request.nextUrl.pathname.split("/");
  const hasLocale = (routing.locales as readonly string[]).includes(first);
  const locale = hasLocale ? first : routing.defaultLocale;
  const path = "/" + (hasLocale ? rest : [first, ...rest]).join("/");
  const isPublic = publicPaths.some((pattern) => pattern.test(path));

  let target: string | null = null;
  if (!user && !isPublic) {
    target = `/${locale}/login`;
  } else if (user && path === "/login") {
    target = `/${locale}`;
  }
  if (!target) {
    return response;
  }

  const redirect = NextResponse.redirect(new URL(target, request.url));
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
