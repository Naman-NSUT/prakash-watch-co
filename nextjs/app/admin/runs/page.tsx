import { basename } from "node:path";
import { Empty, PageHead, Stat } from "@/components/admin/ui";
import { getRuns } from "@/lib/catalog";

export const dynamic = "force-dynamic";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : dateTime.format(date);
}

function duration(startedAt: string, finishedAt: string): string {
  const elapsed = new Date(finishedAt).valueOf() - new Date(startedAt).valueOf();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "—";
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.round((elapsed % 60_000) / 1_000);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default async function RunsPage() {
  const runs = await getRuns(30);
  const latest = runs[0];

  return (
    <>
      <PageHead
        title="Agent runs"
        lead="A record of each catalogue import: what was accepted, what changed, and where the run stopped."
      />

      {!latest ? (
        <Empty
          title="No runs recorded yet"
          body="Upload a stock sheet from Catalogue. Its result will appear here when the research pass finishes."
          href="/admin/catalogue"
          cta="Open catalogue"
        />
      ) : (
        <>
          <section className="ops-cards" aria-label="Latest agent run">
            <Stat label="Latest run" value={when(latest.startedAt)} sub={basename(latest.sourceFile || "Uploaded sheet")} />
            <Stat label="Published" value={(latest.counts.ready ?? 0).toLocaleString("en-IN")} sub={`${latest.counts.updated ?? 0} existing listings updated`} tone="accent" />
            <Stat label="Needs attention" value={(latest.counts.needsReview ?? 0).toLocaleString("en-IN")} sub={`${latest.counts.rowsRejected ?? 0} sheet rows rejected`} tone={(latest.counts.needsReview ?? 0) > 0 ? "warn" : "plain"} />
            <Stat label="Photographs saved" value={(latest.counts.imagesSaved ?? 0).toLocaleString("en-IN")} sub={`${duration(latest.startedAt, latest.finishedAt)} total`} />
          </section>

          <section className="ops-panel" style={{ marginTop: 20, padding: 0 }}>
            <div className="ops-table-wrap" style={{ marginTop: 0, maxHeight: "none", border: 0 }}>
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Sheet</th>
                    <th style={{ textAlign: "right" }}>Rows</th>
                    <th style={{ textAlign: "right" }}>Published</th>
                    <th style={{ textAlign: "right" }}>Attention</th>
                    <th style={{ textAlign: "right" }}>Failed</th>
                    <th style={{ textAlign: "right" }}>Images</th>
                    <th>Run</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.runId}>
                      <td>
                        {when(run.startedAt)}
                        <span className="mono" style={{ display: "block", marginTop: 3, fontSize: 9, color: "var(--faint)" }}>
                          {duration(run.startedAt, run.finishedAt)}
                        </span>
                      </td>
                      <td>
                        {basename(run.sourceFile || "Uploaded sheet")}
                        <span className="mono" style={{ display: "block", marginTop: 3, fontSize: 9, color: "var(--faint)" }}>
                          {run.model || "Model not recorded"}
                        </span>
                      </td>
                      <td className="ops-num">{(run.counts.rowsRead ?? 0).toLocaleString("en-IN")}</td>
                      <td className="ops-num" style={{ color: "var(--accent-soft)" }}>{(run.counts.ready ?? 0).toLocaleString("en-IN")}</td>
                      <td className="ops-num" style={{ color: (run.counts.needsReview ?? 0) ? "var(--warn)" : undefined }}>{(run.counts.needsReview ?? 0).toLocaleString("en-IN")}</td>
                      <td className="ops-num" style={{ color: (run.counts.failed ?? 0) ? "var(--bad)" : undefined }}>{(run.counts.failed ?? 0).toLocaleString("en-IN")}</td>
                      <td className="ops-num">{(run.counts.imagesSaved ?? 0).toLocaleString("en-IN")}</td>
                      <td>
                        <span className="ops-chip" data-tone={run.dryRun ? "warn" : "mute"}>{run.dryRun ? "Dry run" : "Committed"}</span>
                        <span className="mono" style={{ display: "block", marginTop: 5, fontSize: 9, color: "var(--faint)" }}>
                          ${(run.costUsd ?? 0).toFixed(3)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
