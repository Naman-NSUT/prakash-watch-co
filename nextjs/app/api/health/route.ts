/**
 * What the host polls to decide whether this instance is alive.
 *
 * It answers healthy when the site can serve the shop, which means one thing: the
 * data disk is mounted and the catalogue is readable. The agent is reported but
 * does not decide the answer — the shop sells perfectly well while it restarts,
 * and a failing check here would make the host kill the whole container, taking
 * the public site down to fix a component the public never touches.
 *
 * Says nothing a stranger could use: no paths, no counts, no versions.
 */
import { access } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "@/agent/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_URL = process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:8077";

export async function GET(): Promise<Response> {
  let disk = false;
  try {
    await access(join(dataRoot(), "catalog", "index.json"));
    disk = true;
  } catch {
    disk = false;
  }

  let agent = false;
  try {
    const response = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(1500) });
    agent = response.ok;
  } catch {
    agent = false;
  }

  return Response.json(
    { ok: disk, disk, agent },
    { status: disk ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
