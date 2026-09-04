import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/services";
import { rebookSchema } from "@/lib/validation/watch";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const repo = getRepository();
  const watch = await repo.getWatch(id);
  if (!watch || watch.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = rebookSchema.parse(await request.json());
  await repo.insertPriceEvent({
    id: crypto.randomUUID(),
    watchId: watch.id,
    previousPriceCents: watch.currentBookedPriceCents,
    newPriceCents: body.newBookedPriceCents,
    previousTravelDate: watch.desiredTravelDate,
    newTravelDate: body.updateDesiredDate
      ? (body.newDesiredTravelDate ?? watch.desiredTravelDate)
      : watch.desiredTravelDate,
    note: "User rebooked",
    createdAt: new Date().toISOString(),
  });
  const updated = await repo.updateWatch(watch.id, {
    currentBookedPriceCents: body.newBookedPriceCents,
    ...(body.updateDesiredDate && body.newDesiredTravelDate
      ? { desiredTravelDate: body.newDesiredTravelDate }
      : {}),
    bookedTrainNumber: body.newTrainNumber ?? watch.bookedTrainNumber,
    bookedDepartureAt: body.newDepartureAt ?? watch.bookedDepartureAt,
    bookedFareFamily: body.newFareFamily ?? watch.bookedFareFamily,
    lastOpportunity: null,
  });
  return NextResponse.json({ watch: updated });
}
