import "server-only";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig } from "@/agent/config";
import { isRemote, remoteJson } from "@/lib/remote";

/**
 * The words on the front page, kept where the shop can change them.
 *
 * Everything here was written into the components, so correcting a sentence or
 * a figure meant a developer and a deploy — and a claim nobody could edit goes
 * stale and then goes wrong. The shop's following was stated as seventy
 * thousand on a page the shop could not edit while the real figure was
 * forty-two.
 *
 * Only the claims and the prose live here. Layout, order and typography stay in
 * the components, because those are design decisions rather than copy, and a
 * stock room that could rearrange the front page would be a stock room nobody
 * dares touch.
 */
const config = loadConfig();
const PATH = join(config.dataDir, "..", "site-copy.json");

export const SiteCopySchema = z.object({
  hero: z.object({
    lead: z.string().default(
      "Since 1976 we have sold, set and serviced fine watches across Delhi and Gurugram. Authorized retail for the houses that matter — and a workshop that keeps them running long after the sale.",
    ),
    marks: z.array(z.string()).default([
      "50 years of service",
      "20+ authorized houses",
      "In-house workshop",
    ]),
  }).prefault({}),

  heritage: z.object({
    year: z.string().default("1976"),
    story: z.array(z.string()).default([
      "One counter in Sadar Bazar, Gurgaon. Fifty years later the family runs four multi-brand boutiques across Delhi NCR, an authorized service centre, and a following of more than forty thousand people who come to us before they buy.",
      "The trade changed. The habit did not: know the movement, price it honestly, stand behind it afterwards.",
    ]),
    boutiques: z.string().default("04"),
    brands: z.string().default("20+"),
    advisor: z.string().default("1:1"),
    assurance: z.string().default("Warranty and after-sales handled in house"),
  }).prefault({}),

  footer: z.object({
    headline: z.string().default("Set your watch"),
    headlineAccent: z.string().default("with us"),
    note: z.string().default("All prices include GST"),
  }).prefault({}),
});
export type SiteCopy = z.infer<typeof SiteCopySchema>;

export const DEFAULT_COPY: SiteCopy = SiteCopySchema.parse({});

export async function getSiteCopy(): Promise<SiteCopy> {
  // The shop front has no disk, so it asks the back end — and falls back to the
  // written defaults rather than showing a page with no words on it.
  if (isRemote()) {
    try {
      return SiteCopySchema.parse((await remoteJson<unknown>("/api/public/copy")) ?? {});
    } catch {
      return DEFAULT_COPY;
    }
  }
  try {
    return SiteCopySchema.parse(JSON.parse(await fs.readFile(PATH, "utf8")));
  } catch {
    return DEFAULT_COPY;
  }
}

export async function saveSiteCopy(copy: SiteCopy): Promise<SiteCopy> {
  const parsed = SiteCopySchema.parse(copy);
  const temp = `${PATH}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  await fs.rename(temp, PATH);
  return parsed;
}
