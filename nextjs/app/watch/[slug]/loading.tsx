/** A watch page, while it is being built. */
export default function Loading() {
  return (
    <main style={{ position: "relative", minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ padding: "var(--page-top) var(--gutter) 0" }}>
        <div className="skeleton" style={{ width: 140, height: 11, marginBottom: 34 }} />
        <div style={{ display: "grid", gridTemplateColumns: "var(--cols-watch)", gap: 54 }}>
          <div>
            <div className="skeleton" style={{ aspectRatio: "1 / 1" }} />
            <div style={{ display: "flex", gap: 14, marginTop: 14 }}>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="skeleton" style={{ width: 78, height: 78 }} />
              ))}
            </div>
          </div>
          <div>
            <div className="skeleton" style={{ width: 90, height: 10, marginBottom: 20 }} />
            <div className="skeleton" style={{ width: "85%", height: 40, marginBottom: 12 }} />
            <div className="skeleton" style={{ width: "55%", height: 40, marginBottom: 32 }} />
            <div className="skeleton" style={{ width: 150, height: 28, marginBottom: 30 }} />
            {[92, 80, 86, 70].map((width, index) => (
              <div key={index} className="skeleton" style={{ width: `${width}%`, height: 13, marginBottom: 11 }} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
