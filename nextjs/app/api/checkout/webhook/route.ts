import { z } from "zod";
import { confirmCapturedPayment } from "@/lib/payment-confirmation";
import { razorpayConfig, verifyWebhookSignature } from "@/lib/razorpay";

export const runtime = "nodejs";

const PaymentCapturedSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string().min(1),
        order_id: z.string().min(1),
        amount: z.number().int().positive(),
        currency: z.string().min(1),
        status: z.string().min(1),
        method: z.string().nullable().optional(),
      }),
    }),
  }),
});

/**
 * Razorpay's server-to-server payment confirmation.
 *
 * The signature is checked against the exact request bytes before parsing.
 * Razorpay may deliver the same event more than once, so the shared payment
 * confirmation is deliberately idempotent and never moves stock itself.
 */
export async function POST(request: Request): Promise<Response> {
  const config = razorpayConfig();
  if (!config?.webhookSecret) {
    return Response.json({ ok: false, error: "The payment webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const raw = Buffer.from(await request.arrayBuffer());
  if (!signature || !verifyWebhookSignature(raw, signature)) {
    return Response.json({ ok: false, error: "Invalid webhook signature." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return Response.json({ ok: false, error: "Malformed webhook payload." }, { status: 400 });
  }

  const event = typeof body === "object" && body !== null && "event" in body
    ? String((body as { event?: unknown }).event ?? "")
    : "";
  if (event !== "payment.captured") {
    return Response.json({ ok: true, ignored: true });
  }

  const parsed = PaymentCapturedSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Incomplete payment webhook." }, { status: 400 });
  }

  const payment = parsed.data.payload.payment.entity;
  const result = await confirmCapturedPayment({
    id: payment.id,
    orderId: payment.order_id,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
  }, "webhook");
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: result.status });
  }

  return Response.json({ ok: true, already: result.already });
}
