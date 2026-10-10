import HomeSearch from "./HomeSearch";
export default function Hero() {
  return (
    <section id="top" style={{
      position: "relative", minHeight: "100vh", display: "grid", gridTemplateColumns: "var(--cols-hero)",
      alignItems: "center", gap: 40, padding: "var(--hero-top) var(--gutter) var(--hero-bottom)",
    }}>
      <div className="hero-film">
        {/* WebM first: a third of the size where it is supported. Both are silent —
            a hero that makes noise is a hero people close. */}
        <video autoPlay muted loop playsInline preload="metadata" poster="/hero/hero-poster.webp">
          <source src="/hero/hero.webm" type="video/webm" />
          <source src="/hero/hero.mp4" type="video/mp4" />
        </video>
      </div>
      <div style={{
        position: "absolute", top: "12%", right: "8%", width: 620, height: 620, borderRadius: 999,
        background: "radial-gradient(circle, oklch(0.72 0.14 34 / 0.16), transparent 62%)", filter: "blur(30px)", pointerEvents: "none",
      }} />
      <div style={{ position: "relative", zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 34 }}>
          <span style={{ width: 54, height: 1, background: "var(--accent)" }} />
          <span className="kicker" style={{ color: "var(--body)" }}>Delhi NCR · Four Boutiques</span>
        </div>
        <h1 className="serif" style={{ margin: 0, // Sized off the shorter dimension as well as the wider one: on a short
          // laptop window a headline picked by width alone pushed the search and
          // the figures below it off the first screen.
          fontSize: "clamp(56px, min(9.2vw, 15vh), 158px)", lineHeight: 0.85, letterSpacing: "-0.025em" }}>
          Time,<br /><span className="italic-accent">kept</span> well.
        </h1>
        <p style={{ maxWidth: 460, margin: "40px 0 0", fontSize: 17.5, lineHeight: 1.65, fontWeight: 300, color: "var(--body)", textWrap: "pretty" }}>
          Since 1976 we have sold, set and serviced fine watches across Delhi and Gurugram. Authorized
          retail for the houses that matter — and a workshop that keeps them running long after the sale.
        </p>
        <div style={{ display: "flex", gap: 14, marginTop: 38, flexWrap: "wrap" }}>
          <a className="btn btn-solid" href="#collection">Browse the collection</a>
          <a className="btn btn-ghost" href="#service">Book a service</a>
        </div>
      </div>

      {/* Its own row, spanning the grid, so it runs the width of the page
          under both columns rather than being squeezed beside the film. */}
      <HomeSearch />
      <div style={{
        position: "absolute", bottom: 34, left: "var(--gutter)", right: "var(--gutter)", display: "flex", alignItems: "flex-end",
        justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 18,
      }} className="hero-foot">
        <div className="mono hero-stats" style={{ display: "flex", gap: 56, fontSize: 10.5, letterSpacing: "0.2em", color: "var(--dim)", textTransform: "uppercase" }}>
          <span>50 Years of Service</span>
          <span>20+ Authorized Houses</span>
          <span>In-house Workshop</span>
        </div>
        <div className="mono hero-scroll" style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 10.5, letterSpacing: "0.2em", color: "var(--dim)" }}>
          <span>SCROLL</span>
          <span style={{ position: "relative", display: "block", width: 1, height: 46, background: "var(--line)", overflow: "hidden" }}>
            <span style={{ position: "absolute", top: 0, left: 0, width: 1, height: 14, background: "var(--accent)", animation: "drop 2.2s ease-in-out infinite" }} />
          </span>
        </div>
      </div>
    </section>
  );
}
