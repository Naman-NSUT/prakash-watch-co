import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHead, formatInr } from "@/components/admin/ui";
import OrderStatus from "@/components/admin/OrderStatus";
import ParcelCell from "@/components/admin/ParcelCell";
import ApproveOrder from "@/components/admin/ApproveOrder";
import CourierDesk from "@/components/admin/CourierDesk";
import { listOrders } from "@/lib/orders";
import { getCourierSettings, withoutToken } from "@/lib/courier";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders — Stock room" };

/**
 * Orders taken on the website.
 *
 * Separate from billing because they are a different stage of the same thing: a
 * bill records a sale that has happened, an order records one that is on its way
 * out of the door. An order that was never paid for is shown too, greyed, so the
 * shop can see what people are abandoning at the payment step.
 */
export default async function OrdersPage() {
  const orders = await listOrders();
  const courier = withoutToken(await getCourierSettings());
  const paid = orders.filter((order) => order.status !== "placed" && order.status !== "cancelled");
  const takings = paid.reduce((sum, order) => sum + order.total, 0);

  return (
    <>
      <PageHead
        title="Orders"
        lead={
          orders.length === 0
            ? "Nothing has been ordered on the website yet."
            : `${paid.length} paid, ${formatInr(takings)} taken. Prices include GST; the split is on each order.`
        }
      />

      <CourierDesk initial={courier} />

      {orders.length === 0 ? (
        <Empty
          title="No website orders"
          body="Orders appear here when a customer starts payment. A house has to be set to sell online in Brands before its watches can be bought here at all."
        />
      ) : (
        <div className="ops-panel ops-orders-panel">
          <div className="ops-orders-scroll">
            <table className="ops-table ops-orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Watches</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Parcel</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                <tr key={order.id} style={{ opacity: order.status === "placed" || order.status === "cancelled" ? 0.55 : 1 }}>
                  <td>
                    <span className="mono" style={{ fontSize: 11 }}>{order.number}</span>
                    <span className="mono" style={{ display: "block", fontSize: 9, color: "var(--faint)", marginTop: 3 }}>
                      {new Date(order.placedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                  </td>
                  <td>
                    {order.customer.name}
                    <span style={{ display: "block", fontSize: 11, color: "var(--faint)", marginTop: 3 }}>
                      {order.customer.phone} · {order.address.city} {order.address.pincode}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {order.lines.map((line) => (
                      <span key={line.sku} style={{ display: "block" }}>
                        <Link href={`/watch/${line.slug}`} target="_blank" rel="noreferrer" style={{ color: "var(--body)" }}>
                          {line.title}
                        </Link>
                        {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                      </span>
                    ))}
                  </td>
                  <td className="ops-num">
                    {formatInr(order.total)}
                    <span className="mono" style={{ display: "block", fontSize: 9, color: "var(--faint)", marginTop: 3 }}>
                      incl. {formatInr(order.gstAmount)} GST
                    </span>
                  </td>
                  <td>
                    {order.status === "placed" || order.status === "cancelled" ? (
                      <span className="mono" style={{ fontSize: 9, color: "var(--faint)" }}>—</span>
                    ) : order.status === "paid" ? (
                      <span className="mono ops-order-wait">Approve to unlock shipping</span>
                    ) : (
                      <ParcelCell id={order.id} waybill={order.shipment.waybill} status={order.shipment.status} />
                    )}
                  </td>
                  <td>
                    {order.status === "placed" ? (
                      <span className="ops-chip" data-tone="mute">Not paid</span>
                    ) : order.status === "cancelled" ? (
                      <span className="ops-chip" data-tone="bad">Cancelled</span>
                    ) : order.status === "paid" ? (
                      <ApproveOrder id={order.id} />
                    ) : (
                      <OrderStatus id={order.id} status={order.status} />
                    )}
                  </td>
                </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
