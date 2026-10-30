/**
 * Server-side access to the catalog the agent produces.
 *
 * Artifacts on disk are the single source of truth: the agent writes them, the
 * admin panel edits them, the storefront reads them. Nothing here runs in the
 * browser.
 */
import "server-only";
import { cache } from "react";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig, COLLECTION_META, type CollectionId } from "@/agent/config";
import {
  BackdropSchema,
  CatalogEntrySchema,
  ProductImageSchema,
  WatchProductSchema,
  type Backdrop,
  type CatalogEntry,
  type WatchProduct,
} from "@/agent/types";
import type { RunReport } from "@/agent/types";
import { isRemote, mediaUrl, remoteJson } from "./remote";

const config = loadConfig();

/** Only `ready` listings are visible to shoppers; everything else awaits review. */
export const PUBLISHED_STATUS = "ready" as const;

/**
 * Every listing, in full.
 *
 * One file per watch, so this is 1,899 reads. Done one after another they took
 * eleven seconds, and the stock room pages that need them — the catalogue, the
 * price watch, a new bill — looked broken when you clicked them. Reading in
 * batches lets the disk work on several at once; the batch is bounded because
 * opening two thousand files at the same moment exhausts the file handles on a
 * small container.
 *
 * Cached for the life of one request: the catalogue page and its metadata ask
 * separately, and the books ask again through another path.
 */
const READ_AT_ONCE = 48;

/**
 * The last full read, kept between requests.
 *
 * Reading 1,900 artifacts means 1,900 file reads and 1,900 schema validations,
 * which took between four and eleven seconds — on every single stock room page,
 * because the overview, the analytics, the books and the catalogue all ask for
 * the same thing. Caching for the life of one request was not enough: the slow
 * part was happening once per click.
 *
 * The cache is keyed on what the directory looks like — how many artifacts
 * there are and the newest modification time among them. Collecting that costs
 * 1,900 stats, which is milliseconds, against seconds to read and validate. So
 * an agent run, a hand edit or a price change all invalidate it on the next
 * request, and nothing else does.
 *
 * It lives in the process, so it is per instance. The back end runs one.
 */
let memo: { signature: string; products: WatchProduct[] } | null = null;

async function signatureOf(files: string[]): Promise<string> {
  let newest = 0;
  for (let start = 0; start < files.length; start += 256) {
    const batch = await Promise.all(
      files.slice(start, start + 256).map((file) =>
        fs.stat(join(config.dataDir, file)).then(
          (s) => s.mtimeMs,
          () => 0,
        ),
      ),
    );
    for (const mtime of batch) if (mtime > newest) newest = mtime;
  }
  return `${files.length}:${newest}`;
}

export const getAllProducts = cache(async function getAllProducts(): Promise<WatchProduct[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(config.dataDir)).filter((name) => name.endsWith(".json") && name !== "index.json");
  } catch {
    return [];
  }

  const signature = await signatureOf(files);
  if (memo && memo.signature === signature) return memo.products;

  const products: WatchProduct[] = [];
  for (let start = 0; start < files.length; start += READ_AT_ONCE) {
    const batch = await Promise.all(
      files.slice(start, start + READ_AT_ONCE).map(async (file) => {
        try {
          const raw = await fs.readFile(join(config.dataDir, file), "utf8");
          const parsed = WatchProductSchema.safeParse(JSON.parse(raw));
          return parsed.success ? parsed.data : null;
        } catch {
          // A corrupt artifact must not take down the shop.
          return null;
        }
      }),
    );
    for (const product of batch) if (product) products.push(product);
  }

  products.sort((a, b) => a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title));
  memo = { signature, products };
  return products;
});

