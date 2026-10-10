/**
 * The banners that drift across the front page, under the houses.
 *
 * Not the same thing as a brand's banner, which belongs to that brand's page
 * and is set from its own desk. These are the shop's own: a Diwali scheme, a
 * new arrival, the workshop. One list, in the order the shop puts them in.
 *
 * Stored on the back end's disk beside the repair tickets, so adding one is a
 * thing the shop does on a Tuesday rather than a deploy. Each image is written
 * once with a hash in its name, which means a replacement never serves from a
 * stale cache.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dataRoot } from "@/agent/config";
import { isRemote, remoteJson, mediaUrl } from "./remote";

export const BannerSchema = z.object({
  id: z.string(),
  /** Where the file sits under /media. */
  image: z.string(),
  /** What the picture shows, for anyone who cannot see it. */
  alt: z.string().default(""),
  /** Optional words over the picture. Empty means the picture speaks alone. */
  heading: z.string().default(""),
  caption: z.string().default(""),
  /** Where it sends people. Empty means it is not a link. */
  href: z.string().default(""),
  /** Lower drifts past first. */
  order: z.number().int().default(0),
  /** Off keeps it here without showing it — next Diwali edits last Diwali. */
  live: z.boolean().default(true),
  createdAt: z.string(),
});
export type Banner = z.infer<typeof BannerSchema>;

const FILE = () => join(dataRoot(), "banners.json");

/** Every banner the shop has written, live or not. Admin only. */
export async function listBanners(): Promise<Banner[]> {
  try {
    const raw = isRemote()
      ? await remoteJson<unknown>("/api/public/banners")
      : JSON.parse(await fs.readFile(FILE(), "utf8"));
    const parsed = z.array(BannerSchema).safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  } catch {
    // No file yet. A shop that has written no banners simply has none.
    return [];
  }
}

/** The ones the front page shows, with their images made absolute if remote. */
export async function liveBanners(): Promise<Banner[]> {
  return (await listBanners())
    .filter((banner) => banner.live && banner.image)
    .map((banner) => ({ ...banner, image: mediaUrl(banner.image) }));
}

export async function saveBanner(input: {
  id?: string;
  image?: string;
  alt?: string;
  heading?: string;
  caption?: string;
  href?: string;
  order?: number;
  live?: boolean;
}): Promise<Banner> {
  const all = await listBanners();
  const index = input.id ? all.findIndex((banner) => banner.id === input.id) : -1;

  const merged: Banner = BannerSchema.parse({
    ...(index >= 0 ? all[index] : { id: randomUUID(), createdAt: new Date().toISOString(), image: "" }),
    ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
  });

  if (index >= 0) all[index] = merged;
  else all.push(merged);

  await write(all);
  return merged;
}

export async function deleteBanner(id: string): Promise<void> {
  const all = await listBanners();
  const going = all.find((banner) => banner.id === id);
  await write(all.filter((banner) => banner.id !== id));

  // Take the picture with it: these are large, and nothing else points at it.
  if (going?.image?.startsWith("/media/_banners/")) {
    const file = join(dataRoot(), going.image.replace(/^\/media\//, "media/"));
    await fs.rm(file, { force: true });
  }
}

async function write(banners: Banner[]): Promise<void> {
  const path = FILE();
  if (!existsSync(dataRoot())) await fs.mkdir(dataRoot(), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(banners, null, 2)}\n`, "utf8");
  await fs.rename(temporary, path);
}
