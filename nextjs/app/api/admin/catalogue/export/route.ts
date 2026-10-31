import { requireAuth } from "@/lib/auth";
import { getCatalogIndex } from "@/lib/catalog";
import { brandSlug, getBrands } from "@/lib/brands";
import { csvResponse } from "@/lib/csv";

export const runtime = "nodejs";

/**
 * The stock list, as a spreadsheet.
 *
 * What the catalogue page shows, in a file the shop can send to its accountant,
 * read on a phone in the shop, or set beside the stock sheet it uploaded to see
 * what the agent made of it.
 *
 * It takes the same filters as the page, so what downloads is what is on the
 * screen. Downloading "everything" when the shop is looking at the 264 held for
 * review would be a quietly wrong answer.
 *
 * The index carries all of it, so this costs one file read rather than opening
 * 1,900 artifacts.
 */
export async function GET(request: Request): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? "";
  const flag = params.get("flag") ?? "";
  const needle = (params.get("q") ?? "").trim().toLowerCase();

  const houses = new Map((await getBrands()).map((house) => [house.slug, house.directSale]));
  const entries = (await getCatalogIndex()).filter((entry) => {
    if (needle) {
      const haystack = [entry.modelNumber, entry.brand, entry.title, entry.modelName, entry.sku]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
      if (!haystack) return false;
    }
    if (flag) return entry.flags.includes(flag);
    if (status === "review") return entry.status !== "ready";
    if (status === "live") return entry.status === "ready";
    return true;
  });

  const rows: unknown[][] = [
    [
      "Reference", "Brand", "Watch", "Collection", "For",
      "Price (incl. GST)", "MRP", "Availability (derived)", "Quantity",
      "On the website", "Photographs", "Specifications", "Confidence",
      "Sold online", "Held for", "Listed on", "Last changed", "Page",
    ],
  ];

  let units = 0;
  let value = 0;

  for (const entry of entries) {
    const price = entry.price.selling ?? 0;
    // Quantity is the editable source of truth. Older exports flattened every
    // positive count to 1, so downloading, editing and uploading the shop's own
    // sheet could quietly destroy a real multi-piece count.
    const count = entry.quantity ?? (entry.inStock ? 1 : 0);
    units += count;
    value += price * count;

    const house = houses.get(brandSlug(entry.brand)) ?? false;
    rows.push([
      entry.modelNumber,
      entry.brand,
      entry.title,
      entry.collection ?? "",
      entry.gender ?? "",
      price || "not priced",
      entry.price.mrp ?? "",
      entry.inStock ? "yes" : "no",
      count,
      entry.status === "ready" ? "yes" : "no",
      entry.imageCount,
      entry.specCount,
      `${Math.round(entry.confidence * 100)}%`,
      entry.directSale === null || entry.directSale === undefined
        ? house ? "follows the house (yes)" : "follows the house (no)"
        : entry.directSale ? "yes" : "no",
      entry.flags.join("; "),
      (entry.createdAt || "").slice(0, 10),
      (entry.updatedAt || "").slice(0, 10),
      `https://www.prakashwatchco.in/watch/${entry.slug}`,
    ]);
  }

  // A total the shop can check at a glance, and the figure it will be asked for.
  rows.push([]);
  rows.push(["", `${entries.length} listing(s)`, "", "", "", "", "", "", units, "", "", "", "", "", "", "", "", ""]);
  rows.push(["", "Retail value of what is in stock", "", "", value]);

  const scope = flag ? `flagged-${flag}` : status === "review" ? "not-uploaded" : status === "live" ? "on-the-website" : "all";
  return csvResponse(`prakash-stock-${scope}`, rows);
}