export async function getProduct(sku: string): Promise<WatchProduct | null> {
  // Guard against path traversal via the URL segment.
  if (!/^[a-z0-9-]+$/i.test(sku)) return null;
  if (isRemote()) {
    const remote = await remoteJson<unknown>(`/api/public/product/${sku}`);
    if (!remote) return null;
    const parsed = WatchProductSchema.safeParse(remote);
    return parsed.success ? withRemoteMedia(parsed.data) : null;
  }
  try {
    const raw = await fs.readFile(join(config.dataDir, `${sku}.json`), "utf8");
    const parsed = WatchProductSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getPublishedProducts(): Promise<WatchProduct[]> {
  return (await getAllProducts()).filter((product) => product.status === PUBLISHED_STATUS);
}

export interface CollectionSummary {
  id: CollectionId;
  no: string;
  name: string;
  note: string;
  count: number;
  /** Primary image of the newest listing, used for the homepage hover peek. */
  image: string | null;
}

/** The six families the homepage renders, with live counts and a real photograph. */
export async function getCollectionSummaries(): Promise<CollectionSummary[]> {
  // From the index, not the products. This runs on every home-page request and
  // needs only each watch's family and first photograph — both already in the
  // index. Reading the products instead meant opening all 1,899 files, 20 MB,
  // for every visitor; served from another host it would not finish at all.
  const listed = (await getCatalogIndex()).filter((entry) => entry.status === PUBLISHED_STATUS);

  return (Object.keys(COLLECTION_META) as CollectionId[]).map((id) => {
    const inFamily = listed.filter((entry) => entry.collection === id);
    const withImage = inFamily.find((entry) => entry.image);
    return {
      id,
      ...COLLECTION_META[id],
      count: inFamily.length,
      image: withImage?.image?.url ?? null,
    };
  });
}

/**
 * The whole index, read once per request.
 *
 * A brand page asks for it four times over — twice through getBrand (the page
 * and its metadata), then again for the grid and the brand list — and every one
 * of those parsed 3 MB of JSON from scratch. React's cache() collapses them into
 * a single read for the duration of one render, and forgets it afterwards, so a
 * run of the agent is still picked up on the next request.
 */
/**
 * The parsed index, kept between requests and not only within one.
 *
 * cache() collapses the reads inside a single render and forgets them
 * afterwards, so every page load re-read and re-parsed 3.3MB — a second of work
 * before a row was drawn. Keyed on the file's own modification time, so an
 * agent run, a hand edit or an approval is picked up on the next request and
 * nothing else invalidates it.
 */
let indexMemo: { signature: string; entries: CatalogEntry[] } | null = null;

/**
 * The last catalogue this instance saw, kept against the back end going away.
 *
 * The back end restarts on every deploy — a persistent disk cannot be handed
 * from one instance to the next, so Render stops the old one first — and a
 * customer who arrives during those two minutes reaches a Vercel instance that
 * may have been started in the same moment and so has nothing cached. Without
 * this it would rethrow, and the shop would show an error page because its
 * stock room was being updated.
 *
 * Stale stock beats no shop. The figures might be a few minutes old; the
 * alternative is a customer who thinks the business has gone under.
 */
let lastGoodIndex: CatalogEntry[] | null = null;

export const getCatalogIndex = cache(async function getCatalogIndex(): Promise<CatalogEntry[]> {
  if (isRemote()) {
    try {
      const entries = (await remoteJson<CatalogEntry[] | null>("/api/public/catalog")) ?? [];
      const resolved = entries.map((entry) =>
        entry.image ? { ...entry, image: { ...entry.image, url: mediaUrl(entry.image.url) } } : entry,
      );
      if (resolved.length) lastGoodIndex = resolved;
      return resolved;
    } catch (error) {
      if (lastGoodIndex) return lastGoodIndex;
      throw error;
    }
  }
  const path = join(config.dataDir, "index.json");
  try {
    const stamp = await fs.stat(path);
    const signature = `${stamp.mtimeMs}:${stamp.size}`;
    if (indexMemo && indexMemo.signature === signature) return indexMemo.entries;

    const entries = JSON.parse(await fs.readFile(path, "utf8")) as CatalogEntry[];
    indexMemo = { signature, entries };
    return entries;
  } catch {
    return [];
  }
});

/** The backdrop library as a list — the shape it is stored and sent in. */
export async function readBackdropList(): Promise<Backdrop[]> {
  try {
    const raw = isRemote()
      ? await remoteJson<unknown>("/api/public/backdrops")
      : JSON.parse(await fs.readFile(join(config.dataDir, "..", "backdrops.json"), "utf8"));
    const parsed = z.array(BackdropSchema).safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.map((backdrop) => ({ ...backdrop, url: mediaUrl(backdrop.url) }));
  } catch {
    return [];
  }
}

/**
 * The generated backdrop library, keyed by id.
 *
 * Backdrops are written once by the agent and shared by every listing that suits
 * them, so restyling the whole catalogue means regenerating six files rather than
 * reprocessing every photograph.
 */
export async function getBackdrops(): Promise<Map<string, Backdrop>> {
  return new Map((await readBackdropList()).map((backdrop) => [backdrop.id, backdrop]));
}

/** A listing read from the back end, with its photographs pointed at the back end. */
function withRemoteMedia(product: WatchProduct): WatchProduct {
  return { ...product, images: product.images.map((image) => ({ ...image, url: mediaUrl(image.url) })) };
}

/** Ingestion run reports, newest first. */
export async function getRuns(limit = 10): Promise<RunReport[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(config.reportDir)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  files.sort().reverse();
  const runs: RunReport[] = [];
  for (const file of files.slice(0, limit)) {
    try {
      runs.push(JSON.parse(await fs.readFile(join(config.reportDir, file), "utf8")) as RunReport);
    } catch {
      // Skip unreadable reports.
    }
  }
  return runs;
}

function catalogEntryOf(value: WatchProduct): CatalogEntry {
  return CatalogEntrySchema.parse({
    sku: value.sku,
    slug: value.slug,
    status: value.status,
    brand: value.brand,
    modelNumber: value.modelNumber,
    reference: value.reference,
    modelName: value.modelName,
    title: value.title,
    price: value.price,
    costPrice: value.costPrice,
    quantity: value.quantity,
    collection: value.collection,
    gender: value.gender,
    inStock: value.inStock,
    backdropId: value.backdropId,
    facets: value.facets,
    tags: value.tags,
    image: value.images[0] ?? null,
    tagline: value.copy.tagline,
    imageCount: value.images.length,
    specCount: value.specs.length,
    confidence: value.confidence.overall,
    flags: value.review.flags,
    sourceCount: value.sources.length,
    directSale: value.directSale,
    createdAt: value.meta.createdAt,
    updatedAt: value.meta.updatedAt,
  });
}

async function writeIndex(entries: CatalogEntry[]): Promise<CatalogEntry[]> {
  entries.sort((a, b) => a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title));
  const path = join(config.dataDir, "index.json");
  const temporary = `${path}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`);
  await fs.rename(temporary, path);
  const stamp = await fs.stat(path);
  indexMemo = { signature: `${stamp.mtimeMs}:${stamp.size}`, entries };
  return entries;
}

