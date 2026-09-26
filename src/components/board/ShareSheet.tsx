"use client";

/* The share popover. Every item copies something and then dismisses itself,
 * so the page passes the copy actions and one dismiss. */
export function ShareSheet({
  onClose,
  copyFriend,
  copyWindow,
  copyPacket,
  copyShare,
  shareLabel,
}: {
  onClose: () => void;
  copyFriend: () => Promise<void> | void;
  copyWindow: () => Promise<void> | void;
  copyPacket: () => Promise<void> | void;
  copyShare: () => Promise<void> | void;
  /** "Copy this view" once the board has been narrowed; "Copy link" otherwise. */
  shareLabel: string;
}) {
  function run(action: () => Promise<void> | void) {
    void action();
    onClose();
  }
  return (
    <div id="share-sheet" className="share-sheet no-print" role="group" aria-label="Share">
      <button type="button" onClick={() => run(copyFriend)}>
        Text a friend
      </button>
      <button type="button" onClick={() => run(copyWindow)}>
        Copy window
      </button>
      <button type="button" onClick={() => run(copyPacket)}>
        Decision packet
      </button>
      <button type="button" onClick={() => run(copyShare)}>
        {shareLabel}
      </button>
    </div>
  );
}
