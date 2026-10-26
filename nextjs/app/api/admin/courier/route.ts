import { requireAuth } from "@/lib/auth";
import { CourierSettingsSchema, getCourierSettings, saveCourierSettings, withoutToken } from "@/lib/courier";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;
  // The token never comes back out — only whether there is one, and its last
  // four characters so the shop can tell which key is in there.
  return Response.json(withoutToken(await getCourierSettings()));
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

  const parsed = CourierSettingsSchema.partial().safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }

  // An empty token field means "leave the one you have", not "delete it" —
  // otherwise saving a changed pickup name would wipe the key every time.
  const current = await getCourierSettings();
  const next = CourierSettingsSchema.parse({
    ...current,
    ...parsed.data,
    token: parsed.data.token?.trim() ? parsed.data.token.trim() : current.token,
  });
  return Response.json(withoutToken(await saveCourierSettings(next)));
}
