'use client';

import { cn } from '@/lib/utils';
import { HTMLAttributes, ReactNode, useRef, useEffect, useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/* ── Conversation ─────────────────────────────────────────── */
interface ConversationProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Conversation({ children, className, ...props }: ConversationProps) {
  return (
    <div className={cn('flex flex-col flex-1 min-h-0 relative', className)} {...props}>
      {children}
    </div>
  );
}

/* ── ConversationContent ──────────────────────────────────── */
interface ConversationContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  autoScroll?: boolean;
}

export function ConversationContent({
  children,
  autoScroll = true,
  className,
  ...props
}: ConversationContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (autoScroll && isAtBottom) {
      scrollToBottom();
    }
  }, [children, autoScroll, isAtBottom, scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < 40);
    }
  }, []);

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={cn(
          'flex-1 overflow-y-auto scrollbar-thin',
          'space-y-4 px-1 py-4',
          className
        )}
        role="log"
        aria-live="polite"
        {...props}
      >
        {children}
      </div>
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 rounded-full bg-card border border-border shadow-md p-1.5 hover:bg-accent transition-colors"
          aria-label="Scroll to bottom"
        >
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </button>
      )}
    </>
  );
}

/* ── ConversationEmptyState ───────────────────────────────── */
interface ConversationEmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}

export function ConversationEmptyState({
  icon,
  title,
  description,
  children,
  className,
  ...props
}: ConversationEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center animate-fade-in',
        className
      )}
      {...props}
    >
      {icon && (
        <div className="mb-4 text-muted-foreground/40">{icon}</div>
      )}
      <h3 className="text-lg font-medium text-foreground/70 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
