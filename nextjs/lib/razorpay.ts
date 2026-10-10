/**
 * Razorpay, from the server only.
 *
 * Nothing here runs in a browser. The key id is public — it is handed to the
 * checkout script so it knows which account to charge — but the secret signs
 * and verifies, and anything that can read it can take money. So it lives in
 * the environment on the back end and is imported through `server-only`, which
 * makes the build fail rather than the secret ship if this is ever pulled into
 * a client component.
 *
 * Two kinds of verification live here, and the difference matters:
 *
 * * `verifyCheckoutSignature` checks what the customer's browser reports after
 *   paying. It proves the response was not forged, but a browser can simply
 *   never send it — someone can pay and close the tab.
 * * `verifyWebhookSignature` checks what Razorpay's own servers send us. That
 *   arrives whether or not the customer waits, which is why the webhook, not
 *   the browser, is the record of truth.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.razorpay.com/v1";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  /** Set in the Razorpay dashboard when the webhook is added. */
  webhookSecret: string;
}

export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "" };
}

/** True when the account is a live one rather than a test key. */
export const isLiveAccount = (config: RazorpayConfig) => config.keyId.startsWith("rzp_live_");

function auth(config: RazorpayConfig): string {
  return `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

/**
 * An order: Razorpay's record of an intent to collect a given amount.
 *
 * Creating one moves no money and commits the customer to nothing. It exists so
 * that the amount is fixed on the server before the browser is involved —
 * otherwise a page could ask the checkout for ₹1 on a ₹40,000 watch.
 *
 * `amountInPaise` is in the smallest unit, which is what the API takes: a
 * rupee is 100. Passing rupees by mistake undercharges by a hundredfold, so
 * every caller converts explicitly.
 */
export async function createOrder(options: {
  amountInPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const config = razorpayConfig();
  if (!config) throw new Error("Razorpay is not configured on this server.");

  if (!Number.isInteger(options.amountInPaise) || options.amountInPaise < 100) {
    throw new Error("A Razorpay order must be a whole number of paise, at least ₹1.");
  }

  const response = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { authorization: auth(config), "content-type": "application/json" },
    body: JSON.stringify({
      amount: options.amountInPaise,
      currency: "INR",
      // Razorpay rejects a receipt over 40 characters.
      receipt: options.receipt.slice(0, 40),
      notes: options.notes ?? {},
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.description ?? "Razorpay refused to create the order.");
  }
  return body as RazorpayOrder;
}

/** A constant-time compare over two hex digests of the same length. */
function sameSignature(expected: string, given: string): boolean {
  if (expected.length !== given.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
  } catch {
    return false;
  }
}

/** What the browser reports after the checkout closes. Necessary, not sufficient. */
export function verifyCheckoutSignature(fields: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const config = razorpayConfig();
  if (!config) return false;
  const expected = createHmac("sha256", config.keySecret)
    .update(`${fields.orderId}|${fields.paymentId}`)
    .digest("hex");
  return sameSignature(expected, fields.signature);
}

/** What Razorpay's servers send, signed with the webhook secret. The real record. */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const config = razorpayConfig();
  if (!config?.webhookSecret) return false;
  const expected = createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
  return sameSignature(expected, signature);
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  email: string | null;
  contact: string | null;
  created_at: number;
}

/**
 * What Razorpay says about a payment.
 *
 * Asked for before anything is marked paid. A signature proves the message came
 * from us; this proves the money did — captured, for the amount expected, on
 * the order expected.
 */
export async function fetchPayment(paymentId: string): Promise<RazorpayPayment | null> {
  const config = razorpayConfig();
  if (!config) return null;
  const response = await fetch(`${API}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: auth(config) },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as RazorpayPayment;
}

/** Rupees to paise, refusing anything that would silently lose money. */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees <= 0) throw new Error("A charge must be a positive amount.");
  return Math.round(rupees * 100);
}
