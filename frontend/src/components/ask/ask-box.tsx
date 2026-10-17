"use client";

import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function AskBox({
  initial = "",
  running,
  onSubmit,
  onStop,
  size = "md",
  autoFocus,
}: {
  initial?: string;
  running?: boolean;
  onSubmit: (q: string) => void;
  onStop?: () => void;
  size?: "md" | "lg";
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const submit = () => {
    const q = value.trim();
    if (q && !running) onSubmit(q);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={`flex items-end gap-2 rounded-xl border border-line-strong bg-surface shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-colors focus-within:border-accent ${
        size === "lg" ? "p-3 pl-4" : "p-2 pl-3"
      }`}
    >
      <label htmlFor="ask" className="sr-only">
        Ask a question about US tech supply chains
      </label>
      <textarea
        id="ask"
        ref={ref}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Who supplies NVIDIA, and how exposed is each supplier?"
        className={`max-h-40 flex-1 resize-none bg-transparent py-1.5 text-ink outline-none placeholder:text-faint ${
          size === "lg" ? "text-base" : "text-sm"
        }`}
      />
      {running ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink hover:bg-line"
        >
          <Square className="h-3.5 w-3.5" fill="currentColor" />
        </button>
      ) : (
        <button
          type="submit"
          aria-label="Ask"
          disabled={!value.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink text-bg transition-opacity disabled:opacity-25"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </form>
  );
}
