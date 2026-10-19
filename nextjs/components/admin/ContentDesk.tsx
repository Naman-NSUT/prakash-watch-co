"use client";

import { useState } from "react";
import type { SiteCopy } from "@/lib/site-copy";

/**
 * The front page's words, edited by the shop.
 *
 * Every claim on the front page used to be written into a component, so
 * correcting a sentence meant a developer and a deploy — and a figure nobody
 * could edit goes stale and then goes wrong. The shop's following was stated as
 * seventy thousand while the real number was forty-two.
 *
 * Layout and typography are deliberately not here. Those are design decisions,
 * and a stock room that could rearrange the front page is one nobody dares use.
 */
export default function ContentDesk({ initial }: { initial: SiteCopy }) {
  const [copy, setCopy] = useState<SiteCopy>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errors, setErrors] = useState<string[]>([]);

  async function save() {
    setState("saving");
    setErrors([]);
    try {
      const response = await fetch("/api/admin/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(copy),
      });
      const payload = await response.json();
      if (!response.ok) {
        setErrors(payload.errors ?? ["That did not save."]);
        setState("error");
        return;
      }
      setCopy(payload);
      setState("saved");
      window.setTimeout(() => setState("idle"), 2400);
    } catch {
      setErrors(["Could not reach the shop's server."]);
      setState("error");
    }
  }

  const field = (label: string, value: string, onChange: (next: string) => void, rows = 1) => (
    <label style={{ display: "block", marginTop: 14 }}>
      <span className="ops-sublabel" style={{ marginTop: 0 }}>{label}</span>
      {rows > 1 ? (
        <textarea
          className="ops-field"
          value={value}
          rows={rows}
          onChange={(event) => onChange(event.target.value)}
          style={{ width: "100%", resize: "vertical", lineHeight: 1.6 }}
        />
      ) : (
        <input
          className="ops-field"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{ width: "100%" }}
        />
      )}
    </label>
  );

  return (
    <div className="ops-desk">
      {errors.length > 0 && (
        <div className="ops-alert" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}

      <section className="ops-card">
        <h2 className="serif">The opening</h2>
        <p className="ops-note">The paragraph under the headline, and the three marks beneath the search bar.</p>
        {field("Opening paragraph", copy.hero.lead, (lead) => setCopy({ ...copy, hero: { ...copy.hero, lead } }), 4)}
        {copy.hero.marks.map((mark, index) => (
          <div key={index}>
            {field(`Mark ${index + 1}`, mark, (next) =>
              setCopy({
                ...copy,
                hero: { ...copy.hero, marks: copy.hero.marks.map((m, i) => (i === index ? next : m)) },
              }),
            )}
          </div>
        ))}
      </section>

      <section className="ops-card">
        <h2 className="serif">Heritage</h2>
        <p className="ops-note">
          The year, the story beside it, and the four figures in the block to its right. These are claims a customer
          may check — the following is the one that goes stale fastest.
        </p>
        {field("Year", copy.heritage.year, (year) => setCopy({ ...copy, heritage: { ...copy.heritage, year } }))}
        {copy.heritage.story.map((paragraph, index) => (
          <div key={index}>
            {field(`Paragraph ${index + 1}`, paragraph, (next) =>
              setCopy({
                ...copy,
                heritage: {
                  ...copy.heritage,
                  story: copy.heritage.story.map((p, i) => (i === index ? next : p)),
                },
              }), 4,
            )}
          </div>
        ))}
        <div className="ops-row">
          {field("Boutiques", copy.heritage.boutiques, (boutiques) => setCopy({ ...copy, heritage: { ...copy.heritage, boutiques } }))}
          {field("Authorized brands", copy.heritage.brands, (brands) => setCopy({ ...copy, heritage: { ...copy.heritage, brands } }))}
          {field("Advisor ratio", copy.heritage.advisor, (advisor) => setCopy({ ...copy, heritage: { ...copy.heritage, advisor } }))}
        </div>
        <p className="ops-note" style={{ marginTop: 12 }}>
          The Instagram following is not typed here — it is the shop's own figure, kept with the firm's details, and
          read from Instagram itself once that is connected.
        </p>
        {field("Assurance line", copy.heritage.assurance, (assurance) => setCopy({ ...copy, heritage: { ...copy.heritage, assurance } }))}
      </section>

      <section className="ops-card">
        <h2 className="serif">The foot of the page</h2>
        {field("Headline", copy.footer.headline, (headline) => setCopy({ ...copy, footer: { ...copy.footer, headline } }))}
        {field("Headline, second line", copy.footer.headlineAccent, (headlineAccent) => setCopy({ ...copy, footer: { ...copy.footer, headlineAccent } }))}
        {field("The line along the bottom", copy.footer.note, (note) => setCopy({ ...copy, footer: { ...copy.footer, note } }))}
      </section>

      <div className="ops-row">
        <button type="button" className="ops-btn" data-variant="solid" disabled={state === "saving"} onClick={save}>
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : "Save the words"}
        </button>
        <span className="ops-note" style={{ margin: 0 }}>
          The website picks these up within five minutes.
        </span>
      </div>
    </div>
  );
}
