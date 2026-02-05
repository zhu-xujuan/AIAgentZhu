'use client';

import { cn } from '@/lib/utils';
import { HTMLAttributes, ReactNode, useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';

/* ── Sources (collapsible wrapper) ────────────────────────── */
interface SourcesProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Sources({ children, defaultOpen = false, className, ...props }: SourcesProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn('', className)} {...props}>
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {/* Render trigger and content, passing isOpen state */}
        {Array.isArray(children)
          ? children.map((child, i) => {
              if (child && typeof child === 'object' && 'type' in child) {
                if (child.type === SourcesTrigger) {
                  return <SourcesTrigger key={i} {...child.props} isOpen={isOpen} />;
                }
                if (child.type === SourcesContent) {
                  return isOpen ? <SourcesContent key={i} {...child.props} /> : null;
                }
              }
              return child;
            })
          : children}
      </div>
    </div>
  );
}

/* ── SourcesTrigger ───────────────────────────────────────── */
interface SourcesTriggerProps extends HTMLAttributes<HTMLDivElement> {
  count: number;
  isOpen?: boolean;
}

export function SourcesTrigger({ count, isOpen, className, ...props }: SourcesTriggerProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1',
        className
      )}
      {...props}
    >
      <FileText className="w-3.5 h-3.5" />
      <span>Sources ({count})</span>
      <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
    </div>
  );
}

/* ── SourcesContent ───────────────────────────────────────── */
interface SourcesContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function SourcesContent({ children, className, ...props }: SourcesContentProps) {
  return (
    <div
      className={cn('mt-2 space-y-1.5 animate-fade-in', className)}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── Source (single source card) ──────────────────────────── */
interface SourceProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  detail?: string;
  similarity?: number;
  expandable?: boolean;
  expandedContent?: ReactNode;
}

export function Source({ title, detail, similarity, expandable = false, expandedContent, className, ...props }: SourceProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card overflow-hidden transition-colors',
        expandable && 'cursor-pointer hover:border-primary/30',
        className
      )}
      onClick={expandable ? (e) => { e.stopPropagation(); setIsExpanded(!isExpanded); } : undefined}
      {...props}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-medium text-foreground truncate flex-1">{title}</span>
        {similarity !== undefined && (
          <span className="text-[10px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full flex-shrink-0">
            {(similarity * 100).toFixed(0)}%
          </span>
        )}
        {expandable && (
          <ChevronDown
            className={cn('w-3 h-3 text-muted-foreground transition-transform flex-shrink-0', isExpanded && 'rotate-180')}
          />
        )}
      </div>
      {isExpanded && expandedContent && (
        <div className="px-3 pb-2.5 pt-0 border-t border-border/50">
          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed mt-2">
            {expandedContent}
          </p>
        </div>
      )}
    </div>
  );
}
