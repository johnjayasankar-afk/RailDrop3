"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/* Asking about your own trip.
 *
 * The answer is not streamed, and the interface is built around that rather
 * than apologising for it: every price is checked against what the board
 * actually observed before any of it is shown, and that check needs a finished
 * answer. So the wait is honest — it says what is happening — instead of
 * dribbling out tokens that might contain a number we are about to withdraw.
 *
 * A blocked answer is drawn differently on purpose. It is not an error and not
 * a normal reply; it is the moment the product's one rule was enforced against
 * its own assistant, and hiding that would be the wrong way round.
 */

type Turn = { role: "user" | "assistant"; content: string; blocked?: boolean };

const TRIP_SUGGESTIONS = [
  "Should I switch, or wait?",
  "Is this a good price for this route?",
  "What is the cheapest day in my window?",
  "Why has nothing been found yet?",
];

/* Across the dashboard the useful questions are comparisons, which is exactly
   what the trip-scoped version cannot answer. */
const ALL_TRIPS_SUGGESTIONS = [
  "Which of my trips has the best saving right now?",
  "Is anything worth acting on today?",
  "Which trip has moved the most since I added it?",
  "Are any of my trips not finding fares?",
];

export function AssistantPanel({ watchId }: { watchId?: string }) {
  const suggestions = watchId ? TRIP_SUGGESTIONS : ALL_TRIPS_SUGGESTIONS;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (turns.length > 0) threadEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length < 2 || asking) return;
      setError(null);
      setQuestion("");
      /* The history sent is the thread before this question, capped. The server
         caps it too — this is for the payload, not for trust. */
      const history = turns.slice(-4).map((turn) => ({ role: turn.role, content: turn.content }));
      setTurns((previous) => [...previous, { role: "user", content: trimmed }]);
      setAsking(true);
      try {
        const response = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Omitted entirely for a dashboard question: the route branches on
          // its absence rather than on a magic value.
          body: JSON.stringify({ ...(watchId ? { watchId } : {}), question: trimmed, history }),
        });
        const json = (await response.json()) as {
          answer?: string;
          blocked?: boolean;
          error?: string;
        };
        if (!response.ok) {
          setError(json.error ?? "The assistant could not answer just now.");
          return;
        }
        setTurns((previous) => [
          ...previous,
          { role: "assistant", content: json.answer ?? "", blocked: Boolean(json.blocked) },
        ]);
      } catch {
        setError("Could not reach the assistant. Your connection, or ours.");
      } finally {
        setAsking(false);
      }
    },
    [asking, turns, watchId],
  );

  return (
    <section className="assistant" aria-labelledby={`${inputId}-title`}>
      <header className="assistant-head">
        <span className="assistant-dot" aria-hidden />
        <h2 id={`${inputId}-title`} className="assistant-title">
          {watchId ? "Ask about this trip" : "Ask about your trips"}
        </h2>
        <span className="assistant-note">
          {watchId
            ? "Answers come only from the board above"
            : "Answers come only from your boards"}
        </span>
      </header>

      {turns.length === 0 ? (
        <ul className="assistant-suggests">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button type="button" className="assistant-chip" onClick={() => void ask(suggestion)}>
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ol className="assistant-thread">
          {turns.map((turn, index) => (
            <li
              key={`${turn.role}-${index}`}
              className={`assistant-turn is-${turn.role}${turn.blocked ? " is-blocked" : ""}`}
            >
              {turn.blocked ? (
                <p className="assistant-blocked-tag">Withheld · unverified price</p>
              ) : null}
              <p>{turn.content}</p>
            </li>
          ))}
          <div ref={threadEnd} />
        </ol>
      )}

      {/* Polite, not assertive: an answer arriving should not interrupt someone
          reading the board. */}
      <p className="assistant-status" role="status" aria-live="polite">
        {asking ? "Reading the board and checking every price…" : ""}
      </p>

      {error ? (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="assistant-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          {watchId ? "Ask about this trip" : "Ask about your trips"}
        </label>
        <input
          id={inputId}
          className="assistant-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={watchId ? "Should I switch, or wait?" : "Which trip should I act on?"}
          autoComplete="off"
          disabled={asking}
          maxLength={500}
        />
        <button
          type="submit"
          className="assistant-send"
          disabled={asking || question.trim().length < 2}
        >
          {asking ? "Asking" : "Ask"}
        </button>
      </form>
    </section>
  );
}
