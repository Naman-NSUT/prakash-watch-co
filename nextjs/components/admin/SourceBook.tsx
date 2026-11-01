"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ModelRecord, PublisherTally } from "@/lib/sourcebook.shared";

const PAGE_SIZE = 100;

/**
 * Every reference the agent has ever researched, and where it read it.
 *
 * Searchable by model number first, because that is how the question arrives:
 * a customer queries a specification, the shop types the reference, and the
 * answer is the page it was read from and the date it was read.
 */
const shortDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

export default function SourceBook({
  records,
  publishers,
}: {
  records: ModelRecord[];
  publishers: PublisherTally[];
}) {
  const [query, setQuery] = useState("");
  const [openSku, setOpenSku] = useState<string | null>(null);
  const [onlyDelisted, setOnlyDelisted] = useState(false);
  const [page, setPage] = useState(1);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (onlyDelisted && record.stillListed) return false;
      if (!needle) return true;
      return (
        record.modelNumber.toLowerCase().includes(needle) ||
        record.brand.toLowerCase().includes(needle) ||
        record.title.toLowerCase().includes(needle) ||
        record.sources.some((source) => source.publisher.toLowerCase().includes(needle))
      );
    });
  }, [records, query, onlyDelisted]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const shownPage = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const delisted = records.filter((record) => !record.stillListed).length;

  return (
    <div>
      <div className="ops-toolbar">
        <input
          className="ops-field ops-search"
          placeholder="Model number, brand or publisher…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          aria-label="Search the source book"
        />
        <div className="ops-filters">
          <button type="button" className="ops-filter" data-on={!onlyDelisted} onClick={() => { setOnlyDelisted(false); setPage(1); }}>
            All <span className="mono">{records.length}</span>
          </button>
          <button type="button" className="ops-filter" data-on={onlyDelisted} onClick={() => { setOnlyDelisted(true); setPage(1); }}>
            No longer listed <span className="mono">{delisted}</span>
          </button>
        </div>
      </div>

      {publishers.length > 0 && (
        <details className="ops-panel" style={{ marginBottom: "var(--ops-4)" }}>
          <summary className="ops-sublabel" style={{ cursor: "pointer", margin: 0 }}>
            Which publishers are worth reading — {publishers.length} seen
          </summary>
          <table className="ops-table" style={{ marginTop: "var(--ops-3)" }}>
            <thead>
              <tr>
                <th>Publisher</th><th>Kind</th>
                <th className="ops-num">Models</th><th className="ops-num">Specs given</th><th className="ops-num">Photos</th>
              </tr>
            </thead>
            <tbody>
              {publishers.slice(0, 25).map((row) => (
                <tr key={row.publisher}>
                  <td>{row.publisher}</td>
                  <td><span className="mono" style={{ fontSize: 9, color: row.kind === "official" ? "var(--accent)" : "var(--faint)" }}>{row.kind}</span></td>
                  <td className="ops-num">{row.models}</td>
                  <td className="ops-num">{row.specs}</td>
                  <td className="ops-num">{row.images || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {shown.length === 0 ? (
        <p className="ops-empty">
          {records.length === 0
            ? "Nothing recorded yet. Every watch the agent researches adds its sources here."
            : "No reference matches that."}
        </p>
      ) : (
        <div className="ops-tickets">
          {shownPage.map((record) => {
            const open = openSku === record.sku;
            return (
              <article key={`${record.brand}-${record.modelNumber}`} className="ops-ticket" data-open={open}>
                <button
                  type="button"
                  className="ops-price-head"
                  onClick={() => setOpenSku(open ? null : record.sku)}
                  aria-expanded={open}
                >
                  <span className="ops-ticket-who">
                    <b>{record.title || `${record.brand} ${record.modelNumber}`}</b>
                    <span className="mono">{record.brand} · {record.modelNumber}</span>
                  </span>
                  <span className="ops-price-figs mono">
                    <span>{record.sources.length} source{record.sources.length === 1 ? "" : "s"}</span>
                    <span className="ops-price-mrp">
                      read {shortDate(record.lastSeen)}
                      {record.runs > 1 && ` · ${record.runs} runs`}
                    </span>
                  </span>
                  <span className={`ops-pill ${record.stillListed ? "ops-verdict-unchanged" : "ops-verdict-no-data"}`}>
                    {record.stillListed ? "Listed" : "Not listed"}
                  </span>
                </button>

                {open && (
                  <div className="ops-ticket-body">
                    <div style={{ paddingTop: "var(--ops-4)" }}>
                      <span className="ops-sublabel">Pages read, and what each gave</span>
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>Page</th><th>Kind</th><th>Read</th>
                            <th className="ops-num">Specs</th><th className="ops-num">Photos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {record.sources.map((source) => (
                            <tr key={source.url}>
                              <td style={{ maxWidth: 460 }}>
                                <a href={source.url} target="_blank" rel="noreferrer" style={{ color: "var(--body)" }}>
                                  {source.publisher || source.url}
                                </a>
                                <div className="mono" style={{ fontSize: 8.5, color: "var(--faint)", marginTop: 3, wordBreak: "break-all" }}>
                                  {source.url}
                                </div>
                              </td>
                              <td>
                                <span className="mono" style={{ fontSize: 9, color: source.kind === "official" ? "var(--accent)" : "var(--faint)" }}>
                                  {source.kind}
                                </span>
                              </td>
                              <td className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>{shortDate(source.fetchedAt)}</td>
                              <td className="ops-num">{source.gaveSpecs || "—"}</td>
                              <td className="ops-num">{source.gaveImages || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {record.imageSources.length > 0 && (
                        <>
                          <span className="ops-sublabel">Photograph files</span>
                          <ul className="ops-quotes">
                            {record.imageSources.map((url) => (
                              <li key={url} style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                                <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 10.5, wordBreak: "break-all" }}>{url}</a>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}

                      <div className="ops-mover-foot" style={{ marginTop: "var(--ops-3)" }}>
                        {record.stillListed && (
                          <Link href={`/admin/review/${record.sku}`} className="ops-btn">Open the listing</Link>
                        )}
                        <span className="ops-quoted mono">
                          First researched {shortDate(record.firstSeen)} · match {(record.matchConfidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {shown.length > PAGE_SIZE && (
        <nav className="ops-pager" aria-label="Source book pages">
          <span className="mono ops-pager-count">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, shown.length)} OF {shown.length}
          </span>
          <span className="ops-pager-steps">
            <button
              type="button"
              className="ops-btn"
              disabled={safePage === 1}
              onClick={() => { setPage((current) => Math.max(1, current - 1)); setOpenSku(null); }}
            >
              ← Previous
            </button>
            <span className="mono ops-pager-of">{safePage} / {pages}</span>
            <button
              type="button"
              className="ops-btn"
              disabled={safePage === pages}
              onClick={() => { setPage((current) => Math.min(pages, current + 1)); setOpenSku(null); }}
            >
              Next →
            </button>
          </span>
        </nav>
      )}
    </div>
  );
}
