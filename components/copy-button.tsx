"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Copies text to the clipboard with visible and screen-reader feedback. */
export function CopyButton({
  value,
  label,
  className,
  style,
}: {
  value: string;
  label: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      style={style}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-ui border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted",
        className,
      )}
      aria-label={copied ? `${label}: copied` : label}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
