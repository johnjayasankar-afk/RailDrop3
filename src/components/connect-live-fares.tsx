"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function ConnectLiveFares({ live }: { live: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(
    live ? "Live Parse fares are connected." : null,
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/local/parse-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const json = (await response.json()) as {
        ok?: boolean;
        error?: string;
        travelDate?: string;
        journeyCount?: number;
        sample?: { serviceName: string | null; priceCents: number | null };
      };
      if (!response.ok || !json.ok) {
        throw new Error(json.error ?? "Could not verify Parse");
      }
      const price =
        json.sample?.priceCents != null
          ? `$${(json.sample.priceCents / 100).toFixed(0)}`
          : "a fare";
      setMessage(
        `Live search worked. ${json.journeyCount ?? 0} BOS → NYP options on ${json.travelDate}, including ${json.sample?.serviceName ?? "Amtrak"} from ${price}. New watches will use live prices.`,
      );
      setKey("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify Parse");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ticket mt-8 p-5 text-sm">
      <h2 className="text-xs uppercase tracking-[0.16em] text-ink-soft">Live Amtrak fares</h2>
      <p className="mt-3 text-ink-soft">
        Local searches already use live Amtrak fares from Wanderu on this machine. A Parse key is
        optional here — it is required for production on Vercel.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink-soft">
        <li>Stay signed in on parse.bot.</li>
        <li>
          Leave the playground and open{" "}
          <a
            className="underline"
            href="https://parse.bot/settings"
            target="_blank"
            rel="noreferrer"
          >
            Settings → API Keys
          </a>
          .
        </li>
        <li>
          Create a key named RailDrop. Copy the value that starts with pmx_ (shown only once).
        </li>
        <li>Paste it here. RailDrop will run one live BOS → NYP search_trains call to prove it.</li>
      </ol>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <label className="block">
          PARSE_API_KEY
          <input
            required
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className="field"
            placeholder="pmx_…"
          />
        </label>
        <button disabled={busy} className="btn btn-primary">
          {busy ? "Checking live fares…" : "Connect and verify live prices"}
        </button>
      </form>
      {message ? <p className="mt-3">{message}</p> : null}
    </section>
  );
}
