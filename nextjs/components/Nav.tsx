"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { useEffect, useRef, useState } from "react";

/**
 * The house navigation.
 *
 * Five destinations do not fit beside a wordmark on a phone, so below 900px the
 * links move into a panel. The panel is a real dialog rather than a dropdown:
 * it traps nothing, but it closes on Escape, on navigation and on the backdrop,
 * and it returns focus to the button that opened it — which is the difference
 * between a menu a keyboard can use and one it gets stranded inside.
 */
export interface NavBrand {
  slug: string;
  name: string;
  count: number;
}

const LINKS: { href: string; label: string; brands?: true }[] = [
  { href: "/collections", label: "Collection" },
  { href: "/brands", label: "Brands", brands: true },
  { href: "/watch-finder", label: "Watch Finder" },
  { href: "/offers", label: "Offers" },
  { href: "/service", label: "Service" },
  { href: "/#boutiques", label: "Boutiques" },
];

export default function Nav({ brands = [] }: { brands?: NavBrand[] }) {
  const [open, setOpen] = useState(false);
  // Only the phone panel needs state. On a pointer device the flyout is opened
  // by :hover and :focus-within, so it works with the keyboard and costs no JS.
  const [brandsOpen, setBrandsOpen] = useState(false);
  const pathname = usePathname();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // A route change means the menu has done its job.
  useEffect(() => {
    setOpen(false);
    setBrandsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };

    // The page behind a full-height panel must not scroll under it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    addEventListener("keydown", onKey);
    panel.current?.focus();

    return () => {
      document.body.style.overflow = previous;
      removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <nav
        style={{
          // Above the menu panel (z-70): the bar itself creates a stacking context,
          // so the close button cannot be lifted over the panel from inside it.
          // Keeping the whole bar on top leaves the wordmark and the X in reach.
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 80, display: "flex", alignItems: "center",
          justifyContent: "space-between",
        }}
        className="site-nav"
      >
        <Link href="/" className="nav-wordmark" style={{ display: "flex", flexDirection: "column", lineHeight: 0.95 }}>
          <span className="serif" style={{ fontSize: 25 }}>Prakash</span>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.42em", color: "var(--muted)", textTransform: "uppercase" }}>
            Watch Co.
          </span>
        </Link>

        <div
          className="nav-links"
          style={{
            display: "flex", gap: 38, alignItems: "center", fontSize: 13.5, letterSpacing: "0.13em",
            textTransform: "uppercase", color: "var(--body)",
          }}
        >
          {LINKS.map((link) =>
            link.brands && brands.length > 0 ? (
              <span key={link.href} className="nav-brands">
                <Link href={link.href} aria-haspopup="true">
                  {link.label}
                  <span aria-hidden className="nav-caret">&#8964;</span>
                </Link>
                <span className="nav-brands-panel" role="group" aria-label="Brands we carry">
                  <span className="nav-brands-grid">
                    {brands.map((brand) => (
                      <Link key={brand.slug} href={`/brands/${brand.slug}`} className="nav-brand-link">
                        {brand.name}
                        <span className="mono nav-brand-count">{brand.count}</span>
                      </Link>
                    ))}
                  </span>
                  <Link href="/brands" className="nav-brands-all">
                    All houses &#8594;
                  </Link>
                </span>
              </span>
            ) : (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ),
          )}
        </div>

        <div className="nav-right">
          <div className="nav-est" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", animation: "breathe 2.6s ease-in-out infinite" }} />
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.24em", color: "var(--muted)" }}>EST. 1976</span>
          </div>

          <ThemeToggle />

          <button
            ref={button}
          type="button"
          className="nav-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="nav-panel"
          aria-label={open ? "Close menu" : "Open menu"}
        >
            <span className="nav-bar" data-open={open} />
            <span className="nav-bar" data-open={open} />
          </button>
        </div>
      </nav>

      <div
        id="nav-panel"
        ref={panel}
        tabIndex={-1}
        className="nav-panel"
        data-open={open}
        // Hidden from assistive tech and from the tab order while closed, so the
        // links cannot be reached behind the page.
        aria-hidden={!open}
        inert={!open}
      >
        <div className="nav-panel-inner">
          {LINKS.map((link, i) =>
            link.brands && brands.length > 0 ? (
              <div key={link.href} style={{ transitionDelay: open ? `${90 + i * 55}ms` : "0ms" }} className="nav-panel-link nav-panel-group">
                {/* A finger has no hover, so on a phone the houses open on a tap. */}
                <button
                  type="button"
                  className="nav-panel-trigger"
                  aria-expanded={brandsOpen}
                  onClick={() => setBrandsOpen((value) => !value)}
                >
                  <span className="mono nav-panel-no">{String(i + 1).padStart(2, "0")}</span>
                  <span className="serif">{link.label}</span>
                  <span aria-hidden className="nav-caret" data-open={brandsOpen}>&#8964;</span>
                </button>
                {brandsOpen && (
                  <div className="nav-panel-brands">
                    {brands.map((brand) => (
                      <Link key={brand.slug} href={`/brands/${brand.slug}`}>
                        {brand.name}
                      </Link>
                    ))}
                    <Link href="/brands" className="nav-panel-brands-all">
                      All houses &#8594;
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="nav-panel-link"
                style={{ transitionDelay: open ? `${90 + i * 55}ms` : "0ms" }}
              >
                <span className="mono nav-panel-no">{String(i + 1).padStart(2, "0")}</span>
                <span className="serif">{link.label}</span>
              </Link>
            ),
          )}

          <div className="nav-panel-foot">
            <span className="mono" style={{ fontSize: 10, letterSpacing: "0.24em", color: "var(--faint)" }}>EST. 1976</span>
            <a href="tel:+919899645897" className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--accent-soft)" }}>
              +91 98996 45897
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
