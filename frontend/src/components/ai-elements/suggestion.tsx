'use client';

import { cn } from '@/lib/utils';
import { HTMLAttributes, ReactNode } from 'react';

/* ── Suggestions (container) ──────────────────────────────── */
interface SuggestionsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Suggestions({ children, className, ...props }: SuggestionsProps) {
  return (
    <div
      className={cn('flex flex-wrap gap-2 justify-center', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── Suggestion (single chip) ─────────────────────────────── */
interface SuggestionProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  suggestion: string;
  icon?: ReactNode;
  onSelect?: (suggestion: string) => void;
}

export function Suggestion({ suggestion, icon, onSelect, className, ...props }: SuggestionProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(suggestion)}
      className={cn(
        'inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm text-foreground',
        'hover:bg-accent hover:border-primary/20 transition-all shadow-sm',
        className
      )}
      {...props}
    >
      {icon}
      <span>{suggestion}</span>
    </button>
  );
}
