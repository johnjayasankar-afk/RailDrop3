"use client";

import Link from "next/link";
import type { EmptyBoard } from "@/lib/domain/board-empty";

/* The empty board, as a designed state rather than a sentence.
 *
 * Six different facts used to share one line of grey text. The one that matters
 * most is the one that was most wrong: a corridor we could not read rendered
 * identically to a corridor with nothing cheaper, which is the difference
 * between "the market has nothing for you" and "we failed". Only one of those
 * is ours to say, and the board was saying the other.
 *
 * Drawn in the departure-board idiom: the flaps mid-fold, a stamp across them.
 * A board with no departures is a real thing in a real station and it looks
 * like something. It should look like something here.
 */
export function BoardEmpty({
  state,
  onClearFilters,
  onRecheck,
  onResume,
  busy,
}: {
  state: EmptyBoard;
  onClearFilters: () => void;
  onRecheck: () => void;
  onResume: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={`board-empty${state.ourFault ? " is-fault" : ""}${state.reason === "scanning" ? " is-scanning" : ""}`}
      role="status"
    >
      {/* Flaps caught mid-fold. Three, because a row of them reads as a board
          and one reads as a mistake. */}
      <div className="board-empty-flaps" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <p className="board-empty-stamp">{state.title}</p>
      <p className="board-empty-body">{state.body}</p>
      {state.action ? (
        <div className="board-empty-action">
          {state.action === "clear-filters" ? (
            <button type="button" className="btn btn-ghost" onClick={onClearFilters}>
              Clear filters
            </button>
          ) : null}
          {state.action === "recheck" ? (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onRecheck}>
              Check again now
            </button>
          ) : null}
          {state.action === "resume" ? (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onResume}>
              Resume watching
            </button>
          ) : null}
          {state.action === "new-watch" ? (
            <Link className="btn btn-ghost" href="/watches/new">
              Watch another trip
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
