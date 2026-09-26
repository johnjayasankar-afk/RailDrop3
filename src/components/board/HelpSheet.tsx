"use client";

/* The shortcut sheet. Opened by ? or the Shortcuts button, closed by either,
 * by Escape, or by clicking the backdrop. Focus moves to the close button on
 * open and is restored on close by the caller. */
export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="help-sheet no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      onClick={onClose}
    >
      <div className="help-card" onClick={(event) => event.stopPropagation()}>
        <p id="help-title" className="text-[10px] uppercase tracking-[0.18em] text-gold">
          Board shortcuts
        </p>
        <ul className="help-grid mt-4 text-sm">
          <li>
            <kbd>C</kbd> Recheck live fares · only while the watch is active
          </li>
          <li>
            <kbd>T</kbd> Copy a one-liner for a friend
          </li>
          <li>
            <kbd>J</kbd> / <kbd>K</kbd> Move down / up the board
          </li>
          <li>
            <kbd>I</kbd> Copy the focused itinerary
          </li>
          <li>
            <kbd>Enter</kbd> Open Book on Amtrak for the focused train
          </li>
          <li>
            <kbd>P</kbd> Pin or unpin the focused train
          </li>
          <li>
            <kbd>Z</kbd> Zen on or off: ticket and board only
          </li>
          <li>
            <kbd>H</kbd> Hide the focused train this visit
          </li>
          <li>
            <kbd>U</kbd> Undo last hide
          </li>
          <li>
            <kbd>Y</kbd> Copy you vs this train
          </li>
          <li>
            <kbd>W</kbd> Copy the cheapest listed train on each day
          </li>
          <li>
            <kbd>G</kbd> Jump to the timetable
          </li>
          <li>
            <kbd>B</kbd> Jump to the first train that beats yours
          </li>
          <li>
            <kbd>N</kbd> Next cheaper listed train
          </li>
          <li>
            <kbd>F</kbd> Copy Amtrak search fields
          </li>
          <li>
            <kbd>/</kbd> Find a train number
          </li>
          <li>
            <kbd>R</kbd> Jump to I rebooked
          </li>
          <li>
            <kbd>?</kbd> Open or close this sheet
          </li>
          <li>
            <kbd>Esc</kbd> Close this sheet or Share, else clear filters and comparison
          </li>
        </ul>
        <p className="mt-4 text-xs opacity-70">
          Pins and change-fee estimates stay on this browser only. We never invent an Amtrak fee.
        </p>
        <button type="button" id="help-close" className="mt-4 underline" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
