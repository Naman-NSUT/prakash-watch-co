/**
 * What the shop has been paid online, and what it is still waiting for.
 *
 * One file per payment on the back end's disk, beside the repair tickets and
 * the bills. A record is written the moment an amount is asked for — not when
 * it arrives — so a customer who pays and closes the tab, or a webhook that
 * turns up before the browser does, both land on a row that already exists.
 *
 * The amount is held in paise, as an integer, exactly as Razorpay holds it.
 * Rupees as a float would let a half-paisa drift into a figure that has to
 * reconcile against a bank statement.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dataRoot } from "@/agent/config";

const DIR = () => join(dataRoot(), "payments");

/** What the money is for. More will follow; each needs its own settling rule. */
export const PaymentSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bill"), billId: z.string(), number: z.string().default("") }),
  z.object({ kind: z.literal("repair"), ticketId: z.string(), reference: z.string().default("") }),
  z.object({ kind: z.literal("order"), sku: z.string(), quantity: z.number().int().positive().default(1) }),
]);
export type PaymentSubject = z.infer<typeof PaymentSubjectSchema>;

export const PaymentSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),

  /** Razorpay's order, created before the customer sees a checkout. */
  orderId: z.string(),
  /** Razorpay's payment, once there is one. */
  paymentId: z.string().nullable().default(null),

  amountPaise: z.number().int().positive(),
  currency: z.literal("INR").default("INR"),

  subject: PaymentSubjectSchema,
  customer: z.object({
    name: z.string().default(""),
    phone: z.string().default(""),
    email: z.string().default(""),
  }),

  /**
   * asked    — an order exists, nobody has paid
   * paid     — Razorpay confirms the money was captured
   * failed   — the attempt was refused or abandoned and Razorpay said so
   * refunded — returned to the customer
   */
  status: z.enum(["asked", "paid", "failed", "refunded"]).default("asked"),
  /** upi, card, netbanking… as Razorpay reports it. */
  method: z.string().default(""),
  /** How this was settled: the browser's word, or Razorpay's own servers. */
  confirmedBy: z.enum(["checkout", "webhook", ""]).default(""),
  note: z.string().default(""),
});
export type Payment = z.infer<typeof PaymentSchema>;

async function dir(): Promise<string> {
  const path = DIR();
  if (!existsSync(path)) await fs.mkdir(path, { recursive: true });
  return path;
}

export async function recordAsked(input: {
  orderId: string;
  amountPaise: number;
  subject: PaymentSubject;
  customer?: { name?: string; phone?: string; email?: string };
  note?: string;
}): Promise<Payment> {
  const now = new Date().toISOString();
  const payment: Payment = PaymentSchema.parse({
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    orderId: input.orderId,
    paymentId: null,
    amountPaise: input.amountPaise,
    currency: "INR",
    subject: input.subject,
    customer: {
      name: input.customer?.name ?? "",
      phone: input.customer?.phone ?? "",
      email: input.customer?.email ?? "",
    },
    status: "asked",
    note: input.note ?? "",
  });
  await write(payment);
  return payment;
}

export async function findByOrder(orderId: string): Promise<Payment | null> {
  for (const payment of await listPayments()) {
    if (payment.orderId === orderId) return payment;
  }
  return null;
}

export async function getPayment(id: string): Promise<Payment | null> {
  try {
    const raw = await fs.readFile(join(DIR(), `${id}.json`), "utf8");
    const parsed = PaymentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function listPayments(): Promise<Payment[]> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(DIR())).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Payment[] = [];
  for (const name of names) {
    try {
      const parsed = PaymentSchema.safeParse(JSON.parse(await fs.readFile(join(DIR(), name), "utf8")));
      if (parsed.success) out.push(parsed.data);
    } catch {
      // One unreadable record must not hide the rest of the day's takings.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Settle a payment.
 *
 * Idempotent on purpose: the browser and the webhook both report the same
 * success, often within a second of each other, and whichever arrives second
 * must not overwrite or double-count the first. A record already marked paid
 * is returned untouched.
 */
export async function settle(
  orderId: string,
  outcome: {
    paymentId: string;
    status: "paid" | "failed" | "refunded";
    method?: string;
    confirmedBy: "checkout" | "webhook";
    note?: string;
  },
): Promise<Payment | null> {
  const existing = await findByOrder(orderId);
  if (!existing) return null;
  if (existing.status === "paid" && outcome.status === "paid") return existing;

  const next: Payment = {
    ...existing,
    paymentId: outcome.paymentId || existing.paymentId,
    status: outcome.status,
    method: outcome.method ?? existing.method,
    confirmedBy: outcome.confirmedBy,
    note: outcome.note ?? existing.note,
    updatedAt: new Date().toISOString(),
  };
  await write(next);
  return next;
}

async function write(payment: Payment): Promise<void> {
  const path = join(await dir(), `${payment.id}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(payment, null, 2)}\n`, "utf8");
  await fs.rename(temporary, path);
}

export const rupees = (paise: number) => paise / 100;
