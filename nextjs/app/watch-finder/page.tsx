import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import WatchFinder, { type Band, type FinderQuestion, type FinderRow } from "@/components/WatchFinder";
import { getCatalogIndex } from "@/lib/catalog";
import { FILTER_GROUPS } from "@/lib/filters";
import { isPriced } from "@/agent/types";
import type { CatalogEntry } from "@/agent/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Watch Finder — Prakash Watch Co.",
  description:
    "Answer five questions and see what is in the window. Every watch stocked at Prakash Watch Co., narrowed by who it is for, what it does and what you are spending.",
};

/** Budgets the shop's own range suggests, in rupees. */
const BANDS: Band[] = [
  { id: "a", label: "Under ₹5,000", min: null, max: 5000 },
  { id: "b", label: "₹5,000 – ₹15,000", min: 5000, max: 15000 },
  { id: "c", label: "₹15,000 – ₹30,000", min: 15000, max: 30000 },
  { id: "d", label: "₹30,000 – ₹60,000", min: 30000, max: 60000 },
  { id: "e", label: "Above ₹60,000", min: 60000, max: null },
];

const ASKS: { key: FinderQuestion["key"]; slot: FinderQuestion["slot"]; question: string; limit: number }[] = [
  { key: "gender", slot: 0, question: "Who is it for?", limit: 4 },
  { key: "collection", slot: 1, question: "What kind of watch?", limit: 8 },
  { key: "movement", slot: 2, question: "How should it keep time?", limit: 6 },
  { key: "strap", slot: 3, question: "On what?", limit: 6 },
];

/** The value a group reads off one listing, or "" when it does not have one. */
function valueOf(key: string, entry: CatalogEntry): string {
  const group = FILTER_GROUPS.find((candidate) => candidate.key === key);
  return group?.values(entry)[0] ?? "";
}

export default async function WatchFinderPage() {
  const index = await getCatalogIndex();
  const published = index.filter((entry) => entry.status === "ready");

  // Only offer an answer the shop can actually satisfy, and put the commonest
  // first: a finder that lists eight movements for a catalogue holding two is
  // a form, not a guide.
  const questions: FinderQuestion[] = ASKS.map((ask) => {
    const group = FILTER_GROUPS.find((candidate) => candidate.key === ask.key);
    const counts = new Map<string, number>();
    for (const entry of published) {
      const value = valueOf(ask.key, entry);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const options = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, ask.limit)
      .map(([value]) => ({ value, label: group?.label_for(value) ?? value }));

    return { key: ask.key, slot: ask.slot, question: ask.question, options };
  }).filter((question) => question.options.length > 1);

  const rows: FinderRow[] = published.map((entry) => [
    valueOf("gender", entry),
    valueOf("collection", entry),
    valueOf("movement", entry),
    valueOf("strap", entry),
    entry.brand,
    isPriced(entry) ? entry.price.selling : 0,
  ]);

  return (
    <main style={{ position: "relative", minHeight: "100vh", background: "var(--bg)", overflow: "hidden" }}>
      <div className="grain" />
      <NavBar />

      <section style={{ padding: "var(--page-top) var(--gutter) 10px" }}>
        <span className="kicker">Watch Finder</span>
        <h1 className="h2" style={{ fontSize: "clamp(36px, 4.6vw, 72px)", maxWidth: 900 }}>
          Tell us what you want,
          <br />
          <span className="italic-accent">we will open the case</span>
        </h1>
        <p style={{ maxWidth: 560, margin: "22px 0 0", fontSize: 15, lineHeight: 1.7, fontWeight: 300, color: "var(--muted)" }}>
          Answer as much or as little as you like — the count moves as you go, and every piece it
          finds is on the shelf today. Skip anything that does not matter to you.
        </p>
      </section>

      <section style={{ padding: "26px var(--gutter) 130px" }}>
        <WatchFinder rows={rows} questions={questions} bands={BANDS} />
      </section>

      <Footer />
    </main>
  );
}
