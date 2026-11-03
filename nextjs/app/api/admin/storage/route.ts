import { requireAuth } from "@/lib/auth";
import { pruneAgentCache, readStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  try {
    return Response.json(await readStorage(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The storage report could not be read." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const unauthorised = await requireAuth();
  if (unauthorised) return unauthorised;

  let action = "";
  try {
    const body = (await request.json()) as { action?: unknown };
    action = typeof body.action === "string" ? body.action : "";
  } catch {
    return Response.json({ error: "A JSON action is required." }, { status: 400 });
  }

  if (action !== "prune-agent-cache") {
    return Response.json({ error: "Unknown storage action." }, { status: 400 });
  }

  try {
    const result = await pruneAgentCache();
    return Response.json({ ...result, storage: await readStorage() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The agent cache could not be cleared." },
      { status: 500 },
    );
  }
}
