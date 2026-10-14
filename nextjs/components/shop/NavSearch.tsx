"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useBag } from "./Cart";

/**
 * The glass and the bag, at the right of the bar.
 *
 * Pressing the glass opens a field across the whole bar rather than a box
 * beside it: on a phone a search box squeezed next to a wordmark is four
 * characters wide, and on a laptop a full-width field makes it obvious that
 * the shop has stopped doing anything else and is waiting to be told what to
 * look for. Escape closes it, as does an empty blur.
 *
 * The bag's count comes from this browser's own storage, so it is drawn only
 * once that has been read — a 0 that becomes a 2 a moment later is worse than
 * a space that becomes a 2.
 */
export default function NavSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const bag = useBag();

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const wanted = term.trim();
    if (!wanted) return;
    setOpen(false);
    router.push(`/collections?q=${encodeURIComponent(wanted)}`);
  }

  return (
    <>
      <button
        type="button"
        className="nav-icon"
        aria-label="Search the collection"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.6-3.6" />
        </svg>
      </button>

      <Link href="/checkout" className="nav-icon" aria-label={`The bag — ${bag.count} watch${bag.count === 1 ? "" : "es"}`}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 7h12l-1 13H7L6 7z" />
          <path d="M9 7V5.5a3 3 0 016 0V7" />
        </svg>
        {bag.ready && bag.count > 0 && <span className="nav-bag-count mono">{bag.count}</span>}
      </Link>

      {/* Spans the bar. Rendered inside it so it inherits the bar's own ground
          and sits under the same shadow. */}
      <form className="nav-search" data-open={open} onSubmit={submit} role="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.6-3.6" />
        </svg>
        <input
          ref={field}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search a brand, a model or a reference…"
          aria-label="Search the collection"
          tabIndex={open ? 0 : -1}
        />
        <button type="button" className="nav-search-close" onClick={() => setOpen(false)} aria-label="Close the search" tabIndex={open ? 0 : -1}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </form>
    </>
  );
}
