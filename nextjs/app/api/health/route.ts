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
const BACKEND_URL = (process.env.PWC_BACKEND_URL ?? "").replace(/\/+$/, "");

export async function GET(): Promise<Response> {
  // Vercel serves the public shop but does not have the catalogue disk or agent.
  // Ask the Render service that owns both instead of reporting Vercel's expected
  // lack of local state as an outage.
  if (BACKEND_URL) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      const health = (await response.json()) as { ok?: boolean; disk?: boolean; agent?: boolean };
      const ok = response.ok && health.ok === true;
      return Response.json(
        { ok, disk: health.disk === true, agent: health.agent === true },
        { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
      );
    } catch {
      return Response.json(
        { ok: false, disk: false, agent: false },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
  }

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
