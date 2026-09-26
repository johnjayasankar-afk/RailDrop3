"use client";

import { useState } from "react";

/* Alert settings for one watch.
 *
 * The five fields used to be useState in the page, re-seeded from props by an
 * effect after every save — which is the pattern React asks you not to write,
 * and which the compiler lint flagged. They are local here instead, and the
 * page gives this form a key built from the persisted values: when the server
 * round-trip brings new ones back, the key changes, the form remounts, and the
 * defaults are simply the new props. No effect, no suppression.
 */
export function WatchSettingsForm({
  alertEmail,
  minimumSavingsCents,
  includeRestrictedFares,
  includeThruway,
  preferredDepartureTime,
  busy,
  onInvalidEmail,
  onSave,
}: {
  alertEmail: string;
  minimumSavingsCents: number;
  includeRestrictedFares: boolean;
  includeThruway: boolean;
  preferredDepartureTime: string | null;
  busy: boolean;
  onInvalidEmail: (message: string) => void;
  onSave: (values: {
    alertEmail: string;
    minimumSavingsCents: number;
    includeRestrictedFares: boolean;
    includeThruway: boolean;
    preferredDepartureTime: string | null;
  }) => void;
}) {
  const [email, setEmail] = useState(alertEmail);
  const [threshold, setThreshold] = useState(String(Math.round(minimumSavingsCents / 100)));
  const [restricted, setRestricted] = useState(includeRestrictedFares);
  const [thruway, setThruway] = useState(includeThruway);
  const [preferred, setPreferred] = useState(preferredDepartureTime ?? "");

  return (
    <form
      className="panel mt-3 max-w-lg space-y-3 p-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedEmail = email.trim();
        if (!trimmedEmail || !trimmedEmail.includes("@")) {
          onInvalidEmail("Enter a valid alert email.");
          return;
        }
        const trimmedPreferred = preferred.trim();
        onSave({
          alertEmail: trimmedEmail,
          minimumSavingsCents: Math.round(Number(threshold) * 100),
          includeRestrictedFares: restricted,
          includeThruway: thruway,
          preferredDepartureTime: trimmedPreferred || null,
        });
      }}
    >
      <label className="block">
        Alert email
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="field"
        />
      </label>
      <label className="block">
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
      <label className="block">
        Preferred departure · optional
        <input
          type="time"
          value={preferred}
          onChange={(event) => setPreferred(event.target.value)}
          className="field"
        />
      </label>
      <label className="block">
        <input
          type="checkbox"
          checked={restricted}
          onChange={(event) => setRestricted(event.target.checked)}
        />{" "}
        Also include cheaper restricted fares
      </label>
      <label className="block">
        <input
          type="checkbox"
          checked={thruway}
          onChange={(event) => setThruway(event.target.checked)}
        />{" "}
        Include Amtrak Thruway / bus connections
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        Save settings
      </button>
      <p className="text-xs text-ink-soft">
        Restricted or Thruway changes apply on the next Check now.
      </p>
    </form>
  );
}
