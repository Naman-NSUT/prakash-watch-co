import { promises as fs } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@/agent/config";
import { getFirm } from "@/lib/firm";

/**
 * The shop's following, counted rather than claimed where that is possible.
 *
 * A hand-typed "74K" on the front page goes stale the week it is written. The
 * real figure can be read, but only through Meta's own API and only for a
 * Professional account: there is no public endpoint, and scraping instagram.com
 * is both blocked and against their terms, so this does not try.
 *
 * What it needs, once, from the shop:
 *   INSTAGRAM_USER_ID  the Instagram-scoped id of the business account
 *   INSTAGRAM_TOKEN    a long-lived access token (60 days, refreshable)
 *
 * Without those it falls back to the figure kept in the shop's own details,
 * which is editable and honest about being an estimate. With them, the count is
 * fetched at most once every six hours — the front page is not worth a call to
 * Meta on every request, and a follower count does not change by the second.
 */
const config = loadConfig();
const CACHE = join(config.dataDir, "..", ".instagram.json");
const SIX_HOURS = 6 * 60 * 60 * 1000;

export interface Following {
  /** The number to show. */
  count: number;
  /** Where it came from, so the page can be honest in its wording. */
  live: boolean;
  /** The profile to link to, or "" when the shop has not given one. */
  url: string;
  handle: string;
}

interface Cached {
  count: number;
  at: number;
}

async function cached(): Promise<Cached | null> {
  try {
    const raw = JSON.parse(await fs.readFile(CACHE, "utf8"));
    if (typeof raw?.count === "number" && typeof raw?.at === "number") return raw;
  } catch {
    // No cache yet, or it is unreadable; ask Meta.
  }
  return null;
}

async function remember(count: number): Promise<void> {
  try {
    await fs.writeFile(CACHE, JSON.stringify({ count, at: Date.now() }), "utf8");
  } catch {
    // A read-only disk must not take the front page down.
  }
}

async function fromInstagram(): Promise<number | null> {
  const id = process.env.INSTAGRAM_USER_ID;
  const token = process.env.INSTAGRAM_TOKEN;
  if (!id || !token) return null;

  try {
    const response = await fetch(
      `https://graph.instagram.com/v21.0/${encodeURIComponent(id)}?fields=followers_count&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(6000), cache: "no-store" },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const count = Number(payload?.followers_count);
    return Number.isFinite(count) && count > 0 ? count : null;
  } catch {
    // Meta is down, the token has expired, or the network refused. The stored
    // figure stands rather than the page showing nothing.
    return null;
  }
}

export async function getFollowing(): Promise<Following> {
  const firm = await getFirm();
  const handle = (firm.instagram?.handle ?? "").replace(/^@/, "");
  const url = handle ? `https://www.instagram.com/${handle}/` : "";
  const stated = firm.instagram?.followers ?? 0;

  const held = await cached();
  if (held && Date.now() - held.at < SIX_HOURS) {
    return { count: held.count, live: true, url, handle };
  }

  const fresh = await fromInstagram();
  if (fresh !== null) {
    await remember(fresh);
    return { count: fresh, live: true, url, handle };
  }

  // Keep showing the last real figure even once it is stale, in preference to
  // a number somebody typed a year ago.
  if (held) return { count: held.count, live: true, url, handle };
  return { count: stated, live: false, url, handle };
}

/** 74,213 → "74K". The front page wants a figure, not an audit. */
export function roundFollowing(count: number): string {
  if (count >= 100000) return `${Math.round(count / 1000)}K`;
  if (count >= 1000) return `${Math.floor(count / 1000)}K`;
  return String(count);
}
