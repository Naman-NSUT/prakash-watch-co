import type { MetadataRoute } from "next";
import { getCatalogIndex, PUBLISHED_STATUS } from "@/lib/catalog";
import { brandSlug } from "@/lib/brands";

export const revalidate = 300;

const ORIGIN = "https://www.prakashwatchco.in";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalogue = (await getCatalogIndex()).filter((entry) => entry.status === PUBLISHED_STATUS);
  const brands = [...new Set(catalogue.map((entry) => brandSlug(entry.brand)))].sort();

  return [
    { url: ORIGIN, changeFrequency: "daily", priority: 1 },
    { url: `${ORIGIN}/collections`, changeFrequency: "daily", priority: 0.9 },
    { url: `${ORIGIN}/brands`, changeFrequency: "daily", priority: 0.8 },
    { url: `${ORIGIN}/watch-finder`, changeFrequency: "daily", priority: 0.8 },
    { url: `${ORIGIN}/offers`, changeFrequency: "daily", priority: 0.7 },
    { url: `${ORIGIN}/service`, changeFrequency: "monthly", priority: 0.8 },
    ...brands.map((slug) => ({
      url: `${ORIGIN}/brands/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...catalogue.map((entry) => ({
      url: `${ORIGIN}/watch/${entry.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
