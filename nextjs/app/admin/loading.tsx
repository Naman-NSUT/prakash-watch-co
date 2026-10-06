/**
 * What the stock room shows while a page is being built.
 *
 * Every page here reads the whole catalogue, which is not instant even cached,
 * and the rail stays on screen while the panel changes. Without this the rail
 * highlighted the new section and then nothing happened for several seconds,
 * which reads as a dead link — the commonest report from the counter was that
 * "pages don't open".
 *
 * One file covers every route under /admin: Next uses the nearest loading
 * boundary, and the shapes here — a heading, a line of figures, a table — are
 * close enough to every page in the section to be worth more than a spinner.
 */
export default function Loading() {
  return (
    <>
      <div style={{ marginBottom: 30 }}>
        <div className="skeleton" style={{ width: 190, height: 30, marginBottom: 14 }} />
        <div className="skeleton" style={{ width: "min(620px, 80%)", height: 13, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: "min(420px, 60%)", height: 13 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 1, marginBottom: 26 }}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} style={{ background: "var(--card)", padding: "18px 20px" }}>
            <div className="skeleton" style={{ width: 70, height: 9, marginBottom: 14 }} />
            <div className="skeleton" style={{ width: 110, height: 26 }} />
          </div>
        ))}
      </div>

      <div style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
        {Array.from({ length: 10 }, (_, index) => (
          <div
            key={index}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr) 110px 90px",
              gap: 18,
              alignItems: "center",
              padding: "13px 18px",
              borderBottom: index === 9 ? "none" : "1px solid var(--line2)",
            }}
          >
            <div className="skeleton" style={{ height: 12 }} />
            <div className="skeleton" style={{ height: 12 }} />
            <div className="skeleton" style={{ height: 12 }} />
            <div className="skeleton" style={{ height: 12 }} />
          </div>
        ))}
      </div>
    </>
  );
}
