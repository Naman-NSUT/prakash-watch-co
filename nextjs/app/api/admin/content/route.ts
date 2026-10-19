import { requireAuth } from "@/lib/auth";
import { SiteCopySchema, getSiteCopy, saveSiteCopy } from "@/lib/site-copy";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;
  return Response.json(await getSiteCopy());
}

export async function POST(request: Request): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["Malformed request."] }, { status: 400 });
  }

  const parsed = SiteCopySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  return Response.json(await saveSiteCopy(parsed.data));
}
