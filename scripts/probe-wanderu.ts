import { WanderuBrowserProvider } from "../src/lib/providers/wanderu-browser-provider";

async function main() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.cwd()}/.playwright`;
  process.env.RAILDROP_LOCAL ??= "1";
  const provider = new WanderuBrowserProvider();
  const result = await provider.searchTrips({
    originCode: "BOS",
    destinationCode: "NYP",
    travelDate: process.argv[2] || "2026-09-18",
    passengers: { adultCount: 1 },
  });
  console.log(
    JSON.stringify(
      {
        status: result.status,
        journeys: result.journeys.length,
        error: result.providerError?.message ?? null,
        sample: result.journeys[0]
          ? {
              departureAt: result.journeys[0].departureAt,
              price: result.journeys[0].fares[0]?.observedPriceCents,
              train: result.journeys[0].trainNumber,
            }
          : null,
        latencyMs: result.metadata.latencyMs,
      },
      null,
      2,
    ),
  );
  if (result.status === "PROVIDER_ERROR") process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
