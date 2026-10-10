import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Letterhead from "@/components/admin/Letterhead";
import PrintButton from "@/components/admin/PrintButton";
import { getTicket } from "@/lib/repairs";
import { SERVICE_LABELS, STATUS_LABELS } from "@/lib/repairs.shared";
import { getFirm } from "@/lib/firm";
import { formatInr } from "@/agent/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Job card — Stock room" };

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * The job card: one docket, on paper.
 *
 * What the bench actually needs in hand — whose watch, which watch, what they
 * said was wrong, what came with it, and what was quoted — plus the customer's
 * own photographs, which are the record of what condition it arrived in. That
 * last part is why this prints rather than being read off a screen: an
 * argument about a scratch six weeks later is settled by the picture taken
 * before the caseback came off.
 */
export default async function JobCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, firm] = await Promise.all([getTicket(id), getFirm()]);
  if (!ticket) notFound();

  const watch = [ticket.watch.brand, ticket.watch.model, ticket.watch.reference].filter(Boolean).join(" ");

  return (
    <>
      <div className="ops-noprint" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24 }}>
        <PrintButton />
        <Link href="/admin/repairs" className="ops-btn">← The bench</Link>
        <Link href={`/admin/billing/repair`} className="ops-btn">Bill this work</Link>
      </div>

      <article className="doc-page">
        <Letterhead firm={firm} title="Job card" period={ticket.ref} note={`Received ${when(ticket.createdAt)}`} />

        <section className="job-grid">
          <div>
            <h3 className="job-head">Customer</h3>
            <p className="job-lines">
              <strong>{ticket.customer.name}</strong>
              <br />
              {ticket.customer.phone}
              {ticket.customer.email ? <><br />{ticket.customer.email}</> : null}
              {ticket.customer.address ? <><br />{ticket.customer.address}</> : null}
            </p>
          </div>

          <div>
            <h3 className="job-head">Watch</h3>
            <p className="job-lines">
              <strong>{watch || "—"}</strong>
              {ticket.watch.boughtYear ? <><br />Bought {ticket.watch.boughtYear}</> : null}
              <br />
              {ticket.watch.boughtHere ? "Bought from us" : "Bought elsewhere"}
            </p>
          </div>

          <div>
            <h3 className="job-head">The job</h3>
            <p className="job-lines">
              <strong>{SERVICE_LABELS[ticket.kind] ?? ticket.kind}</strong>
              <br />
              Status: {STATUS_LABELS[ticket.status] ?? ticket.status}
              {ticket.estimate !== null ? <><br />Quoted {formatInr(ticket.estimate)}</> : null}
              {ticket.promisedFor ? <><br />Promised {when(ticket.promisedFor)}</> : null}
            </p>
          </div>
        </section>

        <section>
          <h3 className="job-head">What the customer said</h3>
          <p className="job-prose">{ticket.issue || "—"}</p>
        </section>

        <section>
          <h3 className="job-head">Came with the watch</h3>
          <p className="job-prose">{ticket.accessories || "Nothing noted."}</p>
          <p className="job-check">
            Checked in by ____________________ &nbsp;&nbsp; Checked back out by ____________________
          </p>
        </section>

        {ticket.photos.length > 0 && (
          <section>
            <h3 className="job-head">Photographs as received ({ticket.photos.length})</h3>
            <div className="job-shots">
              {ticket.photos.map((photo) => (
                // A plain img: these are served only to a signed-in admin, and the
                // image optimiser has no session to present.
                // eslint-disable-next-line @next/next/no-img-element
                <img key={photo.url} src={photo.url} alt={photo.name} />
              ))}
            </div>
          </section>
        )}

        {ticket.history.length > 0 && (
          <section>
            <h3 className="job-head">History</h3>
            <table className="doc-table job-history">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>When</th>
                  <th style={{ width: 150 }}>Status</th>
                  <th>Note</th>
                  <th style={{ width: 80 }}>By</th>
                </tr>
              </thead>
              <tbody>
                {ticket.history.map((event, index) => (
                  <tr key={`${event.at}-${index}`}>
                    <td>{when(event.at)}</td>
                    <td>{STATUS_LABELS[event.status] ?? event.status}</td>
                    <td>{event.note}</td>
                    <td>{event.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <div className="doc-sign">
          <span className="mono">Customer signature on collection</span>
        </div>
      </article>
    </>
  );
}
