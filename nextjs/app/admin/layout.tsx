import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import SignOutButton from "@/components/admin/SignOutButton";
import { isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stock room — Prakash Watch Co.",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login?next=/admin");

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          padding: "18px 34px",
          background: "rgba(8,8,7,0.92)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 26 }}>
          <Link href="/admin" style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="serif" style={{ fontSize: 21 }}>Prakash</span>
            <span className="mono" style={{ fontSize: 9, letterSpacing: "0.3em", color: "var(--accent)", textTransform: "uppercase" }}>
              Stock room
            </span>
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Link
            href="/collections"
            target="_blank"
            className="mono"
            data-hover
            style={{ fontSize: 9.5, letterSpacing: "0.18em", color: "var(--muted)", textTransform: "uppercase" }}
          >
            View shop ↗
          </Link>
          <SignOutButton />
        </div>
      </header>

      {children}
    </div>
  );
}
