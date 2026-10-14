import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = { title: "Thank you — Prakash Watch Co." };

export default async function OrderPlaced({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  return (
    <>
      <Nav />
      <main style={{ padding: "var(--page-top) var(--gutter) 130px", maxWidth: 720, margin: "0 auto" }}>
        <span className="kicker">Paid</span>
        <h1 className="h2" style={{ fontSize: "clamp(34px, 5vw, 58px)" }}>
          Thank you — it is <span className="italic-accent">ours to pack</span> now
        </h1>
        {order && (
          <p className="mono" style={{ marginTop: 20, fontSize: 11, letterSpacing: ".18em", color: "var(--accent-soft)" }}>
            {order}
          </p>
        )}
        <p style={{ marginTop: 18, fontSize: 16, lineHeight: 1.8, fontWeight: 300, color: "var(--muted)", maxWidth: 520 }}>
          We will call to confirm the address before it leaves the counter. Each watch is checked, set to the second
          and sized before it is packed, so give us a day before it ships.
        </p>
        <div style={{ display: "flex", gap: 13, marginTop: 30, flexWrap: "wrap" }}>
          <Link href="/collections" className="btn btn-solid">Keep looking</Link>
          <a href="tel:+919899645897" className="btn btn-ghost">Call the boutique</a>
        </div>
      </main>
      <Footer />
    </>
  );
}