let indexMutation: Promise<void> = Promise.resolve();

/** Update one summary row without reopening and validating every artifact. */
async function mutateIndex(change: (entries: CatalogEntry[]) => CatalogEntry[]): Promise<CatalogEntry[]> {
  let result: CatalogEntry[] = [];
  const operation = indexMutation.then(async () => {
    const path = join(config.dataDir, "index.json");
    let entries: CatalogEntry[] = [];
    try {
      entries = JSON.parse(await fs.readFile(path, "utf8")) as CatalogEntry[];
    } catch {
      entries = [];
    }
    result = await writeIndex(change(entries));
  });
  // A failed edit must not permanently jam later index updates.
  indexMutation = operation.then(() => undefined, () => undefined);
  await operation;
  return result;
}

async function upsertIndex(product: WatchProduct): Promise<CatalogEntry[]> {
  const entry = catalogEntryOf(product);
  return mutateIndex((entries) => [...entries.filter((candidate) => candidate.sku !== product.sku), entry]);
}

async function removeFromIndex(sku: string): Promise<CatalogEntry[]> {
  return mutateIndex((entries) => entries.filter((candidate) => candidate.sku !== sku));
}

/**
 * Rebuilds the compact index after an agent batch or migration.
 *
 * Routine admin edits use upsertIndex instead, which changes one summary row
 * and avoids roughly 1,900 file reads and validations per click.
 */
