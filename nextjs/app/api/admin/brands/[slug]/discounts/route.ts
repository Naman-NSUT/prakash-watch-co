/**
 * A discount sheet, applied to one brand's shelf.
 *
 * The shop sends a spreadsheet of references and discounts from the brand's
 * page in the stock room. Two rules make this safe enough to run on a live
 * shelf:
 *
 * * It only ever touches watches already listed under this brand. A reference
 *   that is not on the shelf is reported, never created — a discount sheet is
 *   not a way to add stock, and a typo should not invent a listing.
 * * Nothing is written until the shop has seen what would change. The first
 *   call is a dry run and returns the whole before-and-after; applying is a
 *   second, deliberate call.
 *
 * The discount is expressed against the list price: the MRP stays where it is
 * and the selling price comes down, which is what makes the struck-through
 * price on the card honest. Where a watch has no MRP, today's selling price
 * becomes one — otherwise "20% off" would have nothing to be off.
 */
import { requireAuth } from "@/lib/auth";
import { getCatalogIndex, getProduct, updateProduct, PUBLISHED_STATUS } from "@/lib/catalog";
import { brandSlug, getBrands } from "@/lib/brands";

export const runtime = "nodejs";
export const maxDuration = 300;

const AGENT_URL = process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:8077";
const AGENT_TOKEN = process.env.AGENT_SERVICE_TOKEN ?? "";
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

interface SheetLine {
  row_number: number;
  sheet: string;
  model_number: string;
  discount_pct: number | null;
  price: number | null;
  mrp: number | null;
}

/** "AH7-EY4X1" and "ah7ey4x1" are the same reference to a shop. */
const key = (reference: string) => reference.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  const { slug } = await params;
  if (!SLUG.test(slug)) return Response.json({ errors: ["Bad brand."] }, { status: 400 });

  const brand = (await getBrands()).find((candidate) => candidate.slug === slug);
  if (!brand) return Response.json({ errors: ["No such brand on the shelf."] }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ errors: ["Expected a file upload."] }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ errors: ["No sheet was attached."] }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ errors: ["That file is larger than 8 MB."] }, { status: 400 });
  }
  const apply = String(form.get("apply") ?? "") === "true";

  // --- read the sheet (the agent owns the spreadsheet reader) --------------
  const outbound = new FormData();
  outbound.set("file", file, file.name);

  let parsed: { rows: SheetLine[]; errors: { row_number: number; model_number: string; reason: string }[] };
  try {
    const response = await fetch(`${AGENT_URL}/discount-sheet`, {
      method: "POST",
      body: outbound,
      headers: AGENT_TOKEN ? { "x-agent-token": AGENT_TOKEN } : undefined,
    });
    const payload = await response.json();
    if (!response.ok) {
      return Response.json({ errors: [payload?.detail ?? "The sheet could not be read."] }, { status: 400 });
    }
    parsed = payload;
  } catch {
    return Response.json({ errors: ["The agent is not answering, so the sheet could not be read."] }, { status: 502 });
  }

  // --- match against this brand's listed watches ---------------------------
  const index = await getCatalogIndex();
  const shelf = new Map<string, (typeof index)[number]>();
  for (const entry of index) {
    if (entry.status !== PUBLISHED_STATUS) continue;
    if (brandSlug(entry.brand) !== slug) continue;
    shelf.set(key(entry.modelNumber), entry);
  }

  const changes: {
    sku: string;
    reference: string;
    title: string;
    was: { selling: number | null; mrp: number | null };
    now: { selling: number; mrp: number | null; discountPct: number };
  }[] = [];
  const unmatched: string[] = [];
  const skipped: { reference: string; reason: string }[] = [];

  for (const line of parsed.rows) {
    const entry = shelf.get(key(line.model_number));
    if (!entry) {
      unmatched.push(line.model_number);
      continue;
    }

    const currentSelling = entry.price.selling;
    const currentMrp = entry.price.mrp;

    // The price a discount is taken off: the list price where there is one,
    // otherwise what the watch sells for today.
    const base = line.mrp ?? currentMrp ?? currentSelling;
    if (base === null) {
      skipped.push({ reference: line.model_number, reason: "no price on the listing to discount" });
      continue;
    }

    let selling: number;
    if (line.price !== null) {
      selling = Math.round(line.price);
    } else if (line.discount_pct !== null) {
      selling = Math.round(base * (1 - line.discount_pct / 100));
    } else {
      skipped.push({ reference: line.model_number, reason: "no discount or price on that line" });
      continue;
    }

    if (selling <= 0) {
      skipped.push({ reference: line.model_number, reason: "that discount leaves no price" });
      continue;
    }
    if (selling > base) {
      skipped.push({ reference: line.model_number, reason: "that price is above the list price" });
      continue;
    }
    if (selling === currentSelling && base === currentMrp) {
      skipped.push({ reference: line.model_number, reason: "already at that price" });
      continue;
    }

    changes.push({
      sku: entry.sku,
      reference: entry.modelNumber,
      title: entry.title,
      was: { selling: currentSelling, mrp: currentMrp },
      now: {
        selling,
        mrp: base > selling ? base : null,
        discountPct: base > selling ? Math.round(((base - selling) / base) * 100) : 0,
      },
    });
  }

  // --- write, only when asked ---------------------------------------------
  const failed: { reference: string; reason: string }[] = [];
  if (apply) {
    for (const change of changes) {
      const product = await getProduct(change.sku);
      if (!product) {
        failed.push({ reference: change.reference, reason: "delisted while the sheet was open" });
        continue;
      }
      await updateProduct(change.sku, {
        price: { selling: change.now.selling, mrp: change.now.mrp },
      });
    }
  }

  return Response.json({
    brand: brand.name,
    applied: apply,
    onShelf: shelf.size,
    read: parsed.rows.length,
    changes,
    unmatched,
    skipped: [...skipped, ...parsed.errors.map((e) => ({ reference: e.model_number, reason: e.reason }))],
    failed,
  });
}
