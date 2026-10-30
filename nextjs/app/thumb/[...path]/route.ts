import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = (process.env.PWC_BACKEND_URL ?? "").replace(/\/+$/, "");
const WIDTHS = new Set([160, 320, 960]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const parts = (await params).path;
  if (!parts.length || parts.some((part) => !/^[a-z0-9._-]+$/i.test(part))) {
    return new Response("Not found.", { status: 404 });
  }

  const requested = Number(new URL(request.url).searchParams.get("w"));
  if (!WIDTHS.has(requested)) return new Response("Unsupported size.", { status: 400 });

  const mediaPath = `/media/${parts.map(encodeURIComponent).join("/")}`;
  if (!BACKEND) return Response.redirect(new URL(mediaPath, request.url), 307);

  const upstream = await fetch(`${BACKEND}${mediaPath}`, {
    cache: "force-cache",
    signal: AbortSignal.timeout(15_000),
  });
  if (!upstream.ok) return new Response("Not found.", { status: upstream.status });

  try {
    const image = await sharp(Buffer.from(await upstream.arrayBuffer()), { failOn: "none" })
      .rotate()
      .resize({ width: requested, height: requested, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();

    return new Response(image, {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
        "vercel-cdn-cache-control": "public, s-maxage=31536000, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new Response("Could not prepare image.", { status: 422 });
  }
}
