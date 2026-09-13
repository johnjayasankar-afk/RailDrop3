import type { MetadataRoute } from "next";

const site = (process.env.NEXT_PUBLIC_APP_URL || "https://rail-drop3.vercel.app").replace(
  /\/$/,
  "",
);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/watches", "/settings", "/api/"],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
