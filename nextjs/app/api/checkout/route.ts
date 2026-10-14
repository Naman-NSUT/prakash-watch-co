import { z } from "zod";
import { brandSlug, getBrand } from "@/lib/brands";
import { getProduct } from "@/lib/catalog";
import { createOrder, type OrderLine } from "@/lib/orders";
import { recordAsked } from "@/lib/payments";
import { createOrder as createRazorpayOrder, razorpayConfig, toPaise } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * Taking an order from the website.
 *
 * The browser sends references and quantities. Everything that matters —  what
 * each watch costs, whether it is in stock, whether its house is sold online at
 * all — is read here from the catalogue, because a cart that could set its own
 * prices would be a way to buy a Tissot for a rupee.
 *
 * Nothing is charged here either. This creates the order and asks Razorpay for
 * a payment order; the money is confirmed separately, and the stock does not
 * move until it is.
 */
const CheckoutSchema = z.object({
  lines: z
    .array(z.object({ sku: z.string().min(1), quantity: z.number().int().min(1).max(9) }))
    .min(1)
    .max(12),
  customer: z.object({
    name: z.string().trim().min(1, "A name is needed."),
    phone: z.string().trim().min(6, "A phone number is needed."),
    email: z.string().trim().email("That email does not look right.").or(z.literal("")).default(""),
  }),
  address: z.object({
    line1: z.string().trim().min(1, "A street address is needed."),
    line2: z.string().trim().default(""),
    city: z.string().trim().min(1, "A city is needed."),
    state: z.string().trim().default(""),
    pincode: z.string().trim().min(4, "A PIN code is needed."),
  }),
});

export async function POST(request: Request): Promise<Response> {
  const money = razorpayConfig();
  if (!money) {
    return Response.json(
      { errors: ["Online payment is not switched on. Please call the boutique and we will take the order."] },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["Malformed request."] }, { status: 400 });
  }

  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.issues.map((issue) => issue.message) }, { status: 400 });
  }

  const errors: string[] = [];
  const lines: OrderLine[] = [];

  for (const wanted of parsed.data.lines) {
    const product = await getProduct(wanted.sku);
    if (!product || product.status !== "ready") {
      errors.push("One of the watches in your bag is no longer listed.");
      continue;
    }
    if (!product.inStock) {
      errors.push(`${product.title} is not in the case at the moment.`);
      continue;
    }
    const price = product.price.selling;
    if (!price || price <= 0) {
      errors.push(`${product.title} is not priced for the website.`);
      continue;
    }
    // The house decides whether it may be bought here at all, and one watch may
    // overrule its house either way.
    const house = await getBrand(brandSlug(product.brand));
    const sellsOnline = product.directSale ?? house?.directSale ?? false;
    if (!sellsOnline) {
      errors.push(`${product.brand} is sold at the counter rather than online.`);
      continue;
    }

    lines.push({
      sku: product.sku,
      slug: product.slug,
      title: product.title,
      modelNumber: product.modelNumber,
      brand: product.brand,
      image: product.images[0]?.url ?? "",
      unitPrice: price,
      quantity: wanted.quantity,
    });
  }

  if (errors.length) return Response.json({ errors: [...new Set(errors)] }, { status: 409 });
  if (!lines.length) return Response.json({ errors: ["Your bag is empty."] }, { status: 400 });

  const order = await createOrder({
    lines,
    customer: parsed.data.customer,
    address: parsed.data.address,
  });

  const paise = toPaise(order.total);
  const payment = await createRazorpayOrder({
    amountInPaise: paise,
    receipt: order.number,
    notes: { orderId: order.id, number: order.number },
  });
  if (!payment) {
    return Response.json(
      { errors: ["We could not reach the payment service. Please try again, or call the boutique."] },
      { status: 502 },
    );
  }

  await recordAsked({
    orderId: payment.id,
    amountPaise: paise,
    subject: { kind: "order", sku: lines[0].sku, quantity: lines[0].quantity },
    customer: parsed.data.customer,
  });

  const { updateOrder } = await import("@/lib/orders");
  await updateOrder(order.id, { payment: { orderId: payment.id, paymentId: "", method: "" } });

  return Response.json({
    orderId: order.id,
    number: order.number,
    razorpayOrderId: payment.id,
    keyId: money.keyId,
    amountPaise: paise,
    total: order.total,
  });
}
