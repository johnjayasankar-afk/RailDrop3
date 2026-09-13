'use client';

import { useState } from 'react';

export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={copy}
        className="rd-btn rd-btn-secondary w-full"
        aria-live="polite"
      >
        {copied ? 'Copied to clipboard' : label}
      </button>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-faint hover:text-muted">
          Show the details we will copy
        </summary>
        <pre className="tnum mt-2 overflow-x-auto rounded-lg border border-line bg-surface p-3 text-[12px] leading-relaxed text-ink-2">
          {text}
        </pre>
      </details>
    </div>
  );
}
