import "server-only";
import { findByPaymentOrder, updateOrder, type Order } from "@/lib/orders";
import { findByOrder, settle } from "@/lib/payments";

export interface CapturedPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  method?: string | null;
}

export type PaymentConfirmation =
  | { ok: true; order: Order; already: boolean }
  | { ok: false; status: number; error: string };

/**
 * Turn a verified Razorpay capture into a paid shop order.
 *
 * Both the browser callback and Razorpay's webhook use this boundary. Keeping
 * the amount, currency and stored payment checks here prevents one path from
 * becoming weaker than the other. The operation is idempotent: a duplicate
 * webhook can acknowledge the same paid order without changing stock or
 * moving an approved order backwards.
 */
export async function confirmCapturedPayment(
  payment: CapturedPayment,
  confirmedBy: "checkout" | "webhook",
): Promise<PaymentConfirmation> {
  const order = await findByPaymentOrder(payment.orderId);
  if (!order) return { ok: false, status: 404, error: "No such order." };

  const asked = await findByOrder(payment.orderId);
  if (!asked) {
    return { ok: false, status: 409, error: "The payment record for that order is missing." };
  }
  if (payment.status !== "captured") {
    return { ok: false, status: 402, error: "That payment has not been captured." };
  }
  if (payment.currency !== "INR" || payment.amount !== asked.amountPaise) {
    return { ok: false, status: 409, error: "That payment does not match the order." };
  }

  if (order.status !== "placed") return { ok: true, order, already: true };

  await settle(payment.orderId, {
    paymentId: payment.id,
    status: "paid",
    method: payment.method ?? "",
    confirmedBy,
  });

  const paid = await updateOrder(order.id, {
    status: "paid",
    payment: {
      orderId: payment.orderId,
      paymentId: payment.id,
      method: payment.method ?? "",
    },
  });

  if (!paid) return { ok: false, status: 500, error: "The paid order could not be saved." };
  return { ok: true, order: paid, already: false };
}
