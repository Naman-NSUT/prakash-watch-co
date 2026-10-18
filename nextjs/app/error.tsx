"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * When the shop itself fails.
 *
 * Separate from the 404, because the answer is different: nothing the customer
 * did caused this and no amount of looking elsewhere will fix it. So it says so
 * plainly, offers the one thing that sometimes works, and gives a telephone
 * number — a person can always sell a watch.
 *
 * It cannot use the site's own navigation: this renders when something below it
 * has already thrown, and a header that depends on the same data would throw
 * again inside the handler.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest is what ties this to the server's own log.
    console.error("Shop error", error.digest, error);
  }, [error]);

  return (
    <main style={{ padding: "160px var(--gutter) 130px", maxWidth: 680, margin: "0 auto" }}>
      <span className="kicker">Something broke</span>
      <h1 className="h2" style={{ fontSize: "clamp(32px, 5vw, 56px)" }}>
        That is <span className="italic-accent">our fault</span>
      </h1>
      <p style={{ marginTop: 20, fontSize: 16.5, lineHeight: 1.8, fontWeight: 300, color: "var(--muted)", maxWidth: 520 }}>
        The page could not be put together. Nothing you did caused it and nothing was charged. Try once more — most of
        these pass — and if it happens again, telephone us and we will deal with it on the spot.
      </p>
      <div style={{ display: "flex", gap: 13, marginTop: 32, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-solid" onClick={reset}>Try again</button>
        <Link href="/" className="btn btn-ghost">Back to the shop</Link>
        <a href="tel:+919899645897" className="btn btn-ghost">Call the boutique</a>
      </div>
      {error.digest && (
        <p className="mono" style={{ marginTop: 28, fontSize: 9.5, letterSpacing: ".16em", color: "var(--faint)", textTransform: "uppercase" }}>
          Reference {error.digest}
        </p>
      )}
    </main>
  );
}
