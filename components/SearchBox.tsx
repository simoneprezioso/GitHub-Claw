"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  autoFocus?: boolean;
  compact?: boolean;
}

export function SearchBox({ value, onChange, onSubmit, loading, autoFocus, compact }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Auto-grow the textarea so longer ideas stay readable.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!loading && value.trim()) onSubmit();
      }}
      className={cx(
        "group relative w-full rounded-2xl border border-ink-200 bg-white shadow-card transition focus-within:border-ink-900",
        compact ? "p-2" : "p-3",
      )}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!loading && value.trim()) onSubmit();
          }
        }}
        placeholder="Describe a tool, app, library, or project…"
        rows={1}
        spellCheck
        className={cx(
          "block w-full resize-none bg-transparent px-3 py-2 text-ink-900 placeholder:text-ink-400 focus:outline-none",
          compact ? "text-base" : "text-lg",
        )}
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
        <p className="text-xs text-ink-400">
          Enter to search · Shift + Enter for newline
        </p>
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:bg-ink-300"
        >
          {loading ? (
            <>
              <Spinner /> Searching…
            </>
          ) : (
            <>Search GitHub</>
          )}
        </button>
      </div>
    </form>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}
