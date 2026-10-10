/**
 * The shop's own banners: written, replaced and removed from the stock room.
 *
 * An upload goes through sharp, which both normalises the picture and refuses
 * anything that is not one — a renamed text file throws here rather than
 * reaching the front page. The file is named for its own hash, so replacing a
 * banner can never be served from a stale cache.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { requireAuth } from "@/lib/auth";
import { dataRoot } from "@/agent/config";
import { deleteBanner, listBanners, saveBanner } from "@/lib/banners";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 12 * 1024 * 1024;
/** Wide and short: it drifts past, it is not a page. */
const WIDTH = 1600;
const HEIGHT = 600;

const dir = () => join(dataRoot(), "media", "_banners");

export async function GET(): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;
  return Response.json(await listBanners());
}

export async function POST(request: Request): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ errors: ["Expected a form."] }, { status: 400 });
  }

  const id = String(form.get("id") ?? "") || undefined;
  const file = form.get("image");

  let image: string | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      return Response.json({ errors: ["That image is larger than 12 MB."] }, { status: 400 });
    }
    let webp: Buffer;
    try {
      webp = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      return Response.json({ errors: ["That file is not an image this can read."] }, { status: 400 });
    }
    const stamp = createHash("sha256").update(webp).digest("hex").slice(0, 10);
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(join(dir(), `strip-${stamp}.webp`), webp);
    image = `/media/_banners/strip-${stamp}.webp`;
  }

  if (!id && !image) {
    return Response.json({ errors: ["A new banner needs a picture."] }, { status: 400 });
  }

  const text = (key: string, max: number) => {
    const value = form.get(key);
    return value === null ? undefined : String(value).trim().slice(0, max);
  };
  const liveRaw = form.get("live");

  const banner = await saveBanner({
    id,
    image,
    alt: text("alt", 180),
    heading: text("heading", 80),
    caption: text("caption", 160),
    href: text("href", 300),
    order: form.get("order") === null ? undefined : Number(form.get("order")) || 0,
    live: liveRaw === null ? undefined : liveRaw === "true",
  });

  return Response.json(banner, { status: id ? 200 : 201 });
}

export async function DELETE(request: Request): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ errors: ["Which banner?"] }, { status: 400 });

  await deleteBanner(id);
  return Response.json({ deleted: id });
}
