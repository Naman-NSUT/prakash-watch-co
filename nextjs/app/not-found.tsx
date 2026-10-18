import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata = { title: "Not here — Prakash Watch Co." };

/**
 * A wrong address, in the shop's own voice.
 *
 * The default was a bare line of system text on a white page, which reads as a
 * site that has fallen over rather than a page that has moved. A reference that
 * has sold, or a link that was typed wrong, deserves a way onward: the
 * collection, the search, or a person on the telephone.
 */
export default function NotFound() {
  return (
    <>
      <Nav />
      <main style={{ padding: "var(--page-top) var(--gutter) 130px", maxWidth: 680, margin: "0 auto" }}>
        <span className="kicker">404</span>
        <h1 className="h2" style={{ fontSize: "clamp(34px, 5.4vw, 64px)" }}>
          Nothing at <span className="italic-accent">this address</span>
        </h1>
        <p style={{ marginTop: 20, fontSize: 16.5, lineHeight: 1.8, fontWeight: 300, color: "var(--muted)", maxWidth: 520 }}>
          The page may have moved, or the watch may have left the case — a reference that sells comes off the website
          the same day. The collection is through here, and if you were looking for something particular we will find
          out whether it is still to be had.
        </p>
        <div style={{ display: "flex", gap: 13, marginTop: 32, flexWrap: "wrap" }}>
          <Link href="/collections" className="btn btn-solid">Browse the collection</Link>
          <a href="tel:+919899645897" className="btn btn-ghost">Call the boutique</a>
        </div>
      </main>
      <Footer />
    </>
  );
}
