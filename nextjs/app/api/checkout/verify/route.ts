import { z } from "zod";
import { confirmCapturedPayment } from "@/lib/payment-confirmation";
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

  // Razorpay's own word, not the browser's.
  const captured = await fetchPayment(fields.razorpay_payment_id);
  if (!captured || captured.order_id !== fields.razorpay_order_id) {
    return Response.json({ ok: false, error: "That payment has not been captured." }, { status: 402 });
  }
  const result = await confirmCapturedPayment({
    id: captured.id,
    orderId: captured.order_id,
    amount: captured.amount,
    currency: captured.currency,
    status: captured.status,
    method: captured.method,
  }, "checkout");
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: result.status });
  }

  return Response.json({
    ok: true,
    orderId: result.order.id,
    number: result.order.number,
    ...(result.already ? { already: true } : {}),
  });
}
