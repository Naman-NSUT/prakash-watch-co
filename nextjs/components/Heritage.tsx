import Link from "next/link";
import Reveal from "./Reveal";
import { getFollowing, roundFollowing } from "@/lib/social";

/**
 * The counted figure replaces the typed one where it can be had.
 *
 * "74K" written into the page goes stale the week it is written. The real
 * number is read from Meta's API when the shop has connected it, cached for
 * six hours, and falls back to the figure in the shop's own details otherwise —
 * so the tile is never empty and never wrong for long.
 */
export default async function Heritage() {
  const following = await getFollowing();
  const stats = [
    { n: "04", l: "Boutiques in Delhi NCR", href: "" },
    { n: "20+", l: "Authorized brands", href: "/brands" },
    {
      n: following.count > 0 ? roundFollowing(following.count) : "—",
      l: "Following on Instagram",
      href: following.url,
    },
    { n: "1:1", l: "Every sale, one advisor", href: "" },
  ];
  return (
    <section id="heritage" style={{ position: "relative", padding: "var(--section-y) var(--gutter)", background: "var(--panel)", borderTop: "1px solid var(--line2)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "var(--cols-2)", gap: "var(--gap-xl)", alignItems: "center" }}>
        <Reveal>
          <span className="kicker">02 — Heritage</span>
          <div className="serif" style={{ margin: "26px 0 0", fontSize: "clamp(96px, 15vw, 230px)", lineHeight: 0.8, letterSpacing: "-0.04em" }}>1976</div>
          <p style={{ maxWidth: 480, margin: "42px 0 0", fontSize: 17, lineHeight: 1.7, fontWeight: 300, color: "var(--body)", textWrap: "pretty" }}>
            One counter in Sadar Bazar, Gurgaon. Fifty years later the family runs four multi-brand
            boutiques across Delhi NCR, an authorized service centre, and a following of more than
            seventy thousand people who come to us before they buy.
          </p>
          <p style={{ maxWidth: 480, margin: "22px 0 0", fontSize: 17, lineHeight: 1.7, fontWeight: 300, color: "var(--body)", textWrap: "pretty" }}>
            The trade changed. The habit did not: know the movement, price it honestly, stand behind it afterwards.
          </p>
        </Reveal>
        <Reveal style={{ display: "grid", gap: 1, background: "var(--line)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
            {stats.slice(0, 2).map((s) => <Stat key={s.l} {...s} />)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
            {stats.slice(2).map((s) => <Stat key={s.l} {...s} />)}
          </div>
          <div style={{ background: "var(--card)", padding: "var(--card-pad)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
            <span style={{ fontSize: 14.5, fontWeight: 300, color: "var(--body)" }}>Warranty and after-sales handled in house</span>
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.2em", color: "var(--accent)" }}>VERIFIED</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * One figure. A tile with somewhere to go becomes a link; the other two stay
 * plain, because an underline that leads nowhere is a broken promise.
 */
function Stat({ n, l, href }: { n: string; l: string; href: string }) {
  const body = (
    <>
      <div className="serif" style={{ fontSize: 62, lineHeight: 1, color: "var(--accent-soft)" }}>{n}</div>
      <div style={{ marginTop: 12, fontSize: 14, color: "var(--muted)", fontWeight: 300 }}>{l}</div>
    </>
  );
  const skin = { background: "var(--card)", padding: "var(--card-pad)", display: "block" } as const;

  if (!href) return <div style={skin}>{body}</div>;
  if (href.startsWith("http")) {
    return (
      <a className="hover-card" href={href} target="_blank" rel="noreferrer" style={skin}>
        {body}
      </a>
    );
  }
  return <Link className="hover-card" href={href} style={skin}>{body}</Link>;
}
