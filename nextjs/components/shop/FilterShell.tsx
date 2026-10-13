"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Where the filters live on a small screen.
 *
 * On a laptop the rail sits beside the watches and is simply there. On a phone
 * there is no beside: the same rail stacked above the grid pushed the first
 * watch nearly two screens down, which is a long way to scroll to find out the
 * shop has any stock. So on a phone it becomes what a phone expects — a button,
 * and a sheet that rises over the watches when it is pressed. The watches stay
 * where they were; the filter comes to them and leaves again.
 *
 * The rail itself is unchanged and still server-rendered: every option is a
 * link, counts are real, and the page filters without JavaScript. This adds
 * only the opening and closing, which is the one part that genuinely needs a
 * browser.
 */
export default function FilterShell({
  active,
  count,
  children,
}: {
  /** How many filters are on, for the button's badge. */
  active: number;
  /** How many watches the current filters leave, for the closing button. */
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  // While the sheet is up, the page behind it must not scroll — otherwise a
  // thumb on the scrim drags the catalogue instead. Escape closes it, as it
  // closes everything else. Both are undone on the way out, including when the
  // sheet closes because a filter was tapped.
  useEffect(() => {
    if (!open) return;

    const root = document.documentElement;
    const held = root.style.overflow;
    root.style.overflow = "hidden";
    root.dataset.sheet = "open";

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      // The watches behind the sheet are still in the tab order, and tabbing
      // into something under a scrim is the same as tabbing into nothing. So
      // Tab wraps around inside the sheet until it is dismissed.
      if (event.key !== "Tab") return;
      const inside = sheet.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!inside || inside.length === 0) return;
      const reachable = [...inside].filter((el) => el.offsetParent !== null);
      const first = reachable[0];
      const last = reachable[reachable.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }
    window.addEventListener("keydown", onKey);

    // A keyboard that opened the sheet should land inside it.
    close.current?.focus();

    return () => {
      root.style.overflow = held;
      delete root.dataset.sheet;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function shut() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="mono shop-filter-trigger"
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => setOpen(true)}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
          <path d="M2 4.5h12M4.5 8h7M7 11.5h2" />
        </svg>
        <span>Filters</span>
        {active > 0 ? <span className="shop-filter-count">{active}</span> : null}
      </button>

      {/* The watches stay visible under this, dimmed, so it is obvious what is
          being filtered. Pressing it is the same as pressing Done. */}
      <div className="shop-sheet-scrim" data-open={open} onClick={shut} aria-hidden />

      <aside
        ref={sheet}
        id={sheetId}
        className="shop-sidebar"
        data-open={open}
        aria-label="Filter the collection"
        {...(open ? { role: "dialog" as const, "aria-modal": true } : {})}
      >
        <div className="shop-sheet-head">
          <span className="mono">Filters{active > 0 ? ` (${active})` : ""}</span>
          <button ref={close} type="button" className="shop-sheet-close" onClick={shut} aria-label="Close the filters">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {children}

        <div className="shop-sheet-foot">
          <button type="button" className="shop-sheet-done" onClick={shut}>
            {typeof count === "number"
              ? `Show ${count.toLocaleString("en-IN")} ${count === 1 ? "watch" : "watches"}`
              : "Show the watches"}
          </button>
        </div>
      </aside>
    </>
  );
}