export async function rebuildIndex(): Promise<CatalogEntry[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(config.dataDir)).filter((name) => name.endsWith(".json") && name !== "index.json");
  } catch {
    return [];
  }

  const entries: CatalogEntry[] = [];
  for (const file of files) {
    try {
      const parsed = WatchProductSchema.safeParse(JSON.parse(await fs.readFile(join(config.dataDir, file), "utf8")));
      if (!parsed.success) continue;
      entries.push(catalogEntryOf(parsed.data));
    } catch {
      // A corrupt artifact must not break the shop.
    }
  }

  return writeIndex(entries);
}

/** Fields the admin panel is allowed to change. */
export const ProductPatchSchema = z.object({
  status: z.enum(["ready", "needs_review"]).optional(),
  title: z.string().min(1).max(140).optional(),
  modelName: z.string().max(140).nullable().optional(),
  collection: z.enum(Object.keys(COLLECTION_META) as [CollectionId, ...CollectionId[]]).nullable().optional(),
  gender: z.enum(["men", "women", "unisex"]).nullable().optional(),
  inStock: z.boolean().optional(),
  /** True sells it, false sends the buyer to the shop, null follows the house. */
  directSale: z.boolean().nullable().optional(),
  quantity: z.number().int().nonnegative().nullable().optional(),
  price: z
    .object({
      selling: z.number().positive(),
      mrp: z.number().positive().nullable(),
    })
    .optional(),
  copy: z
    .object({
      tagline: z.string().max(140),
      short: z.string().max(400),
      long: z.string().max(4000),
      bullets: z.array(z.string().max(200)).max(8),
      seoTitle: z.string().max(140),
      seoDescription: z.string().max(400),
    })
    .partial()
    .optional(),
  /** Image URLs to keep, in display order. The first becomes the primary shot. */
  imageOrder: z.array(z.string()).optional(),
  /** Backdrop to place the cut-out watch on. Null leaves it as photographed. */
  backdropId: z.string().max(40).nullable().optional(),
  /**
   * The specification sheet, rewritten by hand.
   *
   * Research gets most of this right and occasionally gets one line wrong, which
   * on a spec sheet is worse than leaving it blank — so the shop can correct any
   * row. An edited row loses its source index: it is now the shop's word, not a
   * citation, and the listing should not claim otherwise.
   */
  specs: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        value: z.string().min(1).max(300),
        group: z.string().max(40).default("Specification"),
      }),
    )
    .max(60)
    .optional(),
  /** The readable attributes shown on the watch page. */
  attributes: z
    .object({
      movement: z.string().max(80).nullable(),
      caliber: z.string().max(80).nullable(),
      caseMaterial: z.string().max(80).nullable(),
      caseDiameterMm: z.number().min(0).max(100).nullable(),
      crystal: z.string().max(80).nullable(),
      dialColour: z.string().max(60).nullable(),
      strapMaterial: z.string().max(80).nullable(),
      waterResistance: z.string().max(60).nullable(),
      warranty: z.string().max(120).nullable(),
    })
    .partial()
    .optional(),
  /** The controlled values the sidebar filters on. */
  facets: z
    .object({
      movement: z.string().max(30).nullable(),
      caseMaterial: z.string().max(30).nullable(),
      strap: z.string().max(30).nullable(),
      dialColour: z.string().max(30).nullable(),
      waterResistance: z.string().max(10).nullable(),
      caseSize: z.string().max(20).nullable(),
    })
    .partial()
    .optional(),
});

export type ProductPatch = z.infer<typeof ProductPatchSchema>;

/**
 * Applies an admin edit to an artifact and rebuilds the storefront index.
 * Returns null when the sku does not exist.
 */
