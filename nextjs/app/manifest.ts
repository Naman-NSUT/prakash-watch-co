import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Prakash Watch Co.",
    short_name: "Prakash",
    description: "Fine watches, authorised retail and in-house service across Delhi NCR since 1976.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1ece2",
    theme_color: "#f1ece2",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
