'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchQAHistory,
  fetchSlideHistory,
  type QAHistoryItem,
  type SlideHistoryItem,
} from '@/lib/api';
import { FileCode, MessageCircle, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

// ============================================================
// Timestamp formatting
// ============================================================

function formatTimestamp(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isToday) {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }

  const isSameYear = d.getFullYear() === now.getFullYear();
  if (isSameYear) {
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================
// Component
// ============================================================

type Tab = 'qa' | 'slides';

interface HistoryPanelProps {
  onSelectQA: (id: number) => void;
  onSelectSlide: (id: number) => void;
  refreshTrigger?: number;
}

export function HistoryPanel({ onSelectQA, onSelectSlide, refreshTrigger }: HistoryPanelProps) {
  const [tab, setTab] = useState<Tab>('qa');
  const [collapsed, setCollapsed] = useState(false);

  const [qaItems, setQAItems] = useState<QAHistoryItem[]>([]);
  const [slideItems, setSlideItems] = useState<SlideHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [qa, slides] = await Promise.all([
        fetchQAHistory(50, 0),
        fetchSlideHistory(50, 0),
      ]);
      setQAItems(qa);
      setSlideItems(slides);
    } catch {
      // Silently fail - history is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  if (collapsed) {
    return (
      <div className="flex-shrink-0 border-r border-border flex flex-col items-center py-3 px-1 gap-2">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="履歴を展開"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 w-72 border-r border-border flex flex-col h-full bg-card/50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-0.5">
          <button
            onClick={() => setTab('qa')}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
              tab === 'qa'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <MessageCircle className="w-3 h-3" />
            Q&A
          </button>
          <button
            onClick={() => setTab('slides')}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
              tab === 'slides'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FileCode className="w-3 h-3" />
            スライド
          </button>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="履歴を折りたたむ"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {!loading && tab === 'qa' && qaItems.length === 0 && (
          <div className="text-center py-8 text-xs text-muted-foreground">
            Q&A履歴はまだありません
          </div>
        )}

        {!loading && tab === 'slides' && slideItems.length === 0 && (
          <div className="text-center py-8 text-xs text-muted-foreground">
            スライド履歴はまだありません
          </div>
        )}

        {!loading && tab === 'qa' &&
          qaItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectQA(item.id)}
              className="w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors border-b border-border/30 group"
            >
              <div className="flex items-start gap-2">
                <span className="text-[11px] text-muted-foreground flex-shrink-0 mt-0.5 tabular-nums">
                  {formatTimestamp(item.created_at)}
                </span>
                <span className="text-xs text-foreground line-clamp-2 leading-relaxed group-hover:text-primary transition-colors">
                  {item.question}
                </span>
              </div>
            </button>
          ))}

        {!loading && tab === 'slides' &&
          slideItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectSlide(item.id)}
              className="w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors border-b border-border/30 group"
            >
              <div className="flex items-start gap-2">
                <span className="text-[11px] text-muted-foreground flex-shrink-0 mt-0.5 tabular-nums">
                  {formatTimestamp(item.created_at)}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-xs text-foreground line-clamp-2 leading-relaxed group-hover:text-teal-600 transition-colors">
                    {item.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {item.slide_count}枚
                  </span>
                </div>
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}
