"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Footer() {
  const [t, setT] = useState("--:--:--");
  useEffect(() => {
    const tick = () => setT(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <footer style={{ position: "relative", padding: "var(--section-y) var(--gutter) 40px", borderTop: "1px solid var(--line2)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "var(--cols-foot)", gap: "var(--gap-md)", paddingBottom: 90 }}>
        <div>
          <div className="serif" style={{ fontSize: "clamp(34px, 4vw, 62px)", lineHeight: 1, letterSpacing: "-0.02em" }}>
            Set your watch<br /><span className="italic-accent">with us</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 40 }}>
            <span className="mono" style={{ fontSize: 44, letterSpacing: "0.02em" }}>{t}</span>
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.2em", color: "var(--dim)" }}>INDIA<br />STANDARD<br />TIME</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 15, fontWeight: 300, color: "var(--body)" }}>
          <span className="kicker" style={{ letterSpacing: "0.24em" }}>Reach us</span>
          <a href="mailto:prakashwatchco@gmail.com">prakashwatchco@gmail.com</a>
          <a href="tel:+919899645897">+91 98996 45897</a>
          <a href="https://www.instagram.com/prakashwatchco/" target="_blank" rel="noreferrer">Instagram</a>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 15, fontWeight: 300, color: "var(--body)" }}>
          <span className="kicker" style={{ letterSpacing: "0.24em" }}>Explore</span>
          <Link href="/collections">Collection</Link>
          <Link href="/service">Repair &amp; services</Link>
          <Link href="/brands">Brands</Link>
          <a href="#boutiques">Boutiques</a>
        </div>
        {/* The terms a customer is entitled to find before they buy, not after.
            Kept in their own column so they are easy to reach and obviously not
            marketing. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 15, fontWeight: 300, color: "var(--body)" }}>
          <span className="kicker" style={{ letterSpacing: "0.24em" }}>The small print</span>
          <Link href="/legal/terms">Terms of sale</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/returns">Returns &amp; refunds</Link>
          <Link href="/legal/shipping">Shipping &amp; delivery</Link>
          <Link href="/legal/warranty">Warranty &amp; service</Link>
        </div>
      </div>
      <div className="mono" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--line2)",
        paddingTop: 22, fontSize: 10, letterSpacing: "0.2em", color: "var(--faint)", textTransform: "uppercase",
      }}>
        <span>PRAKASH WATCH CO. — DELHI NCR · SINCE 1976</span>
        <span>ALL PRICES INCLUDE GST</span>
      </div>
    </footer>
  );
}
