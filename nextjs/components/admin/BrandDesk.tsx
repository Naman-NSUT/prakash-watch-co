"use client";

import { useRef, useState } from "react";
import { formatInr } from "@/agent/format";

/**
 * One brand's desk: price its range from a spreadsheet, and dress its page.
 *
 * The discount sheet is deliberately two steps. The first upload only reads and
 * matches, and shows every line it would change with the old price beside the
 * new one. Nothing is written until the shop looks at that and presses the
 * second button — repricing a whole range is not something to discover
 * afterwards.
 */

interface Change {
  sku: string;
  reference: string;
  title: string;
  was: { selling: number | null; mrp: number | null };
  now: { selling: number; mrp: number | null; discountPct: number };
}

interface Report {
  brand: string;
  applied: boolean;
  onShelf: number;
  read: number;
  changes: Change[];
  unmatched: string[];
  skipped: { reference: string; reason: string }[];
  failed: { reference: string; reason: string }[];
}

const price = (value: number | null) => (value === null ? "—" : formatInr(value));

export default function BrandDesk({
  slug,
  name,
  listed,
  banner,
  bannerAlt,
}: {
  slug: string;
  name: string;
  listed: number;
  banner: string | null;
  bannerAlt: string | null;
}) {
  // --- the discount sheet ---------------------------------------------------
  const sheetInput = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<"read" | "apply" | "banner" | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  // --- the banner -----------------------------------------------------------
  const bannerInput = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<{ url: string | null; alt: string | null }>({
    url: banner,
    alt: bannerAlt,
  });
  const [alt, setAlt] = useState(bannerAlt ?? "");

  async function send(apply: boolean) {
    if (!sheet) return;
    setBusy(apply ? "apply" : "read");
    setErrors([]);

    const body = new FormData();
    body.set("file", sheet);
    body.set("apply", String(apply));

    try {
      const response = await fetch(`/api/admin/brands/${slug}/discounts`, { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) {
        setErrors(payload.errors ?? ["That did not work."]);
        setReport(null);
      } else {
        setReport(payload as Report);
      }
    } catch {
      setErrors(["Could not reach the shop's server."]);
    } finally {
      setBusy(null);
    }
  }

  async function uploadBanner() {
    const file = bannerInput.current?.files?.[0];
    if (!file) return;
    setBusy("banner");
    setErrors([]);

    const body = new FormData();
    body.set("banner", file);
    body.set("alt", alt.trim());

    try {
      const response = await fetch(`/api/admin/brands/${slug}/banner`, { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) setErrors(payload.errors ?? ["That image could not be saved."]);
      else {
        setCurrent({ url: payload.banner, alt: payload.bannerAlt });
        if (bannerInput.current) bannerInput.current.value = "";
      }
    } catch {
      setErrors(["Could not reach the shop's server."]);
    } finally {
      setBusy(null);
    }
  }

  async function removeBanner() {
    setBusy("banner");
    try {
      await fetch(`/api/admin/brands/${slug}/banner`, { method: "DELETE" });
      setCurrent({ url: null, alt: null });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ops-desk">
      {errors.length > 0 && (
        <div className="ops-alert" role="alert">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

      {/* --- discounts ------------------------------------------------- */}
      <section className="ops-card">
        <h2 className="serif">Discount sheet</h2>
        <p className="ops-note">
          A spreadsheet with a reference column — Model No, Ref, Article Code — and a <b>Discount %</b> beside it. A
          Price or MRP column works instead. Only the {listed} references already listed under {name} are touched;
          anything else is reported back, never created.
        </p>

        <div className="ops-row">
          <input
            ref={sheetInput}
            type="file"
            accept=".xlsx,.csv"
            onChange={(event) => {
              setSheet(event.target.files?.[0] ?? null);
              setReport(null);
            }}
          />
          <button type="button" className="ops-btn" disabled={!sheet || busy !== null} onClick={() => send(false)}>
            {busy === "read" ? "Reading…" : "Check what would change"}
          </button>
        </div>

        {report && (
          <div className="ops-report">
            <p className="ops-note">
              <b>{report.read}</b> lines read · <b>{report.changes.length}</b> would change ·{" "}
              <b>{report.unmatched.length}</b> not on the shelf · <b>{report.skipped.length}</b> skipped
              {report.applied && <span className="ops-done"> · applied</span>}
            </p>

            {report.changes.length > 0 && (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Watch</th>
                      <th>Was</th>
                      <th>Becomes</th>
                      <th>Off</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.changes.map((change) => (
                      <tr key={change.sku}>
                        <td className="mono">{change.reference}</td>
                        <td>{change.title}</td>
                        <td className="mono ops-was">{price(change.was.selling)}</td>
                        <td className="mono ops-now">{price(change.now.selling)}</td>
                        <td className="mono">{change.now.discountPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.unmatched.length > 0 && (
              <p className="ops-note ops-warn">
                Not on {name}&apos;s shelf, so left alone: {report.unmatched.slice(0, 24).join(", ")}
                {report.unmatched.length > 24 ? ` and ${report.unmatched.length - 24} more` : ""}.
              </p>
            )}

            {report.skipped.length > 0 && (
              <details className="ops-note">
                <summary>{report.skipped.length} lines skipped</summary>
                <ul>
                  {report.skipped.slice(0, 40).map((entry, index) => (
                    <li key={`${entry.reference}-${index}`}>
                      <span className="mono">{entry.reference}</span> — {entry.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {!report.applied && report.changes.length > 0 && (
              <button type="button" className="ops-btn" data-variant="solid" disabled={busy !== null} onClick={() => send(true)}>
                {busy === "apply" ? "Applying…" : `Apply to ${report.changes.length} watches`}
              </button>
            )}
          </div>
        )}
      </section>

      {/* --- banner ---------------------------------------------------- */}
      <section className="ops-card">
        <h2 className="serif">Page banner</h2>
        <p className="ops-note">
          A wide photograph across the top of {name}&apos;s page, above the watches. It fades in as the page settles.
          Anything you upload is cropped to 2400 × 820 and converted — send the largest you have.
        </p>

        {current.url ? (
          <div className="ops-banner-preview">
            {/* The shop's own upload, already sized by the server. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.url} alt={current.alt ?? ""} />
          </div>
        ) : (
          <p className="ops-note ops-warn">No banner yet — the page opens straight onto the wordmark.</p>
        )}

        <div className="ops-row">
          <input ref={bannerInput} type="file" accept="image/*" />
          <input
            type="text"
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
            placeholder="What the photograph shows"
            aria-label="Describe the banner"
            className="ops-field"
          />
          <button type="button" className="ops-btn" disabled={busy !== null} onClick={uploadBanner}>
            {busy === "banner" ? "Saving…" : current.url ? "Replace" : "Upload"}
          </button>
          {current.url && (
            <button type="button" className="ops-btn" disabled={busy !== null} onClick={removeBanner}>
              Remove
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
