"use client";
import { useEffect, useState } from "react";

/**
 * Trying the house style in four palettes.
 *
 * Nothing here knows about any component: each theme redefines the same twenty-one
 * tokens in globals.css, so switching swaps the whole site at once. The choice is
 * kept in localStorage and applied by a script in the document head before the
 * first paint, so a reload does not flash the default first.
 */
const THEMES = [
  { id: "copper", name: "Copper", note: "Dark · the current house style", dot: "#c2714a", ground: "#0e0d0c" },
  { id: "ivory", name: "Ivory", note: "Light · warm paper", dot: "#9a5c33", ground: "#f7f4ef" },
  { id: "porcelain", name: "Porcelain", note: "Light · cool gallery white", dot: "#3f6491", ground: "#f3f5f8" },
  { id: "dusk", name: "Dusk", note: "Between the two · slate and brass", dot: "#d4a960", ground: "#2a313b" },
  { id: "graphite", name: "Graphite", note: "Dark · cool charcoal", dot: "#6fb5c4", ground: "#2f3233" },
  { id: "linen", name: "Linen", note: "Light · off-white and beige", dot: "#8a7326", ground: "#fdfbf6" },
] as const;

export const THEME_IDS = THEMES.map((t) => t.id);

export default function ThemeToggle() {
  const [theme, setTheme] = useState<string>("copper");
  const [open, setOpen] = useState(false);

  // The head script has already set the attribute; read it rather than assume,
  // so the control agrees with what is on screen.
  useEffect(() => {
    const current = document.documentElement.dataset.theme || "copper";
    setTheme(current);
  }, []);

  function choose(id: string) {
    setTheme(id);
    if (id === "copper") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = id;
    }
    try {
      localStorage.setItem("pwc-theme", id);
    } catch {
      // A private window refuses storage; the choice simply lasts the session.
    }
  }

  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div
      className="theme-switch"
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 95,
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Colour theme: ${active.name}. Choose another.`}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 11px",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          color: "var(--body)",
          fontSize: 9.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span
          aria-hidden
          style={{ width: 9, height: 9, borderRadius: "50%", background: active.dot, flexShrink: 0 }}
        />
        {active.name}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Colour theme"
          style={{
            marginTop: 6,
            minWidth: 232,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={t.id === theme}
              onClick={() => {
                choose(t.id);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: t.id === theme ? "var(--card-hover)" : "transparent",
                border: "none",
                borderBottom: "1px solid var(--line)",
                color: "var(--body)",
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                  background: t.ground,
                  border: "1px solid var(--border)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.dot }} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: t.id === theme ? "var(--accent)" : "var(--text)",
                  }}
                >
                  {t.name}
                </span>
                <span style={{ fontSize: 9.5, letterSpacing: "0.04em", color: "var(--faint)" }}>
                  {t.note}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
