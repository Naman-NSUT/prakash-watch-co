import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig } from "@/agent/config";
import { DEFAULT_GST_RATE } from "@/lib/sales";

/**
 * An order placed on the website.
 *
 * The counter has bills; the website has orders, and they are different things.
 * A bill records a sale that has already happened in front of someone. An order
 * records a stranger's intention, and only becomes a sale when the money
 * arrives — so it carries its own state, and the stock does not move until
 * Razorpay says the payment was captured.
 *
 * Every price here is settled on the server from the catalogue. What the
 * browser sends is a list of references and quantities, nothing more: a cart is
 * a wish, not a quotation, and a wish that could set its own prices would be a
 * way to buy a Tissot for a rupee.
 */
const config = loadConfig();
const ORDERS_DIR = join(config.dataDir, "..", "orders");

export const OrderLineSchema = z.object({
  sku: z.string(),
  slug: z.string(),
  title: z.string(),
  modelNumber: z.string(),
  brand: z.string(),
  image: z.string().default(""),
  /** What the shop charges, GST included, as the catalogue had it when ordered. */
  unitPrice: z.number().positive(),
  quantity: z.number().int().positive(),
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  placedAt: z.string(),
  updatedAt: z.string(),

  lines: z.array(OrderLineSchema).min(1),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(6),
    email: z.string().default(""),
  }),
  address: z.object({
    line1: z.string().min(1),
    line2: z.string().default(""),
    city: z.string().min(1),
    state: z.string().default(""),
    pincode: z.string().min(4),
  }),

  /** GST is inside `total`, exactly as on a counter bill. */
  gstRate: z.number().default(DEFAULT_GST_RATE),
  taxable: z.number(),
  gstAmount: z.number(),
  total: z.number(),

  payment: z.object({
    orderId: z.string().default(""),
    paymentId: z.string().default(""),
    method: z.string().default(""),
  }),

  /**
   * The parcel, once there is one.
   *
   * A waybill is taken from the courier's pool when the shop marks the order
   * packed, and the number is what the customer follows. Status and the last
   * scan are copied here when the courier is asked, so the orders list can be
   * read without calling them for every row.
   */
  shipment: z
    .object({
      waybill: z.string().default(""),
      status: z.string().default(""),
      lastScanAt: z.string().default(""),
      checkedAt: z.string().default(""),
    })
    .prefault({}),

  /**
   * placed    — the customer filled the form; no money yet
   * paid      — Razorpay captured it, and the stock has moved
   * packed    — the shop has it ready
   * shipped   — it has left the counter
   * delivered — done
   * cancelled — abandoned, refused or refunded
   */
  status: z.enum(["placed", "paid", "packed", "shipped", "delivered", "cancelled"]).default("placed"),
  note: z.string().default(""),
});
export type Order = z.infer<typeof OrderSchema>;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The tax split of a GST-inclusive total, the same arithmetic a bill uses. */
export function splitGst(total: number, rate: number = DEFAULT_GST_RATE) {
  const taxable = round2(total / (1 + rate / 100));
  return { taxable, gstAmount: round2(total - taxable) };
}

async function ensureDir(): Promise<string> {
  await fs.mkdir(ORDERS_DIR, { recursive: true });
  return ORDERS_DIR;
}

/** PWC/ORD/2026-27/0001 — the financial year the shop files under. */
async function nextNumber(): Promise<string> {
  const dir = await ensureDir();
  const now = new Date();
  const startYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const year = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  let highest = 0;
  for (const name of names) {
    try {
      const order = OrderSchema.safeParse(JSON.parse(await fs.readFile(join(dir, name), "utf8")));
      if (!order.success || !order.data.number.includes(year)) continue;
      const serial = Number(order.data.number.split("/").pop());
      if (Number.isFinite(serial)) highest = Math.max(highest, serial);
    } catch {
      // A damaged file must not stop the shop taking an order.
    }
  }
  return `PWC/ORD/${year}/${String(highest + 1).padStart(4, "0")}`;
}

export async function createOrder(input: {
  lines: OrderLine[];
  customer: Order["customer"];
  address: Order["address"];
}): Promise<Order> {
  const total = round2(input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
  const { taxable, gstAmount } = splitGst(total);
  const now = new Date();
  const order: Order = {
    id: `ord_${now.getTime().toString(36)}`,
    number: await nextNumber(),
    placedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lines: input.lines,
    customer: input.customer,
    address: input.address,
    gstRate: DEFAULT_GST_RATE,
    taxable,
    gstAmount,
    total,
    payment: { orderId: "", paymentId: "", method: "" },
    shipment: { waybill: "", status: "", lastScanAt: "", checkedAt: "" },
    status: "placed",
    note: "",
  };
  await write(order);
  return order;
}

export async function getOrder(id: string): Promise<Order | null> {
  if (!/^[a-z0-9_]+$/i.test(id)) return null;
  try {
    const raw = await fs.readFile(join(await ensureDir(), `${id}.json`), "utf8");
    const parsed = OrderSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function findByPaymentOrder(orderId: string): Promise<Order | null> {
  for (const order of await listOrders()) {
    if (order.payment.orderId === orderId) return order;
  }
  return null;
}

export async function listOrders(): Promise<Order[]> {
  const dir = await ensureDir();
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  const orders: Order[] = [];
  for (const name of names) {
    try {
      const parsed = OrderSchema.safeParse(JSON.parse(await fs.readFile(join(dir, name), "utf8")));
      if (parsed.success) orders.push(parsed.data);
    } catch {
      // Skip what cannot be read rather than failing the whole list.
    }
  }
  return orders.sort((a, b) => b.placedAt.localeCompare(a.placedAt));
}

export async function updateOrder(id: string, patch: Partial<Order>): Promise<Order | null> {
  const order = await getOrder(id);
  if (!order) return null;
  const next: Order = { ...order, ...patch, updatedAt: new Date().toISOString() };
  await write(next);
  return next;
}

async function write(order: Order): Promise<void> {
  const dir = await ensureDir();
  const path = join(dir, `${order.id}.json`);
  const temp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(order, null, 2) + "\n", "utf8");
  await fs.rename(temp, path);
}
