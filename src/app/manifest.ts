import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RailDrop",
    short_name: "RailDrop",
    description:
      "Know when your train gets cheaper. Live Amtrak fare watch for trips you already booked.",
    start_url: "/",
    display: "standalone",
    background_color: "#efe8d9",
    theme_color: "#efe8d9",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
