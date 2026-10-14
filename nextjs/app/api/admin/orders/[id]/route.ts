import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getOrder, updateOrder } from "@/lib/orders";

export const runtime = "nodejs";

const PatchSchema = z.object({
  status: z.enum(["placed", "paid", "packed", "shipped", "delivered", "cancelled"]),
});

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

  const updated = await updateOrder(id, { status: parsed.data.status });
  return Response.json({ status: updated?.status });
}
