import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = appOrigin();
  return [
    {
      url: origin,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${origin}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
