"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { StationField } from "@/components/station-field";
import { SearchingOverlay } from "@/components/searching-overlay";
import { formatDisplayDate } from "@/lib/domain/calendar";
import { stationLabel } from "@/lib/stations/catalog";
import type { WatchFormInitial } from "@/lib/domain/watch-query";
import { RouteRibbon } from "@/components/route-ribbon";
import { Flap } from "@/components/flap";
import { changeRuleNote } from "@/lib/domain/board-moves";

const LAST_ROUTE = "raildrop.lastRoute";

function clientLocalIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function NewWatchForm({
  email,
  isGuest = false,
  initial,
}: {
  email: string;
  isGuest?: boolean;
  initial?: WatchFormInitial;
}) {
  const router = useRouter();
  const today = useMemo(() => clientLocalIsoDate(), []);
  const defaultDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return clientLocalIsoDate(date);
  }, []);
  const [origin, setOrigin] = useState(initial?.origin ?? "BOS");
  const [destination, setDestination] = useState(initial?.destination ?? "NYP");
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [flexibility, setFlexibility] = useState(1);
  const [preferredTime, setPreferredTime] = useState("");
  const [price, setPrice] = useState(initial?.price ?? "");
  const [bookedTrain, setBookedTrain] = useState("");
  const [fareFamily, setFareFamily] = useState<"FLEXIBLE" | "VALUE" | "SAVER">("FLEXIBLE");
  const [passengers, setPassengers] = useState(1);
  const [restricted, setRestricted] = useState(false);
  const [includeThruway, setIncludeThruway] = useState(false);
  const [monitor, setMonitor] = useState("48h");
  const [threshold, setThreshold] = useState("1");
  const [alertEmail, setAlertEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const [lastRoute, setLastRoute] = useState<{ origin: string; destination: string } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_ROUTE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { origin?: string; destination?: string };
      if (parsed.origin && parsed.destination) {
        // Hydrate the chip only — never auto-apply, or e2e station fields race.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage chip, not form fields
        setLastRoute({ origin: parsed.origin, destination: parsed.destination });
      }
    } catch {
      // Ignore a corrupt local cache.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LAST_ROUTE, JSON.stringify({ origin, destination }));
  }, [origin, destination]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const paid = Number(price);
    if (!Number.isFinite(paid) || paid <= 0) {
      setError("Enter the actual total you paid.");
      return;
    }
    if (origin === destination) {
      setError("Origin and destination must differ.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setElapsed(0);
    setError(null);
    try {
      const response = await fetch("/api/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          originCode: origin,
          destinationCode: destination,
          desiredTravelDate: date,
          dateFlexibilityDays: flexibility,
          preferredDepartureTime: preferredTime || null,
          passengerCount: passengers,
          currentBookedPriceCents: Math.round(paid * 100),
          bookedTrainNumber: bookedTrain.trim() || null,
          bookedFareFamily: fareFamily,
          includeRestrictedFares: restricted,
          includeThruway,
          monitorPreset: monitor,
          minimumSavingsCents: Math.round(Number(threshold) * 100),
          alertEmail: alertEmail || null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Could not create watch");
      router.push(`/watches/${json.watch.id}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Scan dismissed — create again when you are ready.");
        setBusy(false);
        return;
      }
      setError(err instanceof Error ? err.message : "Could not create watch");
      setBusy(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function cancelScan() {
    abortRef.current?.abort();
    setBusy(false);
    setElapsed(0);
  }

  return (
    <PageFrame email={email} isGuest={isGuest}>
      {busy ? (
        <SearchingOverlay
          origin={origin}
          destination={destination}
          date={date}
          elapsedSeconds={elapsed}
          flexibility={flexibility}
          mode="create"
          onCancel={cancelScan}
        />
      ) : null}
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        <p className="kicker">New watch</p>
        <h1 className="serif mt-2 text-4xl">Watch a trip</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Live Amtrak inventory across your date window. Stay while the board loads.
        </p>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_16rem]">
          <form onSubmit={onSubmit} className="space-y-8">
            <section className="panel space-y-4 p-5">
              <h2 className="text-xs uppercase tracking-[0.16em] text-ink-soft">Journey</h2>
              <StationField label="Origin station" value={origin} onChange={setOrigin} />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn btn-ghost text-xs uppercase tracking-[0.14em]"
                  onClick={() => {
                    setOrigin(destination);
                    setDestination(origin);
                  }}
                >
                  Swap stations
                </button>
                {lastRoute &&
                (lastRoute.origin !== origin || lastRoute.destination !== destination) ? (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setOrigin(lastRoute.origin);
                      setDestination(lastRoute.destination);
                    }}
                  >
                    Last {lastRoute.origin} → {lastRoute.destination}
                  </button>
                ) : null}
              </div>
              <StationField
                label="Destination station"
                value={destination}
                onChange={setDestination}
              />
              <label className="block text-sm">
                Desired travel date
                <input
                  type="date"
                  required
                  min={today}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="field"
                />
              </label>
              <fieldset className="text-sm">
                <legend className="mb-2">Date flexibility</legend>
                {[
                  [0, "Exact date"],
                  [1, "±1 day · recommended"],
                  [2, "±2 days"],
                ].map(([value, label]) => (
                  <label
                    key={String(value)}
                    className={`choice ${flexibility === value ? "choice-on" : ""}`}
                  >
                    <input
                      type="radio"
                      name="flex"
                      checked={flexibility === value}
                      onChange={() => setFlexibility(Number(value))}
                    />{" "}
                    {label}
                  </label>
                ))}
              </fieldset>
              <label className="block text-sm">
                Preferred departure time · optional
                <input
                  type="time"
                  value={preferredTime}
                  onChange={(event) => setPreferredTime(event.target.value)}
                  className="field"
                />
              </label>
            </section>
            <section className="panel space-y-4 p-5">
              <h2 className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Current reservation
              </h2>
              <label className="block text-sm">
                Actual total paid
                <div className="money-field">
                  <span className="money-affix" aria-hidden>
                    $
                  </span>
                  <input
                    required
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value.replace(/[^0-9.]/g, ""))}
                    className="field"
                    placeholder="128.00"
                    aria-label="Actual total paid in dollars"
                  />
                </div>
              </label>
              <label className="block text-sm">
                Train you already booked · optional
                <input
                  value={bookedTrain}
                  onChange={(event) => setBookedTrain(event.target.value)}
                  className="field"
                  placeholder="93 or Acela 2155"
                  maxLength={16}
                />
              </label>
              <fieldset className="text-sm">
                <legend className="mb-2">Fare you actually bought</legend>
                {(
                  [
                    ["FLEXIBLE", "Flexible"],
                    ["VALUE", "Value"],
                    ["SAVER", "Saver"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`choice ${fareFamily === value ? "choice-on" : ""}`}
                  >
                    <input
                      type="radio"
                      name="fareFamily"
                      checked={fareFamily === value}
                      onChange={() => setFareFamily(value)}
                    />{" "}
                    {label}
                  </label>
                ))}
                <p className="mt-2 text-xs text-ink-soft">{changeRuleNote(fareFamily)}</p>
              </fieldset>
              <label className="block text-sm">
                Passengers
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={passengers}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) {
                      setPassengers(1);
                      return;
                    }
                    setPassengers(Math.min(8, Math.max(1, Math.round(next))));
                  }}
                  className="field"
                />
              </label>
            </section>
            <section className="panel space-y-4 p-5">
              <h2 className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Compare & monitor
              </h2>
              <label className={`choice ${restricted ? "choice-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={restricted}
                  onChange={(event) => setRestricted(event.target.checked)}
                />{" "}
                Also include cheaper restricted fares
              </label>
              <label className={`choice ${includeThruway ? "choice-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={includeThruway}
                  onChange={(event) => setIncludeThruway(event.target.checked)}
                />{" "}
                Include Amtrak Thruway / bus connections
              </label>
              <label className="block text-sm">
                Monitor for
                <select
                  value={monitor}
                  onChange={(event) => setMonitor(event.target.value)}
                  className="field"
                >
                  <option value="24h">24 hours</option>
                  <option value="48h">48 hours</option>
                  <option value="72h">72 hours</option>
                  <option value="until_departure">Until departure</option>
                </select>
              </label>
              <label className="block text-sm">
                Alert when savings are at least
                <select
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                  className="field"
                >
                  <option value="1">$1</option>
                  <option value="5">$5</option>
                  <option value="10">$10</option>
                  <option value="20">$20</option>
                </select>
              </label>
              <label className="block text-sm">
                Alert email · optional
                <input
                  type="email"
                  value={alertEmail}
                  onChange={(event) => setAlertEmail(event.target.value)}
                  className="field"
                  placeholder={email || "you@email.com"}
                />
              </label>
              <p className="text-xs text-ink-soft">
                {isGuest
                  ? "Leave blank to watch prices on this device only. Add an email if you want fare-drop alerts."
                  : "Leave blank to skip email alerts. We’ll use this address when a listed fare drops."}
              </p>
            </section>
            {error ? (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <button disabled={busy} className="btn btn-primary w-full py-3">
              {busy ? "Checking your window…" : "Start watching"}
            </button>
          </form>
          <aside className="h-fit lg:sticky lg:top-20">
            <div className="depart-strip">
              <Flap>{origin}</Flap>
              <span className="text-[10px] uppercase tracking-[0.18em] opacity-70">to</span>
              <Flap>{destination}</Flap>
            </div>
            <div className="ticket p-5 text-sm">
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">This search</p>
              <div className="mt-4">
                <RouteRibbon origin={origin} destination={destination} compact />
              </div>
              <p className="mt-1 text-sm text-ink">
                {stationLabel(origin)} to {stationLabel(destination)}
              </p>
              <p className="mt-3">
                <Flap>{formatDisplayDate(date)}</Flap>
                {flexibility ? ` ±${flexibility}` : " · exact date"}
              </p>
              {preferredTime ? (
                <p className="mt-1 text-xs text-ink-soft">Preferred {preferredTime}</p>
              ) : null}
              {bookedTrain.trim() ? (
                <p className="mt-1 text-xs text-ink-soft">Watching train {bookedTrain.trim()}</p>
              ) : null}
              <p className="mt-1 text-sm">
                {passengers} passenger{passengers === 1 ? "" : "s"} · {fareFamily.toLowerCase()}
              </p>
              <p className="price serif mt-4 text-3xl">
                {price ? <Flap>{`$${price}`}</Flap> : <span className="opacity-50">—</span>}
              </p>
              <p className="mt-2 text-xs text-ink-soft">
                {price
                  ? "Your booking · confirm on Amtrak later"
                  : "Enter what you paid · confirm on Amtrak later"}
              </p>
              {initial?.origin && initial?.destination ? (
                <p className="mt-3 text-xs text-ink-soft">Return trip prefilled.</p>
              ) : null}
            </div>
          </aside>
        </div>
      </main>
    </PageFrame>
  );
}
