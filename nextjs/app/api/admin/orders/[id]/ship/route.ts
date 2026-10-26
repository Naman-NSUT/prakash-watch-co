import { requireAuth } from "@/lib/auth";
import { getOrder, updateOrder } from "@/lib/orders";
import { courier, takeWaybill, track } from "@/lib/delhivery";

export const runtime = "nodejs";

/**
 * The parcel for an order.
 *
 * POST takes a waybill from the courier's pool and puts it on the order, or
 * accepts one the shop has already booked in Delhivery's own panel and typed
 * in. Either way the number is the customer's to follow.
 *
 * GET asks the courier where the parcel has reached and copies the answer onto
 * the order, so the list can be read without calling them for every row.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  const { id } = await params;
  const order = await getOrder(id);
  if (!order) return Response.json({ error: "No such order." }, { status: 404 });

  let typed = "";
  try {
    typed = String(((await request.json()) as { waybill?: string }).waybill ?? "").trim();
  } catch {
    typed = "";
  }

  // A number the shop already has beats taking a fresh one: two waybills for
  // one parcel is a parcel nobody can find.
  const waybill = typed || (await takeWaybill());
  if (!waybill) {
    const configured = await courier();
    return Response.json(
      {
        error: configured
          ? "The courier would not give a waybill."
          : "No courier is set up yet — add the Delhivery token under Orders.",
      },
      { status: 502 },
    );
  }

  const updated = await updateOrder(id, {
    shipment: { ...order.shipment, waybill },
    status: order.status === "paid" ? "packed" : order.status,
  });
  return Response.json({ waybill, status: updated?.status });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  const { id } = await params;
  const order = await getOrder(id);
  if (!order) return Response.json({ error: "No such order." }, { status: 404 });
  if (!order.shipment.waybill) return Response.json({ error: "No parcel yet." }, { status: 409 });

  const parcel = await track(order.shipment.waybill);
  if (!parcel) return Response.json({ error: "The courier has nothing for that waybill yet." }, { status: 404 });

  const latest = parcel.scans[parcel.scans.length - 1];
  await updateOrder(id, {
    shipment: {
      ...order.shipment,
      status: parcel.status,
      lastScanAt: latest?.at ?? "",
      checkedAt: new Date().toISOString(),
    },
    // The courier's word moves the order, so nobody has to remember to.
    status: parcel.delivered ? "delivered" : order.status === "packed" ? "shipped" : order.status,
  });

  return Response.json({ status: parcel.status, delivered: parcel.delivered, scans: parcel.scans.slice(-4) });
}
