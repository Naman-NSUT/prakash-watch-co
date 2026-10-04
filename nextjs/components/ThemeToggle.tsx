"use client";
import { useEffect, useState } from "react";

/**
 * Light or dark.
 *
 * Two palettes, so this is a switch and not a menu, and it is drawn rather than
 * named: a sun or a moon reads at a glance in any language, where "Linen" means
 * nothing to anyone who has not been told. The icon shows what pressing it will
 * give you, which is the convention every operating system uses.
 *
 * It lives inside the navigation — see Nav and the stock room's rail — rather
 * than floating over a corner of the page. The choice is kept in localStorage
 * and applied by a script in the document head before the first paint, so a
 * reload does not flash the wrong palette.
 */
const LIGHT = "linen";
const DARK = "copper";

export default function ThemeToggle() {
  const [light, setLight] = useState(false);
  // Until the browser has been read the control does not know which palette is
  // showing, and an icon that corrects itself after a moment is worse than one
  // that arrives a moment late.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.dataset.theme === LIGHT);
    setReady(true);
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);

    // Copper is the default, so it is the absence of the attribute.
    if (next) document.documentElement.dataset.theme = LIGHT;
    else delete document.documentElement.dataset.theme;

    try {
      localStorage.setItem("pwc-theme", next ? LIGHT : DARK);
    } catch {
      // A private window refuses storage; the choice lasts the session.
    }
  }

  return (
    <button
      type="button"
      className="theme-switch"
      onClick={toggle}
      aria-label={light ? "Switch to the dark palette" : "Switch to the light palette"}
      title={light ? "Dark" : "Light"}
      data-ready={ready}
    >
      {light ? (
        // Showing light: offer the night.
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20.5 14.3A8.6 8.6 0 019.7 3.5a8.6 8.6 0 1010.8 10.8z" />
        </svg>
      ) : (
        // Showing dark: offer the day.
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.4v2.1M12 19.5v2.1M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M2.4 12h2.1M19.5 12h2.1M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5" />
        </svg>
      )}
    </button>
  );
}
