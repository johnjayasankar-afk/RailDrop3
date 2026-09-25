import { connectionNote } from "@/lib/domain/board-insights";
import type { RankedCandidate } from "@/lib/domain/types";

export function ConnectionChip({ candidate }: { candidate: RankedCandidate }) {
  const note = connectionNote(candidate);
  const extra =
    note.quality === "tight" ? "chip-tight" : note.quality === "long" ? "chip-long" : "";
  return <span className={`chip ${extra}`}>{note.label}</span>;
}