export async function updateProduct(sku: string, patch: ProductPatch): Promise<WatchProduct | null> {
  const product = await getProduct(sku);
  if (!product) return null;

  const next: WatchProduct = {
    ...product,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.modelName !== undefined
      ? {
          modelName: patch.modelName,
          ...(patch.modelName !== product.modelName ? { modelNameSourceIndex: null } : {}),
        }
      : {}),
    ...(patch.collection !== undefined ? { collection: patch.collection } : {}),
    ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
    ...(patch.inStock !== undefined ? { inStock: patch.inStock } : {}),
    ...(patch.directSale !== undefined ? { directSale: patch.directSale } : {}),
    ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
    copy: { ...product.copy, ...(patch.copy ?? {}) },
    meta: { ...product.meta, updatedAt: new Date().toISOString() },
  };

  if (patch.price) {
    const { selling, mrp } = patch.price;
    next.price = {
      currency: "INR",
      selling,
      mrp: mrp && mrp > selling ? mrp : null,
      discountPct: mrp && mrp > selling ? Math.round(((mrp - selling) / mrp) * 100) : null,
    };
  }

  if (patch.imageOrder) {
    const byUrl = new Map(product.images.map((image) => [image.url, image]));
    next.images = patch.imageOrder
      .map((url) => byUrl.get(url))
      .filter((image): image is NonNullable<typeof image> => Boolean(image));
  }

  // Keep gallery quality visible in the stock room without withdrawing the
  // watch. Recovery can add more angles later; the best available listing stays
  // searchable in the meantime.
  const galleryFlags: WatchProduct["review"]["flags"] = next.review.flags.filter(
    (flag) => flag !== "no-images" && flag !== "few-images",
  );
  if (next.images.length === 0) galleryFlags.push("no-images");
  else if (next.images.length < 3) galleryFlags.push("few-images");
  next.review = { ...next.review, flags: galleryFlags };

  if (patch.backdropId !== undefined) next.backdropId = patch.backdropId;

  if (patch.specs) {
    // sourceIndex is dropped deliberately: once a line has been edited by hand it
    // is no longer what the cited page said, and the listing must not imply it is.
    next.specs = patch.specs.map((spec) => ({
      label: spec.label,
      value: spec.value,
      group: spec.group || "Specification",
      sourceIndex: null,
    }));
  }

  if (patch.attributes) next.attributes = { ...product.attributes, ...patch.attributes };

  // Facets are set explicitly rather than re-derived here. The normalisation that
  // turns "10 Bar (Swim)" into the `100` bucket lives in the agent's facets.py and
  // is two hundred lines of hard-won rules; porting it to TypeScript would mean
  // two copies that drift. So when the shop corrects a value by hand it picks
  // from the same controlled vocabulary the filters use, and the admin form sends
  // the readable label for the spec sheet alongside it.
  if (patch.facets) next.facets = { ...product.facets, ...patch.facets };

  // Re-validate before writing so an edit cannot corrupt the artifact.
  const validated = WatchProductSchema.parse(next);
  await fs.writeFile(join(config.dataDir, `${sku}.json`), `${JSON.stringify(validated, null, 2)}\n`);
  await upsertIndex(validated);
  return validated;
}

/**
 * Appends photographs the shop supplied itself.
 *
 * Goes through the same validate-then-write path as every other edit, so a
 * malformed image record is rejected before it can reach the storefront rather
 * than after.
 */
export async function addImages(sku: string, images: unknown[]): Promise<WatchProduct | null> {
  const product = await getProduct(sku);
  if (!product) return null;

  const incoming = z.array(ProductImageSchema).parse(images);
  const combined = [...product.images, ...incoming]
    .filter((image, index, all) => all.findIndex((candidate) => candidate.url === image.url) === index)
    .slice(0, 5);
  const flags: WatchProduct["review"]["flags"] = product.review.flags.filter(
    (flag) => flag !== "no-images" && flag !== "few-images",
  );
  if (combined.length === 0) flags.push("no-images");
  else if (combined.length < 3) flags.push("few-images");
  const next = {
    ...product,
    images: combined,
    review: { ...product.review, flags },
    meta: { ...product.meta, updatedAt: new Date().toISOString() },
  };

  const validated = WatchProductSchema.parse(next);
  await fs.writeFile(join(config.dataDir, `${sku}.json`), `${JSON.stringify(validated, null, 2)}\n`);
  await upsertIndex(validated);
  return validated;
}

/** Removes an artifact and its images. */
export async function deleteProduct(sku: string): Promise<boolean> {
  if (!/^[a-z0-9-]+$/i.test(sku)) return false;
  try {
    await fs.unlink(join(config.dataDir, `${sku}.json`));
  } catch {
    return false;
  }
  await fs.rm(join(config.imageDir, sku), { recursive: true, force: true });
  await removeFromIndex(sku);
  return true;
}

export { COLLECTION_META };
export type { Backdrop };
export type { CollectionId, WatchProduct, CatalogEntry };
