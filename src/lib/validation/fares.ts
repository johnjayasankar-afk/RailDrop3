import { z } from "zod";

/* What the app accepts from a stranger.
 *
 * This file was validation/watch.ts and carried createWatchSchema and
 * rebookSchema — alertEmail, monitorPreset, minimumSavingsCents,
 * currentBookedPriceCents — for a feature that was deleted. The only two
 * schemas the product still uses were living inside it.
 */

export const stationQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
});

/* A fare lookup that saves nothing.
 *
 * Every field is validated rather than coerced: these values arrive in a
 * POST body from anywhere and are used to drive a real browser at a real
 * provider.
 */
export const previewFaresSchema = z.object({
  originCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3}$/, "Origin must be a 3-character station code"),
  destinationCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3}$/, "Destination must be a 3-character station code"),
  desiredTravelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  dateFlexibilityDays: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
  passengerCount: z.number().int().min(1).max(8).default(1),
  includeRestrictedFares: z.boolean().default(false),
  includeThruway: z.boolean().default(false),
  timezone: z.string().default("America/New_York"),
});

export type PreviewFaresInput = z.infer<typeof previewFaresSchema>;
