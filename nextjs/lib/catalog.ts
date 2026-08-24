/**
 * Server-side access to the catalog the agent produces.
 *
 * Artifacts on disk are the single source of truth: the agent writes them, the
 * admin panel edits them, the storefront reads them. Nothing here runs in the
 * browser.
 */
import "server-only";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig, COLLECTION_META, type CollectionId } from "@/agent/config";
import {
  BackdropSchema,
  CatalogEntrySchema,
  WatchProductSchema,
  type Backdrop,
  type CatalogEntry,
  type WatchProduct,
} from "@/agent/types";
import type { RunReport } from "@/agent/types";

const config = loadConfig();

/** Only `ready` listings are visible to shoppers; everything else awaits review. */
export const PUBLISHED_STATUS = "ready" as const;

export async function getAllProducts(): Promise<WatchProduct[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(config.dataDir)).filter((name) => name.endsWith(".json") && name !== "index.json");
  } catch {
    return [];
  }

  const products: WatchProduct[] = [];
  for (const file of files) {
    try {
      const parsed = WatchProductSchema.safeParse(JSON.parse(await fs.readFile(join(config.dataDir, file), "utf8")));
      if (parsed.success) products.push(parsed.data);
    } catch {
      // A corrupt artifact must not take down the shop.
    }
  }

  products.sort((a, b) => a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title));
  return products;
}

export async function getProduct(sku: string): Promise<WatchProduct | null> {
  // Guard against path traversal via the URL segment.
  if (!/^[a-z0-9-]+$/i.test(sku)) return null;
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
  const products = await getPublishedProducts();

  return (Object.keys(COLLECTION_META) as CollectionId[]).map((id) => {
    const inFamily = products.filter((product) => product.collection === id);
    const withImage = inFamily.find((product) => product.images.length > 0);
    return {
      id,
      ...COLLECTION_META[id],
      count: inFamily.length,
      image: withImage?.images[0]?.url ?? null,
    };
  });
}

export async function getCatalogIndex(): Promise<CatalogEntry[]> {
  try {
    return JSON.parse(await fs.readFile(join(config.dataDir, "index.json"), "utf8")) as CatalogEntry[];
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
  try {
    const raw = JSON.parse(await fs.readFile(join(config.dataDir, "..", "backdrops.json"), "utf8"));
    const parsed = z.array(BackdropSchema).safeParse(raw);
    if (!parsed.success) return new Map();
    return new Map(parsed.data.map((backdrop) => [backdrop.id, backdrop]));
  } catch {
    return new Map();
  }
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

/**
 * Rebuilds the compact index the collections page reads.
 *
 * The Python agent writes this after every run; this copy exists so an admin edit
 * updates the shop immediately without re-running the agent.
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
      const value = parsed.data;
      entries.push(
        CatalogEntrySchema.parse({
          sku: value.sku,
          slug: value.slug,
          status: value.status,
          brand: value.brand,
          modelNumber: value.modelNumber,
          modelName: value.modelName,
          title: value.title,
          price: value.price,
          collection: value.collection,
          gender: value.gender,
          inStock: value.inStock,
          backdropId: value.backdropId,
          image: value.images[0] ?? null,
          tagline: value.copy.tagline,
        }),
      );
    } catch {
      // A corrupt artifact must not break the shop.
    }
  }

  entries.sort((a, b) => a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title));
  await fs.writeFile(join(config.dataDir, "index.json"), `${JSON.stringify(entries, null, 2)}\n`);
  return entries;
}

/** Fields the admin panel is allowed to change. */
export const ProductPatchSchema = z.object({
  status: z.enum(["ready", "needs_review"]).optional(),
  title: z.string().min(1).max(140).optional(),
  modelName: z.string().max(140).nullable().optional(),
  collection: z.enum(Object.keys(COLLECTION_META) as [CollectionId, ...CollectionId[]]).nullable().optional(),
  gender: z.enum(["men", "women", "unisex"]).nullable().optional(),
  inStock: z.boolean().optional(),
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
    ...(patch.modelName !== undefined ? { modelName: patch.modelName } : {}),
    ...(patch.collection !== undefined ? { collection: patch.collection } : {}),
    ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
    ...(patch.inStock !== undefined ? { inStock: patch.inStock } : {}),
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

  // Re-validate before writing so an edit cannot corrupt the artifact.
  const validated = WatchProductSchema.parse(next);
  await fs.writeFile(join(config.dataDir, `${sku}.json`), `${JSON.stringify(validated, null, 2)}\n`);
  await rebuildIndex();
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
  await rebuildIndex();
  return true;
}

export { COLLECTION_META };
export type { Backdrop };
export type { CollectionId, WatchProduct, CatalogEntry };
