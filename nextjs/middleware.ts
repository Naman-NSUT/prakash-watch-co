/**
 * The gate in front of everything private.
 *
 * Every admin page already redirects from its layout, and every admin API route
 * checks for itself. Neither is enough on its own: Next.js does not re-run a
 * layout on client navigation, so a request crafted to fetch only a page segment
 * could render an admin page without the layout's check ever running — and those
 * pages show customers' names, telephone numbers and addresses. This runs on
 * every such request, including those.
 *
 * It is the outer check, not the only one. The routes keep theirs, so a matcher
 * that drifts out of date cannot silently expose one.
 */
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifyToken } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The one admin route that must be reachable without a session.
  if (pathname === "/api/admin/login") return NextResponse.next();

  if (await verifyToken(request.cookies.get(COOKIE_NAME)?.value)) {
    return NextResponse.next();
  }

  // Data and files are refused outright; a person is sent to sign in.
  if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) {
    return Response.json({ errors: ["Sign in to the admin panel first."] }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    // Photographs customers attach to repair tickets. Only the shop sees them.
    "/media/repairs/:path*",
  ],
};
