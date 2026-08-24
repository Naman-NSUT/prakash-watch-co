import Link from "next/link";
import Image from "next/image";
import UploadPanel from "@/components/admin/UploadPanel";
import { getAllProducts, getRuns } from "@/lib/catalog";
import { formatInr, formatUsd } from "@/agent/format";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [products, runs] = await Promise.all([getAllProducts(), getRuns(5)]);

  const ready = products.filter((product) => product.status === "ready");
  const review = products.filter((product) => product.status !== "ready");
  const noImages = products.filter((product) => product.images.length === 0);
  const stockValue = ready.reduce((sum, product) => sum + product.price.selling * (product.quantity ?? 1), 0);

  return (
    <main style={{ padding: "38px 34px 90px", display: "flex", flexDirection: "column", gap: 40 }}>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 1, background: "var(--line)" }}>
        <Stat label="Listed" value={String(ready.length)} accent />
        <Stat label="Awaiting review" value={String(review.length)} />
        <Stat label="Without photographs" value={String(noImages.length)} />
        <Stat label="Retail value listed" value={formatInr(stockValue)} />
      </section>

      <UploadPanel />

      <section>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 className="serif" style={{ fontSize: 28, margin: 0, fontWeight: 400 }}>
            The stock list
          </h2>
          <span className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--faint)" }}>
            {products.length} ARTIFACT{products.length === 1 ? "" : "S"}
          </span>
        </div>

        {products.length === 0 ? (
          <p style={{ fontSize: 14.5, fontWeight: 300, color: "var(--muted)", border: "1px solid var(--line)", padding: 34 }}>
            Nothing ingested yet. Upload the shop's stock sheet above — brand, model number and price are all it needs.
          </p>
        ) : (
          <div style={{ border: "1px solid var(--line)" }}>
            {/* Watches needing attention float to the top of the list. */}
            {[...review, ...ready].map((product) => (
              <Link
                key={product.sku}
                href={`/admin/review/${product.sku}`}
                data-hover
                className="hover-card"
                style={{
                  display: "grid",
                  gridTemplateColumns: "58px 1.6fr 1fr 120px 90px 130px",
                  gap: 18,
                  alignItems: "center",
                  padding: "13px 16px",
                  borderBottom: "1px solid var(--line)",
                  background: "var(--card)",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: 46,
                    height: 46,
                    background: "#100e0d",
                    border: "1px solid var(--line)",
                    flexShrink: 0,
                  }}
                >
                  {product.images[0] ? (
                    <Image src={product.images[0].url} alt="" fill sizes="46px" style={{ objectFit: "contain", padding: 3 }} />
                  ) : null}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15 }}>{product.title}</div>
                  <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.14em", color: "var(--faint)", marginTop: 3 }}>
                    {product.modelNumber.toUpperCase()}
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {product.review.flags.slice(0, 3).map((flag) => (
                    <span
                      key={flag}
                      className="mono"
                      style={{
                        fontSize: 8.5,
                        letterSpacing: "0.1em",
                        padding: "3px 6px",
                        color: "var(--dim)",
                        border: "1px solid var(--line2)",
                        textTransform: "uppercase",
                      }}
                    >
                      {flag.replace(/-/g, " ")}
                    </span>
                  ))}
                </div>

                <span style={{ fontSize: 14 }}>{formatInr(product.price.selling)}</span>

                <span className="mono" style={{ fontSize: 10, color: "var(--faint)", letterSpacing: "0.12em" }}>
                  {product.images.length} IMG
                </span>

                <span
                  className="mono"
                  style={{
                    justifySelf: "end",
                    fontSize: 9.5,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: product.status === "ready" ? "var(--accent)" : "var(--dim)",
                  }}
                >
                  {product.status === "ready" ? "Listed" : "Review"} ·{" "}
                  {(product.confidence.overall * 100).toFixed(0)}%
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {runs.length > 0 && (
        <section>
          <h2 className="serif" style={{ fontSize: 24, margin: "0 0 18px", fontWeight: 400 }}>
            Recent runs
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "var(--line)", border: "1px solid var(--line)" }}>
            {runs.map((run) => (
              <div
                key={run.runId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 1fr 110px",
                  gap: 16,
                  padding: "13px 16px",
                  background: "var(--card)",
                  alignItems: "center",
                }}
              >
                <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: "var(--muted)" }}>
                  {run.runId.replace("run-", "")}
                </span>
                <span style={{ fontSize: 13, fontWeight: 300, color: "var(--muted)" }}>{run.sourceFile}</span>
                <span className="mono" style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--faint)" }}>
                  {run.counts.ready} READY · {run.counts.needsReview} REVIEW · {run.counts.failed} FAILED
                </span>
                <span className="mono" style={{ fontSize: 10, color: "var(--faint)", justifySelf: "end" }}>
                  {formatUsd(run.costUsd)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: "var(--card)", padding: "26px 24px" }}>
      <div className="kicker">{label}</div>
      <div
        className="serif"
        style={{ fontSize: 34, marginTop: 10, lineHeight: 1, color: accent ? "var(--accent-soft)" : "var(--text)" }}
      >
        {value}
      </div>
    </div>
  );
}
