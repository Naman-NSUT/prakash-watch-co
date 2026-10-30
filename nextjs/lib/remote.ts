/**
 * Reading the shop's data from the back end, for the shop front on Vercel.
 *
 * The data — listings, photographs, offers — lives on one disk on Render, next to
 * the admin panel and the agent that write it. The public site runs somewhere
 * with no disk at all, so when PWC_BACKEND_URL is set it asks the back end
 * instead of opening files. When it is not set — on Render itself, and on the
 * shop's own machine — nothing here is used and every read stays local.
 *
 * Two things make this bearable over a network:
 *
 * * Answers are kept in memory for five minutes. The catalogue index is 3 MB, the
 *   public pages read it on every request, and a function instance serves many
 *   requests; refetching it each time would be slow for visitors and costly for
 *   the back end.
 * * If the back end is unreachable, the last good answer is served instead of an
 *   error. Render restarts the back end on every deploy, and a shop front that
 *   goes blank for those seconds is worse than one a few minutes out of date.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { gzipSync, gunzipSync } from "node:zlib";

const BACKEND = (process.env.PWC_BACKEND_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.PWC_PUBLIC_API_TOKEN ?? "";

/**
 * How out of date the public site may be. Five minutes: prices change when the
 * shop refreshes them, not second to second, and every refetch of the 3 MB index
 * is bandwidth on the back end and CPU time on the shop front — both metered on
 * the plans this runs on.
 */
const FRESH_FOR_MS = 5 * 60_000;
const TIMEOUT_MS = 15_000;
const CATALOG_PATH = "/api/public/catalog";
const CATALOG_ATTEMPTS = 3;
const CATALOG_TIMEOUT_MS = 5_000;

export function isRemote(): boolean {
  return BACKEND.length > 0;
}

type Slot = { at: number; value?: unknown; pending?: Promise<unknown> };
const slots = new Map<string, Slot>();

async function fetchJson<T>(path: string, timeoutMs = TIMEOUT_MS, sharedCache = true): Promise<T> {
  const response = await fetch(`${BACKEND}${path}`, {
    headers: TOKEN ? { "x-pwc-token": TOKEN } : undefined,
    // Product records, brand notes and the other small public answers fit in
    // Vercel's shared data cache. Keeping them there means a new function does
    // not have to wake Render before it can draw a watch page. The catalogue is
    // handled separately below because its uncompressed answer is larger than
    // one cache item.
    ...(sharedCache
      ? { next: { revalidate: Math.round(FRESH_FOR_MS / 1000) } }
      : { cache: "no-store" as const }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) return null as T;
  if (!response.ok) throw new Error(`The back end answered ${response.status} for ${path}.`);
  return response.json() as Promise<T>;
}

async function fetchCatalog(): Promise<unknown[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CATALOG_ATTEMPTS; attempt += 1) {
    try {
      const value = await fetchJson<unknown>(CATALOG_PATH, CATALOG_TIMEOUT_MS, false);
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error("The back end returned an empty catalogue.");
      }
      return value;
    } catch (error) {
      lastError = error;
      if (attempt < CATALOG_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 150));
      }
    }
  }
  throw lastError;
}

/**
 * The catalogue is about 3 MB as JSON, larger than a single Vercel data-cache
 * item. Compressing it brings it comfortably under the limit. More importantly,
 * the cache is filled only after the answer has been parsed and proved non-empty:
 * a booting back end can no longer replace 1,637 watches with a cached `[]`.
 */
const cachedCatalog = unstable_cache(
  async () => gzipSync(JSON.stringify(await fetchCatalog())).toString("base64"),
  // Bump when the index contract or publication policy changes. A stable key
  // survives deployments, which is useful for ordinary code releases but would
  // otherwise keep pre-migration image counts/statuses alive for five minutes.
  ["pwc-public-catalog-gzip-v3", BACKEND],
  { revalidate: Math.round(FRESH_FOR_MS / 1000) },
);

async function readCatalog(): Promise<unknown[]> {
  const packed = await cachedCatalog();
  const value = JSON.parse(gunzipSync(Buffer.from(packed, "base64")).toString("utf8")) as unknown;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("The cached catalogue is empty or invalid.");
  }
  return value;
}

/** A JSON answer from the back end's public API, or null when it says 404. */
export async function remoteJson<T>(path: string): Promise<T> {
  const now = Date.now();
  const slot = slots.get(path);

  if (slot && "value" in slot && now - slot.at < FRESH_FOR_MS) return slot.value as T;
  // Many requests arriving together share one fetch rather than each starting one.
  if (slot?.pending) return slot.pending as Promise<T>;

  const pending = (async () => {
    if (path === CATALOG_PATH) return readCatalog();
    return fetchJson(path);
  })();
  slots.set(path, { ...slot, at: slot?.at ?? 0, pending });

  try {
    const value = await pending;
    slots.set(path, { at: Date.now(), value });
    return value as T;
  } catch (error) {
    if (slot && "value" in slot) {
      // Stale beats blank. Keep the old timestamp so the next request retries.
      slots.set(path, { at: slot.at, value: slot.value });
      return slot.value as T;
    }
    slots.delete(path);
    throw error;
  }
}

/**
 * Keep catalogue photographs on this origin. On Vercel, /media is rewritten to
 * the back end and cached at the edge; sending browsers to Render directly
 * bypasses that cache and makes every visitor pay the back end's latency.
 */
export function mediaUrl(url: string): string {
  return url;
}
