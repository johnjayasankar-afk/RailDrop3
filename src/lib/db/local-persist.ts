import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { JourneyOption } from "@/lib/domain/types";
import { MemoryRepository } from "./memory-store";
import { logger } from "@/lib/logger";

const WRITE_METHODS = [
  "upsertProfile",
  "createWatch",
  "updateWatch",
  "deleteWatch",
  "insertCycle",
  "updateCycle",
  "claimScheduledRun",
  "insertProviderRequest",
  "insertDateSnapshot",
  "insertJourneys",
  "cacheJourneys",
  "insertAlert",
  "insertNotification",
  "insertPriceEvent",
  "incrementUsage",
  "upsertStations",
] as const;

const FLUSH_NOW = new Set(["createWatch", "updateWatch", "deleteWatch"]);

type Snapshot = {
  profiles: unknown[];
  watches: unknown[];
  cycles: unknown[];
  scheduled: unknown[];
  providerRequests: unknown[];
  snapshots: unknown[];
  journeys: unknown[];
  cachedJourneys: Array<[string, JourneyOption[]]>;
  alerts: unknown[];
  notifications: unknown[];
  priceEvents: unknown[];
  usage: unknown[];
};

type AnyWriter = (...args: unknown[]) => Promise<unknown>;

const persistHooks = globalThis as unknown as { __raildropPersistHook?: boolean };

export function createPersistedMemoryRepository(filePath: string): MemoryRepository {
  const repo = new MemoryRepository();
  hydrate(repo, filePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    try {
      flush(repo, filePath);
    } catch (error) {
      logger.error("local.store.flush_failed", {
        filePath,
        message: error instanceof Error ? error.message : "flush failed",
      });
    }
  };
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, 80);
  };
  if (!persistHooks.__raildropPersistHook) {
    persistHooks.__raildropPersistHook = true;
    process.on("beforeExit", write);
  }
  const writers = repo as unknown as Record<string, AnyWriter>;
  for (const name of WRITE_METHODS) {
    const original = writers[name];
    if (typeof original !== "function") continue;
    writers[name] = async (...args: unknown[]) => {
      const result = await original.apply(repo, args);
      if (FLUSH_NOW.has(name)) write();
      else persist();
      return result;
    };
  }
  logger.info("local.store.ready", { filePath, watches: repo.watches.size });
  return repo;
}

function hydrate(repo: MemoryRepository, filePath: string): void {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as Snapshot;
    for (const profile of data.profiles ?? []) {
      const item = profile as { id: string };
      repo.profiles.set(item.id, item as never);
    }
    for (const watch of data.watches ?? []) {
      const item = watch as { id: string };
      repo.watches.set(item.id, item as never);
    }
    for (const cycle of data.cycles ?? []) {
      const item = cycle as { id: string };
      repo.cycles.set(item.id, item as never);
    }
    for (const run of data.scheduled ?? []) {
      const item = run as { watchId: string; localCheckDate: string; checkSlot: string };
      repo.scheduled.set(`${item.watchId}:${item.localCheckDate}:${item.checkSlot}`, item as never);
    }
    for (const request of data.providerRequests ?? []) {
      const item = request as { id: string };
      repo.providerRequests.set(item.id, item as never);
    }
    for (const snapshot of data.snapshots ?? []) {
      const item = snapshot as { id: string };
      repo.snapshots.set(item.id, item as never);
    }
    repo.journeys = (data.journeys as typeof repo.journeys) ?? [];
    repo.cachedJourneys = new Map(data.cachedJourneys ?? []);
    repo.alerts = (data.alerts as typeof repo.alerts) ?? [];
    repo.notifications = (data.notifications as typeof repo.notifications) ?? [];
    repo.priceEvents = (data.priceEvents as typeof repo.priceEvents) ?? [];
    for (const row of data.usage ?? []) {
      const item = row as { day: string };
      repo.usage.set(item.day, item as never);
    }
    logger.info("local.store.hydrated", {
      watches: repo.watches.size,
      cycles: repo.cycles.size,
    });
  } catch {
    // First local run, or the snapshot is missing.
  }
}

function flush(repo: MemoryRepository, filePath: string): void {
  const snapshot: Snapshot = {
    profiles: [...repo.profiles.values()],
    watches: [...repo.watches.values()],
    cycles: [...repo.cycles.values()],
    scheduled: [...repo.scheduled.values()],
    providerRequests: [...repo.providerRequests.values()],
    snapshots: [...repo.snapshots.values()],
    journeys: repo.journeys,
    cachedJourneys: [...repo.cachedJourneys.entries()],
    alerts: repo.alerts,
    notifications: repo.notifications,
    priceEvents: repo.priceEvents,
    usage: [...repo.usage.values()],
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot), "utf8");
  renameSync(tmp, filePath);
  logger.info("local.store.flushed", { filePath, watches: repo.watches.size });
}
