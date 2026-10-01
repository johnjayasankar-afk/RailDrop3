import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RailDrop",
    short_name: "RailDrop",
    description:
      "Listed Amtrak fares for your route, read from live inventory the moment you ask. No account, nothing saved, never an estimate.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f6f1",
    theme_color: "#f8f6f1",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
