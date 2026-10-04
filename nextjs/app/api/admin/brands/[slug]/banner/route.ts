/**
 * The photograph across the top of a brand's page.
 *
 * Uploaded from the stock room, stored with the shop's own photographs rather
 * than in `public/`: a banner is something the shop changes for a festival, not
 * something that should need a deploy. It lands on the same disk as the
 * catalogue, so it survives one and travels with a backup.
 *
 * One banner per brand, overwritten in place. The filename carries a short hash
 * of the image so a replacement is never served from a stale cache.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { requireAuth } from "@/lib/auth";
import { dataRoot } from "@/agent/config";
import { getBrands, updateBrandNote } from "@/lib/brands";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 12 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Wide and short: it sits above the listing, it does not become the page. */
const WIDTH = 2400;
const HEIGHT = 820;

const dir = () => join(dataRoot(), "media", "_banners");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  const { slug } = await params;
  if (!SLUG.test(slug)) return Response.json({ errors: ["Bad brand."] }, { status: 400 });

  const brands = await getBrands();
  const brand = brands.find((candidate) => candidate.slug === slug);
  if (!brand) return Response.json({ errors: ["No such brand on the shelf."] }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ errors: ["Expected a file upload."] }, { status: 400 });
  }

  const file = form.get("banner");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ errors: ["No image was attached."] }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ errors: ["That image is larger than 12 MB."] }, { status: 400 });
  }

  const alt = String(form.get("alt") ?? "").trim().slice(0, 180);

  let webp: Buffer;
  try {
    // sharp also validates: a renamed text file throws here rather than
    // reaching the brand page.
    webp = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return Response.json({ errors: ["That file is not an image this can read."] }, { status: 400 });
  }

  const stamp = createHash("sha256").update(webp).digest("hex").slice(0, 8);
  const filename = `${slug}-${stamp}.webp`;

  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(join(dir(), filename), webp);

  // Sweep this brand's older banners: one per brand, and they are large.
  for (const stale of await fs.readdir(dir()).catch(() => [])) {
    if (stale.startsWith(`${slug}-`) && stale !== filename) {
      await fs.rm(join(dir(), stale), { force: true });
    }
  }

  const note = await updateBrandNote(slug, {
    banner: `/media/_banners/${filename}`,
    bannerAlt: alt || `${brand.name} at Prakash Watch Co.`,
  });

  return Response.json({ banner: note.banner, bannerAlt: note.bannerAlt, bytes: webp.length });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  const { slug } = await params;
  if (!SLUG.test(slug)) return Response.json({ errors: ["Bad brand."] }, { status: 400 });

  for (const stale of await fs.readdir(dir()).catch(() => [])) {
    if (stale.startsWith(`${slug}-`)) await fs.rm(join(dir(), stale), { force: true });
  }

  await updateBrandNote(slug, { banner: undefined, bannerAlt: undefined });
  return Response.json({ banner: null });
}
