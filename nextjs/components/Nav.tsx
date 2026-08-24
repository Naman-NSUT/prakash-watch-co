import Link from "next/link";

export default function Nav() {
  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, display: "flex", alignItems: "center",
      justifyContent: "space-between", padding: "26px 44px", backdropFilter: "blur(14px)",
      background: "linear-gradient(180deg, rgba(8,8,7,0.85), rgba(8,8,7,0))",
    }}>
      <Link href="/" style={{ display: "flex", flexDirection: "column", lineHeight: 0.95 }}>
        <span className="serif" style={{ fontSize: 25 }}>Prakash</span>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.42em", color: "var(--muted)", textTransform: "uppercase" }}>Watch Co.</span>
      </Link>
      <div style={{ display: "flex", gap: 38, alignItems: "center", fontSize: 13.5, letterSpacing: "0.13em", textTransform: "uppercase", color: "#cdc5be" }}>
        <Link href="/collections">Collection</Link>
        <Link href="/#heritage">Heritage</Link>
        <Link href="/#service">Service</Link>
        <Link href="/#boutiques">Boutiques</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", animation: "breathe 2.6s ease-in-out infinite" }} />
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.24em", color: "var(--muted)" }}>EST. 1976</span>
      </div>
    </nav>
  );
}
