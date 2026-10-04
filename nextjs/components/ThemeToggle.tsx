"use client";
import { useEffect, useState } from "react";

/**
 * Light or dark, and nothing else.
 *
 * The house style is Copper after dark and Linen by day. Both redefine the same
 * twenty-one tokens in globals.css, so switching swaps the whole site at once —
 * no component knows a theme exists.
 *
 * The choice is kept in localStorage and applied by a script in the document
 * head before the first paint, so a reload does not flash the wrong one.
 */
const LIGHT = "linen";
const DARK = "copper";

export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  // The head script has already set the attribute; read it rather than assume,
  // so the switch agrees with what is on screen.
  useEffect(() => {
    setLight(document.documentElement.dataset.theme === LIGHT);
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
      // The control reports what it will do, not what is showing — a switch
      // labelled with the current state reads as an instruction to everyone.
      aria-label={light ? "Switch to the dark palette" : "Switch to the light palette"}
      title={light ? "Switch to dark" : "Switch to light"}
    >
      <span className="theme-switch-track" data-light={light}>
        <span className="theme-switch-knob" />
      </span>
      <span className="mono theme-switch-label">{light ? "LINEN" : "COPPER"}</span>
    </button>
  );
}
