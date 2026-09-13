import { getConfig } from "@/lib/config";

export function LocalModeBanner() {
  const config = getConfig();
  if (!config.isLocal) return null;
  return (
    <div className="bg-ink px-4 py-2 text-center text-[11px] uppercase tracking-[0.16em] text-paper-elevated">
      Local board · live Amtrak fares via Wanderu · not for Vercel
    </div>
  );
}
