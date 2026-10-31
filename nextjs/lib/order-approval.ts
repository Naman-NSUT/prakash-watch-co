/**
 * Committing stock for a paid website order.
 *
 * Payment and acceptance are deliberately separate. Razorpay marks the order
 * paid; the shop accepts it here after confirming the watches are really in the
 * case. A prepared before/after plan is stored on the order before any stock is
 * changed, so a retry after a restart reaches the same counts instead of taking
 * the watches out twice.
 */
import "server-only";
import { getProduct, updateProduct } from "@/lib/catalog";
import { appendMovements, readLedger } from "@/lib/ledger";
import { getOrder, updateOrder, type Order } from "@/lib/orders";

export type ApprovalResult =
  | { ok: true; order: Order; already: boolean }
  | { ok: false; status: number; error: string };

let approvalQueue: Promise<void> = Promise.resolve();

/** Serialise approvals inside the one back-end process to block double clicks. */
export async function approveOrder(id: string): Promise<ApprovalResult> {
  let result: ApprovalResult | undefined;
  const operation = approvalQueue.then(async () => {
    try {
      result = await commitApproval(id);
    } catch {
      result = { ok: false, status: 500, error: "The order could not be approved. Try again." };
    }
  });
  approvalQueue = operation.then(() => undefined, () => undefined);
  await operation;
  if (!result) return { ok: false, status: 500, error: "The order could not be approved." };
  return result;
}

async function commitApproval(id: string): Promise<ApprovalResult> {
  let order = await getOrder(id);
  if (!order) return { ok: false, status: 404, error: "No such order." };

  if (order.stockApproval.committedAt) {
    if (order.status === "paid") {
      order = (await updateOrder(id, { status: "approved" })) ?? order;
    }
    return { ok: true, order, already: true };
  }
  if (order.status === "placed") {
    return { ok: false, status: 409, error: "Payment has not cleared for this order." };
  }
  if (order.status !== "paid") {
    return { ok: false, status: 409, error: `This order is already ${order.status}.` };
  }

  if (!order.stockApproval.preparedAt) {
    const wanted = new Map<string, number>();
    const orderNumber = order.number;
    for (const line of order.lines) wanted.set(line.sku, (wanted.get(line.sku) ?? 0) + line.quantity);

    // Orders paid before the approval workflow was introduced already have
    // sale movements under their order number. Promote those without removing
    // the same watches a second time.
    const priorLedger = await readLedger();
    const legacyAlreadyMoved = [...wanted].every(([sku, quantity]) => {
      const moved = priorLedger
        .filter((entry) => entry.kind === "sale" && entry.reference === orderNumber && entry.sku === sku)
        .reduce((sum, entry) => sum + entry.delta, 0);
      return moved <= -quantity;
    });
    if (legacyAlreadyMoved) {
      const committedAt = new Date().toISOString();
      const approved = await updateOrder(id, {
        status: "approved",
        stockApproval: { preparedAt: committedAt, committedAt, lines: [] },
      });
      if (!approved) return { ok: false, status: 500, error: "The order could not be marked approved." };
      return { ok: true, order: approved, already: true };
    }

    const plan: Order["stockApproval"]["lines"] = [];
    for (const [sku, quantity] of wanted) {
      const product = await getProduct(sku);
      if (!product) {
        return { ok: false, status: 409, error: `${sku} is no longer in the catalogue.` };
      }
      const before = product.quantity ?? 0;
      if (before < quantity) {
        return {
          ok: false,
          status: 409,
          error: `${product.title}: only ${before} in stock; this order needs ${quantity}.`,
        };
      }
      plan.push({ sku, before, after: before - quantity });
    }

    order =
      (await updateOrder(id, {
        stockApproval: {
          preparedAt: new Date().toISOString(),
          committedAt: "",
          lines: plan,
        },
      })) ?? order;
  }

  // Apply the prepared targets. `after` means this line already completed
  // before a restart; any third value means stock changed concurrently and the
  // safe response is to stop for a fresh count rather than overwrite it.
  for (const line of order.stockApproval.lines) {
    const product = await getProduct(line.sku);
    if (!product) {
      return { ok: false, status: 409, error: `${line.sku} is no longer in the catalogue.` };
    }
    const current = product.quantity ?? 0;
    if (current === line.after) continue;
    if (current !== line.before) {
      return {
        ok: false,
        status: 409,
        error: `${product.title}: stock changed during approval. Count it in Inventory, then try again.`,
      };
    }
    const updated = await updateProduct(line.sku, { quantity: line.after, inStock: line.after > 0 });
    if (!updated) {
      return { ok: false, status: 500, error: `${product.title}: stock could not be updated.` };
    }
  }

  // The reference makes ledger writing idempotent too. If the process stopped
  // after adding some movements, only the missing quantity is appended.
  const ledger = await readLedger();
  const additions = order.stockApproval.lines.flatMap((line) => {
    const expected = line.after - line.before;
    const recorded = ledger
      .filter((entry) => entry.kind === "sale" && entry.reference === order.number && entry.sku === line.sku)
      .reduce((sum, entry) => sum + entry.delta, 0);
    const missing = expected - recorded;
    return missing === 0
      ? []
      : [{
          sku: line.sku,
          kind: "sale" as const,
          delta: missing,
          reference: order.number,
          note: `Website order approved for ${order.customer.name}`,
        }];
  });
  if (additions.length) await appendMovements(additions);

  const committedAt = new Date().toISOString();
  const approved = await updateOrder(id, {
    status: "approved",
    stockApproval: { ...order.stockApproval, committedAt },
  });
  if (!approved) return { ok: false, status: 500, error: "The order could not be marked approved." };
  return { ok: true, order: approved, already: false };
}
