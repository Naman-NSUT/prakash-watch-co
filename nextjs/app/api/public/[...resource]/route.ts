/**
 * What the shop front on Vercel is allowed to read, and nothing else.
 *
 * Served by the back end, from the same disk the admin panel writes. It answers
 * five questions — the catalogue, one listing, the backdrops, the brand notes,
 * the live offers — and it answers them the way the public pages would: listed
 * watches only, with every figure the public must not see replaced before it
 * leaves. The shop's cost price, stock count, review notes and research spend
 * stay on this side.
 *
 * Whitelisted rather than filtered, so a new private file added later is not
 * public until someone decides it should be.
 */
import { getCatalogIndex, getProduct, PUBLISHED_STATUS, readBackdropList } from "@/lib/catalog";
import { readBrandNotes } from "@/lib/brands";
import { liveOffers } from "@/lib/offers";
import { isRemote } from "@/lib/remote";
import type { CatalogEntry, WatchProduct } from "@/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = process.env.PWC_PUBLIC_API_TOKEN ?? "";

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function matchesToken(provided: string | null): boolean {
  if (!TOKEN) return true;
  if (!provided || provided.length !== TOKEN.length) return false;
  let difference = 0;
  for (let i = 0; i < TOKEN.length; i++) difference |= TOKEN.charCodeAt(i) ^ provided.charCodeAt(i);
  return difference === 0;
}

/** An index entry with nothing on it the public should not see. */
function publicEntry(entry: CatalogEntry): CatalogEntry {
  // The index is written by the agent as well as the site, and the agent's copy
  // can carry the cost price. It is removed here whichever wrote it.
  const { costPrice: _cost, ...rest } = entry as CatalogEntry & { costPrice?: unknown };
  return rest as CatalogEntry;
}

/** A listing as the public pages need it: private figures replaced, not dropped,
 *  so the shop front can still validate it against the same schema. */
function publicProduct(product: WatchProduct): WatchProduct {
  return {
    ...product,
    costPrice: null,
    quantity: null,
    confidence: { overall: 0, identity: 0, specs: 0, images: 0 },
    review: { flags: [], notes: [] },
    meta: {
      ...product.meta,
      runId: "",
      sourceFile: "",
      model: "",
      costUsd: 0,
      queries: [],
    },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string[] }> },
): Promise<Response> {
  // This is the back end's API. A shop front that is itself reading remotely
  // must never answer it, or a misconfigured URL makes it call itself forever.
  if (isRemote()) return json({ errors: ["Not found."] }, 404);
  if (!matchesToken(request.headers.get("x-pwc-token"))) return json({ errors: ["Not allowed."] }, 401);

  const [kind, ...rest] = (await params).resource;

  switch (kind) {
    case "catalog": {
      const listed = (await getCatalogIndex()).filter((entry) => entry.status === PUBLISHED_STATUS);
      return json(listed.map(publicEntry));
    }
    case "product": {
      const sku = rest[0] ?? "";
      const product = await getProduct(sku);
      // Held for review means not on the shop, whoever asks.
      if (!product || product.status !== PUBLISHED_STATUS) return json(null, 404);
      return json(publicProduct(product));
    }
    case "backdrops":
      // A list, not the Map getBackdrops() builds: a Map serialises as {}.
      return json(await readBackdropList());
    case "brand-notes":
      return json(await readBrandNotes());
    case "offers":
      return json(await liveOffers());
    default:
      return json({ errors: ["Not found."] }, 404);
  }
}
