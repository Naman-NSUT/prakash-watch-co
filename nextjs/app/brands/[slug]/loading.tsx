/**
 * What a brand's page shows while it is being built.
 *
 * Without this, clicking a house in the navigation did nothing visible for
 * several seconds — the browser stays on the old page until the new one is
 * ready, so the click reads as broken and people click again. A skeleton in the
 * shape of the page answers the click immediately and tells the eye where
 * things will land.
 */
export default function Loading() {
  return (
    <main style={{ position: "relative", minHeight: "100vh", background: "var(--bg)" }}>
      <section style={{ padding: "var(--page-top) var(--gutter) 30px" }}>
        <div className="skeleton" style={{ width: 160, height: 11, marginBottom: 30 }} />
        <div className="skeleton" style={{ width: "min(420px, 70vw)", height: 64, marginBottom: 20 }} />
        <div className="skeleton" style={{ width: "min(320px, 60vw)", height: 18, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: "min(540px, 80vw)", height: 14 }} />
      </section>

      <div className="shop-layout">
        <aside>
          {[180, 150, 165, 140].map((width, index) => (
            <div key={index} style={{ marginBottom: 26 }}>
              <div className="skeleton" style={{ width: 90, height: 10, marginBottom: 14 }} />
              <div className="skeleton" style={{ width, height: 12, marginBottom: 9 }} />
              <div className="skeleton" style={{ width: width - 30, height: 12, marginBottom: 9 }} />
              <div className="skeleton" style={{ width: width - 50, height: 12 }} />
            </div>
          ))}
        </aside>

        <div>
          <div className="skeleton" style={{ height: 42, marginBottom: 26 }} />
          <div className="shop-grid">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
                <div className="skeleton" style={{ aspectRatio: "1 / 1", borderRadius: 0 }} />
                <div style={{ padding: 16 }}>
                  <div className="skeleton" style={{ width: 60, height: 9, marginBottom: 12 }} />
                  <div className="skeleton" style={{ width: "90%", height: 15, marginBottom: 8 }} />
                  <div className="skeleton" style={{ width: "55%", height: 15, marginBottom: 18 }} />
                  <div className="skeleton" style={{ width: 80, height: 16 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
