import { z } from "zod";
import { findByPaymentOrder, updateOrder } from "@/lib/orders";
import { findByOrder, settle } from "@/lib/payments";
import { fetchPayment, verifyCheckoutSignature } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * Confirming that an order was paid for.
 *
 * The browser tells us a payment succeeded, and the browser is not to be
 * believed: the signature it returns is checked against the shop's own secret,
 * and then the payment is read back from Razorpay's servers to see that it was
 * really captured and really for this amount. A captured payment marks the
 * order paid; stock moves later, when the shop approves the order.
 *
 * Razorpay's webhook confirms the same thing independently, which is what
 * catches a customer who paid and closed the tab. Both paths land here, and
 * settling twice is harmless: an order already paid is left alone.
 */
const VerifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "Incomplete payment details." }, { status: 400 });

  const fields = parsed.data;
  if (
    !verifyCheckoutSignature({
      orderId: fields.razorpay_order_id,
      paymentId: fields.razorpay_payment_id,
      signature: fields.razorpay_signature,
    })
  ) {
    return Response.json({ ok: false, error: "That payment could not be verified." }, { status: 400 });
  }

  const order = await findByPaymentOrder(fields.razorpay_order_id);
  if (!order) return Response.json({ ok: false, error: "No such order." }, { status: 404 });
  if (order.status !== "placed") {
    return Response.json({ ok: true, orderId: order.id, number: order.number, already: true });
  }

  // Razorpay's own word, not the browser's.
  const captured = await fetchPayment(fields.razorpay_payment_id);
  const asked = await findByOrder(fields.razorpay_order_id);
  if (!captured || captured.status !== "captured") {
    return Response.json({ ok: false, error: "That payment has not been captured." }, { status: 402 });
  }
  if (asked && captured.amount !== asked.amountPaise) {
    return Response.json({ ok: false, error: "That payment does not match the order." }, { status: 409 });
  }

  await settle(fields.razorpay_order_id, {
    paymentId: fields.razorpay_payment_id,
    status: "paid",
    method: captured.method ?? "",
    confirmedBy: "checkout",
  });

  await updateOrder(order.id, {
    status: "paid",
    payment: {
      orderId: fields.razorpay_order_id,
      paymentId: fields.razorpay_payment_id,
      method: captured.method ?? "",
    },
  });

  return Response.json({ ok: true, orderId: order.id, number: order.number });
}
