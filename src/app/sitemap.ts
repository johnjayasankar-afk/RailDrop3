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
    /* /fares IS the product, and it was the one page not submitted — the
       sitemap offered the landing page, the methodology page, and /login,
       which was deleted with the accounts and 404s. */
    {
      url: `${origin}/fares`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${origin}/how-it-works`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
