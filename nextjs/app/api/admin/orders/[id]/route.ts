import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getOrder, updateOrder } from "@/lib/orders";
import { approveOrder } from "@/lib/order-approval";

export const runtime = "nodejs";

const PatchSchema = z.object({
  status: z.enum(["approved", "packed", "shipped", "delivered"]),
});

const NEXT: Record<string, readonly string[]> = {
  approved: ["packed", "shipped"],
  packed: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Not a status." }, { status: 400 });

  const order = await getOrder(id);
  if (!order) return Response.json({ error: "No such order." }, { status: 404 });

  const next = parsed.data.status;
  if (next === "approved") {
    const result = await approveOrder(id);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ status: result.order.status, already: result.already });
  }

  if (order.status === next) return Response.json({ status: order.status, already: true });
  if (!(NEXT[order.status] ?? []).includes(next)) {
    return Response.json(
      { error: order.status === "paid" ? "Approve the paid order before moving it forward." : `An order cannot move from ${order.status} to ${next}.` },
      { status: 409 },
    );
  }

  const updated = await updateOrder(id, { status: next });
  return Response.json({ status: updated?.status });
}
