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

export function isRemote(): boolean {
  return BACKEND.length > 0;
}

type Slot = { at: number; value?: unknown; pending?: Promise<unknown> };
const slots = new Map<string, Slot>();

/** A JSON answer from the back end's public API, or null when it says 404. */
export async function remoteJson<T>(path: string): Promise<T> {
  const now = Date.now();
  const slot = slots.get(path);

  if (slot && "value" in slot && now - slot.at < FRESH_FOR_MS) return slot.value as T;
  // Many requests arriving together share one fetch rather than each starting one.
  if (slot?.pending) return slot.pending as Promise<T>;

  const pending = (async () => {
    const response = await fetch(`${BACKEND}${path}`, {
      headers: TOKEN ? { "x-pwc-token": TOKEN } : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`The back end answered ${response.status} for ${path}.`);
    return response.json();
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
 * A photograph's address, made absolute when the photographs live on the back
 * end. Listings store "/media/…", which on Vercel would point at a host that has
 * none; absolute, the image optimiser fetches it from Render once and serves
 * every later request for it from Vercel's cache.
 */
export function mediaUrl(url: string): string {
  return isRemote() && url.startsWith("/media/") ? `${BACKEND}${url}` : url;
}
