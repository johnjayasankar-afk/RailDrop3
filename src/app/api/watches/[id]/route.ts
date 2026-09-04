import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/services";
import { z } from "zod";

const patchSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "COMPLETED"]).optional(),
  monitorPreset: z.enum(["24h", "48h", "72h", "until_departure", "custom"]).optional(),
  monitorEndAt: z.string().datetime().nullable().optional(),
  monitorStartAt: z.string().datetime().optional(),
  alertEmail: z.preprocess(
    (value) =>
      value === null || (typeof value === "string" && value.trim() === "") ? "" : value,
    z.union([z.string().email(), z.literal("")]).optional(),
  ),
  minimumSavingsCents: z.number().int().min(100).max(100_000).optional(),
  includeRestrictedFares: z.boolean().optional(),
  includeThruway: z.boolean().optional(),
  preferredDepartureTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
});

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const repo = getRepository();
  const watch = await repo.getWatch(id);
  if (!watch || watch.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [cycles, journeys, events, snapshots] = await Promise.all([
    repo.listCyclesForWatch(id),
    watch.lastCheckCycleId
      ? repo.listJourneysForCycle(watch.lastCheckCycleId)
      : Promise.resolve([]),
    repo.listPriceEvents(id),
    watch.lastCheckCycleId ? repo.listDateSnapshots(watch.lastCheckCycleId) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    watch,
    cycles,
    journeys: journeys.map((item) => item.option),
    events,
    snapshots,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const repo = getRepository();
  const watch = await repo.getWatch(id);
  if (!watch || watch.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const patch = patchSchema.parse(await request.json());
  const updated = await repo.updateWatch(id, patch);
  return NextResponse.json({ watch: updated });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  await getRepository().deleteWatch(id, user.id);
  return NextResponse.json({ ok: true });
}
