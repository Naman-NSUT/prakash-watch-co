import Link from "next/link";
import Reveal from "./Reveal";
import type { CollectionSummary } from "@/lib/catalog";

/**
 * The homepage index.
 *
 * There was a card here that followed the cursor and showed a watch from
 * whichever family you were pointing at. It read well on a wide screen and
 * badly everywhere else: it sat over the middle of the page, so the line you
 * were reading was behind the picture of the thing you had not chosen yet.
 * The lines carry their own count and description; they do not need a preview
 * of themselves. So it is gone, and with it the mouse listener that drove it.
 */
export default function Collection({ families }: { families: CollectionSummary[] }) {
  const total = families.reduce((sum, family) => sum + family.count, 0);

  return (
    <section id="collection" style={{ position: "relative", padding: "130px var(--gutter) 120px" }}>
      <Reveal style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 66 }}>
        <div>
          <span className="kicker">01 — The Index</span>
          <h2 className="h2" style={{ fontSize: "clamp(40px, 5.6vw, 92px)" }}>
            Six ways to<br /><span className="italic-accent">wear</span> a movement
          </h2>
        </div>
        <p style={{ maxWidth: 320, margin: 0, fontSize: 15.5, lineHeight: 1.7, fontWeight: 300, color: "var(--muted)" }}>
          {total > 0
            ? `${total} reference${total === 1 ? "" : "s"} stocked, sized and warranted in store. Take a line to see the shelf.`
            : "Every reference below is stocked, sized and warranted in store."}
        </p>
      </Reveal>

      <div style={{ borderTop: "1px solid var(--line)" }}>
        {families.map((family) => (
          <Link
            key={family.id}
            href={`/collections?family=${family.id}`}
            className="row index-row"
            style={{
              display: "grid", gridTemplateColumns: "76px 1.5fr 1fr 150px", alignItems: "center", gap: 24,
              padding: "30px 8px", borderBottom: "1px solid var(--line)",
              transition: "background-color .4s",
            }}
          >
            <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{family.no}</span>
            <span className="serif" style={{ fontSize: "clamp(28px, 3vw, 46px)", lineHeight: 1, letterSpacing: "-0.01em" }}>{family.name}</span>
            <span style={{ fontSize: 14.5, fontWeight: 300, color: "var(--muted)" }}>{family.note}</span>
            <span
              className="mono"
              style={{
                justifySelf: "end",
                fontSize: 11,
                letterSpacing: "0.18em",
                color: family.count > 0 ? "var(--accent)" : "var(--faint)",
              }}
            >
              {family.count > 0 ? `${family.count} IN STOCK` : "ASK IN STORE"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
