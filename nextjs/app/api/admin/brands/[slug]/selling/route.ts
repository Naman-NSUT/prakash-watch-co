/**
 * Whether a house may be bought straight from the website.
 *
 * Off by default, and changed only here: a brand is sold online because the
 * shop decided it, never because nobody said otherwise. Some makers hold their
 * dealers to selling in person; some watches the shop would simply rather talk
 * through.
 */
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getBrands, updateBrandNote } from "@/lib/brands";

export const runtime = "nodejs";

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const Body = z.object({ directSale: z.boolean() });

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["Malformed request."] }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ errors: ["Say true or false."] }, { status: 400 });

  const note = await updateBrandNote(slug, { directSale: parsed.data.directSale });
  return Response.json({ slug, directSale: note.directSale ?? false });
}
