'use client';

import { cn } from '@/lib/utils';
import { HTMLAttributes, FormEvent, ReactNode, useRef, useEffect, TextareaHTMLAttributes, forwardRef } from 'react';
import { ArrowUp, Square } from 'lucide-react';

/* ── PromptInput (form wrapper) ──────────────────────────── */
interface PromptInputProps extends HTMLAttributes<HTMLFormElement> {
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}

export function PromptInput({ onSubmit, children, className, ...props }: PromptInputProps) {
  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        'relative flex flex-col gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm',
        'focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-primary/30 transition-all',
        className
      )}
      {...props}
    >
      {children}
    </form>
  );
}

/* ── PromptInputTextarea ─────────────────────────────────── */
interface PromptInputTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  ({ className, onChange, ...props }, ref) => {
    const internalRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = (ref as React.RefObject<HTMLTextAreaElement>) || internalRef;

    useEffect(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      }
    }, [props.value, textareaRef]);

    return (
      <textarea
        ref={textareaRef}
        rows={1}
        className={cn(
          'w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground',
          'focus:outline-none px-2 py-1.5 min-h-[36px] max-h-[200px]',
          className
        )}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
          props.onKeyDown?.(e);
        }}
        {...props}
      />
    );
  }
);
PromptInputTextarea.displayName = 'PromptInputTextarea';

/* ── PromptInputFooter ───────────────────────────────────── */
interface PromptInputFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function PromptInputFooter({ children, className, ...props }: PromptInputFooterProps) {
  return (
    <div
      className={cn('flex items-center justify-between gap-2', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── PromptInputTools ────────────────────────────────────── */
interface PromptInputToolsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function PromptInputTools({ children, className, ...props }: PromptInputToolsProps) {
  return (
    <div className={cn('flex items-center gap-1', className)} {...props}>
      {children}
    </div>
  );
}

/* ── PromptInputSubmit ───────────────────────────────────── */
interface PromptInputSubmitProps extends HTMLAttributes<HTMLButtonElement> {
  status?: 'ready' | 'streaming' | 'disabled';
  disabled?: boolean;
}

export function PromptInputSubmit({ status = 'ready', disabled, className, ...props }: PromptInputSubmitProps) {
  const isStreaming = status === 'streaming';

  return (
    <button
      type={isStreaming ? 'button' : 'submit'}
      disabled={disabled && !isStreaming}
      className={cn(
        'inline-flex items-center justify-center rounded-xl p-2 transition-all',
        isStreaming
          ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
          : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    >
      {isStreaming ? (
        <Square className="w-4 h-4 fill-current" />
      ) : (
        <ArrowUp className="w-4 h-4" />
      )}
    </button>
  );
}
