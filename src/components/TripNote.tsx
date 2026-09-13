'use client';

import { useState } from 'react';

import { saveNoteAction } from '@/app/actions';
import { useToast } from './Toast';

const MAX = 500;

/** A private note on a trip — confirmation number, who you are travelling with, why. */
export function TripNote({ watchId, note }: { watchId: string; note: string | null }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await saveNoteAction(watchId, value);
      if (result.ok) {
        setEditing(false);
        toast({ title: value.trim() ? 'Note saved' : 'Note cleared' });
      } else {
        toast({ title: 'Could not save the note', description: result.error, tone: 'danger' });
      }
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-3">
        {note ? (
          <p className="min-w-0 flex-1 border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink-2">
            {note}
          </p>
        ) : (
          <p className="text-[13px] text-faint">
            No note yet — handy for a confirmation number or who is travelling.
          </p>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rd-btn rd-btn-ghost !min-h-11 !px-3 !text-[13px]"
        >
          {note ? 'Edit note' : 'Add a note'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="trip-note" className="rd-label">
        Private note
      </label>
      <textarea
        id="trip-note"
        rows={3}
        maxLength={MAX}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Confirmation ABC123 · travelling with Sam · aisle seat"
        className="rd-input mt-1.5 resize-y py-2.5 !text-[14px]"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rd-btn rd-btn-primary !min-h-10 !text-[14px]"
        >
          {saving ? 'Saving…' : 'Save note'}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(note ?? '');
            setEditing(false);
          }}
          className="rd-btn rd-btn-ghost !min-h-10 !text-[14px]"
        >
          Cancel
        </button>
        <span className="tnum ml-auto text-[11.5px] text-faint">
          {value.length}/{MAX}
        </span>
      </div>
    </div>
  );
}
