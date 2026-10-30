import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/api/", "/login"],
    },
    sitemap: "https://www.prakashwatchco.in/sitemap.xml",
    host: "https://www.prakashwatchco.in",
  };
}
