import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/ui";
import RepairBillWriter, { type TicketForBilling } from "@/components/admin/RepairBillWriter";
import { listTickets } from "@/lib/repairs";
import { SERVICE_LABELS } from "@/lib/repairs.shared";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bill a repair — Stock room" };

export default async function RepairBillPage() {
  const tickets = await listTickets();

  // Anything still on the bench or waiting to be collected can be billed.
  // A collected job has been settled already; a declined one never will be.
  const billable: TicketForBilling[] = tickets
    .filter((ticket) => !["collected", "declined"].includes(ticket.status))
    .map((ticket) => ({
      id: ticket.id,
      ref: ticket.ref,
      customer: ticket.customer,
      watch: [ticket.watch.brand, ticket.watch.model, ticket.watch.reference].filter(Boolean).join(" ").trim(),
      kind: SERVICE_LABELS[ticket.kind] ?? ticket.kind,
      estimate: ticket.estimate,
    }));

  return (
    <>
      <PageHead
        title="Bill a repair"
        lead={
          `Labour, not stock: nothing leaves the inventory and the whole amount is the shop's. It is the same bill ` +
          `as a watch sale underneath — same numbering, same GST, same books — so the day's takings is one figure ` +
          `either way. ${billable.length} job${billable.length === 1 ? "" : "s"} can be billed right now.`
        }
      />

      <p className="ops-foot-note" style={{ marginTop: -8, marginBottom: 26 }}>
        <Link href="/admin/billing">← All bills</Link>
        {" · "}
        <Link href="/admin/billing/new">Billing a watch instead?</Link>
        {" · "}
        <Link href="/admin/repairs">The bench</Link>
      </p>

      <RepairBillWriter tickets={billable} />
    </>
  );
}
