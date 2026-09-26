"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  flattenRanked,
  groupRanked,
  moveSelection,
  rankCommands,
  type CommandSpec,
  type RankedCommand,
} from "@/lib/domain/command-palette";

/* Everything the board can do, in one list, with the keys next to it.
 *
 * The board has nineteen single-key shortcuts and `?` was the only way to find
 * out — a door with no handle. This is the handle, and it is meant to make
 * itself unnecessary: running a command from here says which key would have done
 * it, so the tenth time you reach for the palette you already know.
 *
 * Ranking and grouping are in src/lib/domain/command-palette.ts, tested without
 * a DOM. This file is the keyboard, the focus trap and the paint.
 */

export interface Command extends CommandSpec {
  run: () => void;
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  /* The selection carries the query it belongs to.
   *
   * A bare index would survive a keystroke that changed the list underneath it
   * and highlight whatever happened to land in that position. Pairing them
   * derives the reset instead of performing it — no effect, and no ref written
   * during render, which the React Compiler lint rightly refuses. */
  const [cursor, setCursor] = useState({ query: "", index: 0 });
  const selected = cursor.query === query ? cursor.index : 0;
  const setSelected = (next: number | ((index: number) => number)) => {
    setCursor((previous) => {
      const from = previous.query === query ? previous.index : 0;
      return { query, index: typeof next === "function" ? next(from) : next };
    });
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const ranked = useMemo(() => rankCommands(commands, query), [commands, query]);
  const sections = useMemo(() => groupRanked(ranked), [ranked]);
  /* The rendered order, which is grouped and therefore not the ranked order.
   * Arrow keys walk this, so the highlight is always on the row it looks like. */
  const flat = useMemo(() => flattenRanked(ranked), [ranked]);
  const active = flat[Math.min(selected, Math.max(0, flat.length - 1))];

  useEffect(() => {
    inputRef.current?.focus();
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (!active) return;
    listRef.current
      ?.querySelector(`[data-command="${CSS.escape(active.spec.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function run(command: RankedCommand | undefined) {
    if (!command) return;
    if (command.spec.unavailable) return;
    // Closed first: several of these move focus or scroll, and doing that behind
    // an open dialog leaves the reader somewhere they did not ask to be.
    onClose();
    (command.spec as Command).run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setSelected((index) => moveSelection(flat.length, index, 1));
      return;
    }
    if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setSelected((index) => moveSelection(flat.length, index, -1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setSelected(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setSelected(Math.max(0, flat.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      run(active);
    }
  }

  return (
    <div
      className="palette-scrim no-print"
      role="presentation"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Board commands"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="palette-field">
          <span className="palette-prompt" aria-hidden>
            &gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Search the board · copy, sort, jump, pin"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={active ? `palette-${active.spec.id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="palette-esc">Esc</kbd>
        </div>

        <div id="palette-list" ref={listRef} className="palette-list" role="listbox">
          {flat.length === 0 ? (
            <p className="palette-empty">
              Nothing matches “{query.trim()}”. Every command is listed with an empty box.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.group} role="group" aria-labelledby={`palette-g-${section.group}`}>
                <p id={`palette-g-${section.group}`} className="palette-group">
                  {section.group}
                </p>
                {section.commands.map((command) => {
                  const isActive = active?.spec.id === command.spec.id;
                  return (
                    <div
                      key={command.spec.id}
                      id={`palette-${command.spec.id}`}
                      data-command={command.spec.id}
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={command.spec.unavailable ? true : undefined}
                      className={`palette-row${isActive ? " is-active" : ""}${
                        command.spec.unavailable ? " is-off" : ""
                      }`}
                      onMouseMove={() => {
                        const index = flat.findIndex((item) => item.spec.id === command.spec.id);
                        if (index >= 0 && index !== selected) setSelected(index);
                      }}
                      onClick={() => run(command)}
                    >
                      <span className="palette-label">
                        <Highlighted text={command.spec.label} at={command.positions} />
                        {command.spec.unavailable ? (
                          <span className="palette-why"> · {command.spec.unavailable}</span>
                        ) : null}
                      </span>
                      {command.spec.shortcut ? (
                        <kbd className="palette-key">{command.spec.shortcut}</kbd>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <p className="palette-foot">
          <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>↵</kbd> run · a key next to a command does the same
          thing without opening this.
        </p>
      </div>
    </div>
  );
}

/** The matched characters, marked. Nothing is marked when the match was on a keyword. */
function Highlighted({ text, at }: { text: string; at: readonly number[] }) {
  if (at.length === 0) return <>{text}</>;
  const marked = new Set(at);
  const out: React.ReactNode[] = [];
  let run = "";
  let runMarked = false;
  const flush = (key: number) => {
    if (!run) return;
    out.push(
      runMarked ? (
        <mark key={key} className="palette-hit">
          {run}
        </mark>
      ) : (
        <span key={key}>{run}</span>
      ),
    );
    run = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const isMarked = marked.has(index);
    if (isMarked !== runMarked) {
      flush(index);
      runMarked = isMarked;
    }
    run += text[index];
  }
  flush(text.length);
  return <>{out}</>;
}
