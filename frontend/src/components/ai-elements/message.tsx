'use client';

import { cn } from '@/lib/utils';
import { HTMLAttributes, ReactNode } from 'react';

/* ── Message ─────────────────────────────────────────────── */
interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  from: 'user' | 'assistant';
  children: ReactNode;
}

export function Message({ from, children, className, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        'group flex gap-3 animate-fade-in',
        from === 'user' ? 'is-user justify-end' : 'justify-start',
        className
      )}
      {...props}
    >
      {from === 'assistant' && (
        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
          <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
        </div>
      )}
      <div className={cn('max-w-[80%]', from === 'user' ? 'max-w-[70%]' : 'flex-1 max-w-[85%]')}>
        {children}
      </div>
    </div>
  );
}

/* ── MessageContent ──────────────────────────────────────── */
interface MessageContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function MessageContent({ children, className, ...props }: MessageContentProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 text-sm text-foreground',
        'group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md',
        'group-[:not(.is-user)]:bg-card group-[:not(.is-user)]:border group-[:not(.is-user)]:border-border group-[:not(.is-user)]:px-4 group-[:not(.is-user)]:py-3 group-[:not(.is-user)]:rounded-2xl group-[:not(.is-user)]:rounded-bl-md group-[:not(.is-user)]:shadow-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── MessageResponse (markdown text area) ────────────────── */
interface MessageResponseProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function MessageResponse({ children, className, ...props }: MessageResponseProps) {
  return (
    <div
      className={cn('whitespace-pre-wrap leading-relaxed', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── MessageActions (action buttons row) ─────────────────── */
interface MessageActionsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function MessageActions({ children, className, ...props }: MessageActionsProps) {
  return (
    <div
      className={cn('flex items-center gap-1 mt-1 ml-10', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── MessageAction (single action button) ────────────────── */
interface MessageActionProps extends HTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function MessageAction({ label, children, className, ...props }: MessageActionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-md p-1.5',
        'text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
        'text-xs gap-1',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ── StreamingIndicator ──────────────────────────────────── */
export function StreamingIndicator({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 ml-1', className)}>
      <span className="w-1.5 h-4 bg-primary/60 rounded-sm animate-pulse" />
    </span>
  );
}

/* ── MessageMetadata (badges row) ────────────────────────── */
interface MessageMetadataProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function MessageMetadata({ children, className, ...props }: MessageMetadataProps) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/50', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── MetadataBadge ───────────────────────────────────────── */
interface MetadataBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'info' | 'accent' | 'destructive';
  children: ReactNode;
}

const badgeVariants: Record<string, string> = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  accent: 'bg-violet-50 text-violet-700 border-violet-200',
  destructive: 'bg-red-50 text-red-700 border-red-200',
};

export function MetadataBadge({ variant = 'default', children, className, ...props }: MetadataBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border',
        badgeVariants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
