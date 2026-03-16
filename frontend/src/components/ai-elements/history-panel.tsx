'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchQAHistory,
  fetchSlideHistory,
  renameQAConversation,
  deleteQAConversation,
  renameSlideDeck,
  deleteSlideDeck,
  type QAHistoryItem,
  type SlideHistoryItem,
} from '@/lib/api';
import {
  Check,
  FileCode,
  MessageCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';

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
// Action Menu (dropdown)
// ============================================================

interface ActionMenuProps {
  onRename: () => void;
  onDelete: () => void;
}

function ActionMenu({ onRename, onDelete }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={menuRef} className="relative flex-shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className={cn(
          'p-1 rounded-md transition-colors',
          open
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground/0 group-hover:text-muted-foreground hover:text-foreground hover:bg-secondary/50',
        )}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[120px] animate-fade-in">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRename();
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50 transition-colors"
          >
            <Pencil className="w-3 h-3" />
            名前変更
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            削除
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Inline Rename Input
// ============================================================

interface InlineRenameProps {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

function InlineRename({ initialValue, onConfirm, onCancel }: InlineRenameProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={handleSubmit}
        className="flex-1 min-w-0 text-xs bg-secondary/50 border border-border rounded px-1.5 py-0.5 text-foreground outline-none focus:border-primary/50"
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleSubmit();
        }}
        className="p-0.5 rounded text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
      >
        <Check className="w-3 h-3" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        className="p-0.5 rounded text-muted-foreground hover:bg-secondary/50 transition-colors flex-shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
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

  // Rename state: { type, id } of the item being renamed
  const [renaming, setRenaming] = useState<{ type: 'qa' | 'slide'; id: number } | null>(null);

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

  const handleRenameQA = useCallback(async (id: number, newName: string) => {
    try {
      await renameQAConversation(id, newName);
      setQAItems((prev) => prev.map((item) => (item.id === id ? { ...item, question: newName } : item)));
    } catch {
      // ignore
    }
    setRenaming(null);
  }, []);

  const handleDeleteQA = useCallback(async (id: number) => {
    try {
      await deleteQAConversation(id);
      setQAItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      // ignore
    }
  }, []);

  const handleRenameSlide = useCallback(async (id: number, newTitle: string) => {
    try {
      await renameSlideDeck(id, newTitle);
      setSlideItems((prev) => prev.map((item) => (item.id === id ? { ...item, title: newTitle } : item)));
    } catch {
      // ignore
    }
    setRenaming(null);
  }, []);

  const handleDeleteSlide = useCallback(async (id: number) => {
    try {
      await deleteSlideDeck(id);
      setSlideItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      // ignore
    }
  }, []);

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
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectQA(item.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelectQA(item.id); }}
              className="w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors border-b border-border/30 group cursor-pointer"
            >
              <div className="flex items-start gap-2">
                <span className="text-[11px] text-muted-foreground flex-shrink-0 mt-0.5 tabular-nums">
                  {formatTimestamp(item.created_at)}
                </span>
                {renaming?.type === 'qa' && renaming.id === item.id ? (
                  <InlineRename
                    initialValue={item.question}
                    onConfirm={(val) => handleRenameQA(item.id, val)}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <>
                    <span className="text-xs text-foreground line-clamp-2 leading-relaxed group-hover:text-primary transition-colors flex-1 min-w-0">
                      {item.question}
                    </span>
                    <ActionMenu
                      onRename={() => setRenaming({ type: 'qa', id: item.id })}
                      onDelete={() => handleDeleteQA(item.id)}
                    />
                  </>
                )}
              </div>
            </div>
          ))}

        {!loading && tab === 'slides' &&
          slideItems.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSlide(item.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelectSlide(item.id); }}
              className="w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors border-b border-border/30 group cursor-pointer"
            >
              <div className="flex items-start gap-2">
                <span className="text-[11px] text-muted-foreground flex-shrink-0 mt-0.5 tabular-nums">
                  {formatTimestamp(item.created_at)}
                </span>
                {renaming?.type === 'slide' && renaming.id === item.id ? (
                  <InlineRename
                    initialValue={item.title}
                    onConfirm={(val) => handleRenameSlide(item.id, val)}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-foreground line-clamp-2 leading-relaxed group-hover:text-teal-600 transition-colors">
                        {item.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {item.slide_count}枚
                      </span>
                    </div>
                    <ActionMenu
                      onRename={() => setRenaming({ type: 'slide', id: item.id })}
                      onDelete={() => handleDeleteSlide(item.id)}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
