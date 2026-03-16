'use client';

import { cn } from '@/lib/utils';
import html2canvas from 'html2canvas';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Image as ImageIcon,
  Loader2,
  Palette,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';


// ============================================================
// Types
// ============================================================

type StylePreset = {
  label: string;
  description: string;
};

type OutlineSlide = {
  slide_number: number;
  title: string;
  type: 'cover' | 'content' | 'back-cover';
  key_message: string;
  visual_description: string;
  layout: string;
  text_elements: string[];
};

type Outline = {
  title: string;
  slides: OutlineSlide[];
};

type GeneratedSlide = {
  index: number;
  title: string;
  html: string;
  outlineSlide: OutlineSlide;
  fallback?: boolean;
};

type Phase =
  | 'outline_loading'
  | 'outline_ready'
  | 'generating'
  | 'done'
  | 'error';

// ============================================================
// Preset pill colors
// ============================================================

const PRESET_COLORS: Record<string, { bg: string; border: string; text: string; activeBg: string }> = {
  blueprint: { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', activeBg: 'bg-sky-100' },
  corporate: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', activeBg: 'bg-slate-100' },
  minimal: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', activeBg: 'bg-gray-100' },
  'sketch-notes': { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', activeBg: 'bg-amber-100' },
  'dark-atmospheric': { bg: 'bg-zinc-100', border: 'border-zinc-300', text: 'text-zinc-700', activeBg: 'bg-zinc-200' },
  'bold-editorial': { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', text: 'text-fuchsia-700', activeBg: 'bg-fuchsia-100' },
  'pptx-cards': { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', activeBg: 'bg-indigo-100' },
};

const DEFAULT_PRESETS: Record<string, StylePreset> = {
  blueprint:          { label: 'Blueprint', description: 'ダークブルー技術的スタイル' },
  corporate:          { label: 'Corporate', description: 'クリーンなビジネススタイル' },
  minimal:            { label: 'Minimal', description: 'シンプルなグレースタイル' },
  'sketch-notes':     { label: 'Sketch Notes', description: '手書き風の温かいスタイル' },
  'dark-atmospheric': { label: 'Dark', description: 'ダークモードスタイル' },
  'bold-editorial':   { label: 'Bold', description: '大胆なカラフルスタイル' },
  'pptx-cards':       { label: 'PPTX Native', description: 'カード型・即時生成（LLM不要）' },
};

// Slide dimensions (px)
const SLIDE_W = 1280;
const SLIDE_H = 720;

// ============================================================
// PPTX Native HTML generation (local, no LLM)
// ============================================================

const PPTX_COLORS = {
  primary: '#4F46E5',
  primaryLight: '#EEF2FF',
  primaryDark: '#3730A3',
  text: '#111827',
  textLight: '#6B7280',
  textMuted: '#9CA3AF',
  bg: '#FFFFFF',
  bgAlt: '#F9FAFB',
  border: '#E5E7EB',
  tableHeader: '#4F46E5',
  tableHeaderText: '#FFFFFF',
};

const CARD_ACCENTS = ['#F4A261', '#6BB8C9', '#10B981', '#E91E63', '#8B5CF6', '#F59E0B'];

const TOPIC_ICONS: Record<string, string> = {
  '概要': '📋', '紹介': '👋', 'まとめ': '✅', '結論': '🎯',
  '比較': '⚖️', '分析': '📊', 'データ': '📈', 'ワークフロー': '🔄',
  'プロセス': '⚙️', '計画': '📅', '課題': '⚠️', '問題': '❗',
  '解決': '💡', '提案': '💡', 'ポイント': '📌', '要点': '📌',
  '技術': '🔧', 'システム': '🖥️', 'セキュリティ': '🔒', '品質': '✨',
  '目標': '🎯', 'overview': '📋', 'summary': '✅', 'conclusion': '🎯',
};

function getTopicIcon(title: string): string {
  for (const [kw, icon] of Object.entries(TOPIC_ICONS)) {
    if (title.toLowerCase().includes(kw.toLowerCase())) return icon;
  }
  return '📄';
}

function toTakeaway(msg: string, maxLen = 60): string {
  const t = (msg || '').trim();
  return t.length > maxLen ? t.slice(0, maxLen - 1) + '…' : t;
}

type PptxLayout = 'cover' | 'cards' | 'content-flow';

function detectPptxLayout(slide: OutlineSlide): PptxLayout {
  if (slide.type === 'cover' || slide.type === 'back-cover') return 'cover';
  const n = (slide.text_elements || []).length;
  if (n >= 2 && n <= 4) return 'cards';
  return 'content-flow';
}

function generatePptxNativeHtml(
  slide: OutlineSlide,
  deckTitle: string,
  slideIndex: number,
  totalSlides: number,
): string {
  const layout = detectPptxLayout(slide);
  const icon = getTopicIcon(slide.title);
  const bullets = slide.text_elements || [];
  const C = PPTX_COLORS;

  const baseStyle = `width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;font-family:'Segoe UI','Hiragino Sans',sans-serif;position:relative;`;

  // Footer bar
  const footer = `<div style="position:absolute;bottom:0;left:0;right:0;height:36px;background:${C.bgAlt};border-top:1px solid ${C.border};display:flex;align-items:center;justify-content:space-between;padding:0 32px;">
    <span style="font-size:11px;color:${C.textMuted};">${deckTitle}</span>
    <span style="font-size:11px;color:${C.textMuted};">${slideIndex + 1} / ${totalSlides}</span>
  </div>`;

  // ---------- Cover / Back-cover ----------
  if (layout === 'cover') {
    const isCover = slide.type === 'cover';
    const subtitle = isCover
      ? toTakeaway(slide.key_message, 80)
      : 'ご清聴ありがとうございました';
    const mainTitle = isCover ? deckTitle : slide.title;

    return `<div style="${baseStyle}background:linear-gradient(135deg,${C.primary} 0%,${C.primaryDark} 100%);">
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;width:80%;">
        <div style="font-size:56px;margin-bottom:16px;">${icon}</div>
        <h1 data-editable="true" style="font-size:42px;font-weight:700;color:#fff;margin:0 0 20px 0;line-height:1.3;">${mainTitle}</h1>
        <h2 data-editable="true" style="font-size:20px;font-weight:400;color:rgba(255,255,255,0.85);margin:0;line-height:1.5;">${subtitle}</h2>
      </div>
      <div style="position:absolute;top:32px;left:32px;width:64px;height:4px;background:rgba(255,255,255,0.3);border-radius:2px;"></div>
      <div style="position:absolute;bottom:32px;right:32px;width:64px;height:4px;background:rgba(255,255,255,0.3);border-radius:2px;"></div>
    </div>`;
  }

  // ---------- Cards layout (2-4 bullets) ----------
  if (layout === 'cards') {
    const cols = bullets.length <= 2 ? 2 : bullets.length;
    const colWidth = Math.floor((SLIDE_W - 80 - (cols - 1) * 20) / cols);

    const cards = bullets.map((b, i) => {
      const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
      return `<div style="width:${colWidth}px;background:${C.bg};border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;display:flex;flex-direction:column;">
        <div style="height:6px;background:${accent};"></div>
        <div style="padding:28px 24px;flex:1;display:flex;flex-direction:column;justify-content:center;">
          <div style="font-size:28px;margin-bottom:12px;">${getTopicIcon(b)}</div>
          <li data-editable="true" style="font-size:17px;color:${C.text};line-height:1.6;list-style:none;margin:0;padding:0;">${b}</li>
        </div>
      </div>`;
    }).join('');

    return `<div style="${baseStyle}background:${C.bgAlt};">
      <div style="padding:36px 40px 0 40px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="width:4px;height:32px;background:${C.primary};border-radius:2px;"></div>
          <h2 data-editable="true" style="font-size:28px;font-weight:700;color:${C.text};margin:0;">${slide.title}</h2>
        </div>
        <p data-editable="true" style="font-size:14px;color:${C.textLight};margin:4px 0 0 16px;">${toTakeaway(slide.key_message)}</p>
      </div>
      <div style="display:flex;gap:20px;padding:32px 40px;align-items:stretch;">
        ${cards}
      </div>
      ${footer}
    </div>`;
  }

  // ---------- Content-flow layout (5+ bullets) ----------
  const half = Math.ceil(bullets.length / 2);
  const leftItems = bullets.slice(0, half);
  const rightItems = bullets.slice(half);

  const leftHtml = leftItems.map((b, i) =>
    `<div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:16px;">
      <div style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:${C.primary};color:#fff;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;">${i + 1}</div>
      <li data-editable="true" style="font-size:16px;color:${C.text};line-height:1.5;list-style:none;margin:0;padding:4px 0;">${b}</li>
    </div>`
  ).join('');

  const rightHtml = rightItems.map((b, i) => {
    const accent = CARD_ACCENTS[(i + half) % CARD_ACCENTS.length];
    return `<div style="background:${C.bg};border-left:4px solid ${accent};border-radius:8px;padding:14px 18px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
      <li data-editable="true" style="font-size:15px;color:${C.text};line-height:1.5;list-style:none;margin:0;padding:0;">${b}</li>
    </div>`;
  }).join('');

  return `<div style="${baseStyle}background:${C.bgAlt};">
    <div style="padding:36px 40px 0 40px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <div style="width:4px;height:32px;background:${C.primary};border-radius:2px;"></div>
        <h2 data-editable="true" style="font-size:28px;font-weight:700;color:${C.text};margin:0;">${slide.title}</h2>
      </div>
      <p data-editable="true" style="font-size:14px;color:${C.textLight};margin:4px 0 0 16px;">${toTakeaway(slide.key_message)}</p>
    </div>
    <div style="display:flex;gap:32px;padding:28px 40px;flex:1;">
      <div style="flex:1;">${leftHtml}</div>
      <div style="flex:1;">${rightHtml}</div>
    </div>
    ${footer}
  </div>`;
}

// ============================================================
// Component
// ============================================================

interface VisualSlideViewerProps {
  open: boolean;
  question: string;
  answer?: string;
  mode?: string;
  onClose: () => void;
}

export function VisualSlideViewer({ open, question, answer, mode, onClose }: VisualSlideViewerProps) {
  // Phase state
  const [phase, setPhase] = useState<Phase>('outline_loading');
  const [error, setError] = useState<string | null>(null);

  // Outline phase
  const [outline, setOutline] = useState<Outline | null>(null);
  const [presets, setPresets] = useState<Record<string, StylePreset>>({});
  const [selectedPreset, setSelectedPreset] = useState<string>('corporate');

  // Generation phase
  const [generatedSlides, setGeneratedSlides] = useState<GeneratedSlide[]>([]);
  const [generatingTotal, setGeneratingTotal] = useState(0);
  const [generatingCompleted, setGeneratingCompleted] = useState(0);

  // Gallery phase
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [editing, setEditing] = useState(false);

  // Refs
  const abortRef = useRef<AbortController | null>(null);
  const outlineFetchedRef = useRef(false);
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  // ============================================================
  // Scale calculation
  // ============================================================

  const updateScale = useCallback(() => {
    const el = mainAreaRef.current;
    if (!el) return;
    const padding = 80; // space for arrows
    const availW = el.clientWidth - padding;
    const availH = el.clientHeight - padding;
    const s = Math.min(availW / SLIDE_W, availH / SLIDE_H, 1);
    setScale(Math.max(0.1, s));
  }, []);

  useEffect(() => {
    if (phase !== 'done') return;
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [phase, updateScale]);

  // ============================================================
  // Phase 1: Fetch outline
  // ============================================================

  const fetchOutline = useCallback(async () => {
    setPhase('outline_loading');
    setError(null);
    outlineFetchedRef.current = true;

    try {
      const res = await fetch(`/api/slides/visual/outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer, mode: mode || 'standard', use_llm: true }),
      });

      if (!res.ok) {
        const text = await res.text();
        let detail = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(text);
          detail = parsed.detail || parsed.error || detail;
        } catch { /* ignore */ }
        throw new Error(detail);
      }

      const data = await res.json();
      setOutline(data.outline);
      setPresets(data.presets || {});
      setSelectedPreset(data.style_preset || 'corporate');
      setPhase('outline_ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate outline');
      setPhase('error');
    }
  }, [question, answer, mode]);

  useEffect(() => {
    if (open && !outlineFetchedRef.current) {
      fetchOutline();
    }
  }, [open, fetchOutline]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      outlineFetchedRef.current = false;
      setPhase('outline_loading');
      setOutline(null);
      setGeneratedSlides([]);
      setGeneratingTotal(0);
      setGeneratingCompleted(0);
      setActiveSlideIndex(0);
      setEditing(false);
      setError(null);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    }
  }, [open]);

  // ============================================================
  // Phase 2: Generate HTML slides
  // ============================================================

  const startGeneration = useCallback(async () => {
    if (!outline) return;

    setPhase('generating');
    setError(null);
    setGeneratedSlides([]);
    setGeneratingCompleted(0);
    setGeneratingTotal(outline.slides.length);

    // ---- PPTX Native: local generation, no LLM ----
    if (selectedPreset === 'pptx-cards') {
      const total = outline.slides.length;
      const slides: GeneratedSlide[] = outline.slides.map((s, i) => ({
        index: i,
        title: s.title,
        html: generatePptxNativeHtml(s, outline.title, i, total),
        outlineSlide: s,
      }));
      setGeneratedSlides(slides);
      setGeneratingCompleted(total);
      setPhase('done');
      setActiveSlideIndex(0);
      return;
    }

    // ---- LLM-based generation for other presets ----
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const slides: GeneratedSlide[] = [];

      for (let i = 0; i < outline.slides.length; i++) {
        if (controller.signal.aborted) return;

        const res = await fetch(`/api/slides/visual/renderhtml`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slide: outline.slides[i],
            style_preset: selectedPreset,
            deck_title: outline.title,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          let detail = `HTTP ${res.status}`;
          try { detail = JSON.parse(text).detail || detail; } catch { /* ignore */ }
          throw new Error(`Slide ${i + 1}: ${detail}`);
        }

        const data = await res.json();

        slides.push({
          index: i,
          title: outline.slides[i].title,
          html: data.html || '',
          outlineSlide: outline.slides[i],
          fallback: data.fallback || false,
        });
        setGeneratedSlides([...slides]);
        setGeneratingCompleted(i + 1);
      }

      setPhase('done');
      setActiveSlideIndex(0);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Generation failed');
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [outline, selectedPreset]);

  // ============================================================
  // Editing
  // ============================================================

  // Apply contentEditable whenever editing mode is on and slide changes
  useEffect(() => {
    if (!editing || phase !== 'done') return;

    // Wait for DOM to update after dangerouslySetInnerHTML
    const raf = requestAnimationFrame(() => {
      const container = slideContainerRef.current;
      if (!container) return;

      // Try data-editable first, fallback to all text-bearing elements
      let editables = container.querySelectorAll('[data-editable="true"]');
      if (editables.length === 0) {
        // Fallback: make all text-bearing leaf elements editable
        editables = container.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td, th, span, div');
      }

      editables.forEach((el) => {
        const htmlEl = el as HTMLElement;
        // Only make leaf-ish elements editable (those with direct text content)
        const hasDirectText = Array.from(htmlEl.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0
        );
        if (!hasDirectText && !htmlEl.hasAttribute('data-editable')) return;

        htmlEl.contentEditable = 'true';
        htmlEl.style.cursor = 'text';
        htmlEl.style.outline = 'none';
      });

      // Add focus/blur handlers via event delegation
      const handleFocus = (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.contentEditable === 'true') {
          target.style.outline = '2px solid rgba(245, 158, 11, 0.6)';
          target.style.outlineOffset = '2px';
          target.style.borderRadius = '4px';
        }
      };
      const handleBlur = (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.contentEditable === 'true') {
          target.style.outline = 'none';
        }
      };

      container.addEventListener('focusin', handleFocus);
      container.addEventListener('focusout', handleBlur);

      return () => {
        container.removeEventListener('focusin', handleFocus);
        container.removeEventListener('focusout', handleBlur);
      };
    });

    return () => cancelAnimationFrame(raf);
  }, [editing, activeSlideIndex, phase]);

  const enableEditing = useCallback(() => {
    setEditing(true);
  }, []);

  // Persist current slide's DOM back to state (without exiting editing mode)
  const persistCurrentSlide = useCallback(() => {
    const container = slideContainerRef.current;
    if (!container) return;

    // Clean up contentEditable before capturing HTML
    const editables = container.querySelectorAll('[contenteditable="true"]');
    editables.forEach((el) => {
      (el as HTMLElement).removeAttribute('contenteditable');
      (el as HTMLElement).style.cursor = '';
      (el as HTMLElement).style.outline = 'none';
    });

    const updatedHtml = container.innerHTML;
    setGeneratedSlides((prev) =>
      prev.map((s, i) =>
        i === activeSlideIndex ? { ...s, html: updatedHtml } : s
      )
    );
  }, [activeSlideIndex]);

  const saveEdits = useCallback(() => {
    persistCurrentSlide();
    setEditing(false);
  }, [persistCurrentSlide]);

  // ============================================================
  // Redraw current slide (re-render via LLM after editing)
  // ============================================================

  const [redrawing, setRedrawing] = useState(false);

  const redrawCurrentSlide = useCallback(async () => {
    if (!outline || selectedPreset === 'pptx-cards') return;
    const slide = generatedSlides[activeSlideIndex];
    if (!slide) return;

    // Persist any edits first
    persistCurrentSlide();

    setRedrawing(true);

    try {
      // Extract current text from DOM to build updated outline slide
      const container = slideContainerRef.current;
      const updatedTexts: string[] = [];
      if (container) {
        const editables = container.querySelectorAll('[data-editable="true"]');
        editables.forEach((el) => {
          const text = (el as HTMLElement).textContent?.trim();
          if (text) updatedTexts.push(text);
        });
      }

      // Build updated outline slide with edited text
      const updatedOutlineSlide: OutlineSlide = {
        ...slide.outlineSlide,
        text_elements: updatedTexts.length > 0 ? updatedTexts : slide.outlineSlide.text_elements,
      };

      const res = await fetch(`/api/slides/visual/renderhtml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slide: updatedOutlineSlide,
          style_preset: selectedPreset,
          deck_title: outline.title,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let detail = `HTTP ${res.status}`;
        try { detail = JSON.parse(text).detail || detail; } catch { /* ignore */ }
        throw new Error(detail);
      }

      const data = await res.json();

      // Update the slide HTML
      setGeneratedSlides((prev) =>
        prev.map((s, i) =>
          i === activeSlideIndex
            ? { ...s, html: data.html || s.html, outlineSlide: updatedOutlineSlide }
            : s
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Redraw failed');
    } finally {
      setRedrawing(false);
    }
  }, [outline, selectedPreset, generatedSlides, activeSlideIndex, persistCurrentSlide]);

  // ============================================================
  // Keyboard navigation
  // ============================================================

  useEffect(() => {
    if (!open || phase !== 'done') return;

    const handler = (e: KeyboardEvent) => {
      // Don't navigate while editing text
      if (editing) {
        if (e.key === 'Escape') {
          saveEdits();
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        setActiveSlideIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setActiveSlideIndex((prev) => Math.min(generatedSlides.length - 1, prev + 1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, phase, generatedSlides.length, onClose, editing, saveEdits]);

  // ============================================================
  // PPTX Export
  // ============================================================

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  /** Render a single slide's HTML to a PNG data-URL via html2canvas. */
  const renderSlideToPng = useCallback(async (html: string): Promise<string> => {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-99999px';
    container.style.top = '0';
    container.style.width = `${SLIDE_W}px`;
    container.style.height = `${SLIDE_H}px`;
    container.style.overflow = 'hidden';
    container.innerHTML = html;
    document.body.appendChild(container);

    try {
      const canvas = await html2canvas(container, {
        width: SLIDE_W,
        height: SLIDE_H,
        scale: 2, // 2x for crisp output in PPTX
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      return canvas.toDataURL('image/png');
    } finally {
      document.body.removeChild(container);
    }
  }, []);

  const handleExport = useCallback(async () => {
    if (generatedSlides.length === 0) return;
    setExporting(true);
    setExportProgress('');

    try {
      const title = outline?.title || question;

      // --- Image-based export: HTML → PNG → PPTX (pixel-perfect) ---
      const pngs: string[] = [];
      for (let i = 0; i < generatedSlides.length; i++) {
        setExportProgress(`画像化中 ${i + 1}/${generatedSlides.length}`);
        const png = await renderSlideToPng(generatedSlides[i].html);
        pngs.push(png);
      }

      setExportProgress('PPTX生成中...');
      const res = await fetch(`/api/slides/pptx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, pngs }),
      });

      if (!res.ok) throw new Error(`PPTX export failed: ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(outline?.title || 'slides').replace(/[^a-zA-Z0-9\u3040-\u30ff\u4e00-\u9fff _-]/g, '_')}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
      setExportProgress('');
    }
  }, [generatedSlides, outline, question, renderSlideToPng]);

  // ============================================================
  // Render
  // ============================================================

  if (!open) return null;

  const activeSlide = generatedSlides[activeSlideIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full h-full max-w-7xl max-h-[95vh] mx-4 my-4 bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <ImageIcon className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-semibold text-foreground">
              {outline?.title || 'Visual Slides'}
            </h2>
            {phase === 'generating' && (
              <span className="text-xs text-muted-foreground">
                {generatingCompleted}/{generatingTotal}
              </span>
            )}
            {phase === 'done' && generatedSlides.some(s => s.fallback) && (
              <span className="text-xs text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">
                {generatedSlides.filter(s => s.fallback).length}枚 LLM失敗→フォールバック
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {phase === 'done' && generatedSlides.length > 0 && !editing && (
              <button
                onClick={enableEditing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                編集
              </button>
            )}
            {editing && (
              <>
                {selectedPreset !== 'pptx-cards' && (
                  <button
                    onClick={redrawCurrentSlide}
                    disabled={redrawing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200 transition-colors disabled:opacity-50"
                  >
                    {redrawing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    再描画
                  </button>
                )}
                <button
                  onClick={saveEdits}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                >
                  完了
                </button>
              </>
            )}
            {phase === 'done' && generatedSlides.length > 0 && (
              <button
                onClick={handleExport}
                disabled={exporting || editing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {exportProgress || 'PPTX'}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-5">
          {/* Phase: Loading outline */}
          {phase === 'outline_loading' && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              <p className="text-sm text-muted-foreground">アウトラインを生成中...</p>
            </div>
          )}

          {/* Phase: Error */}
          {phase === 'error' && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-sm text-destructive">{error}</p>
              <button
                onClick={fetchOutline}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                再試行
              </button>
            </div>
          )}

          {/* Phase: Outline ready */}
          {phase === 'outline_ready' && outline && (
            <div className="max-w-3xl mx-auto space-y-5">
              {/* Outline list */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  スライド構成 ({outline.slides.length}枚)
                </h3>
                <div className="space-y-1.5">
                  {outline.slides.map((slide) => (
                    <div
                      key={slide.slide_number}
                      className="flex items-start gap-3 p-2.5 rounded-lg bg-secondary/30 border border-border/50"
                    >
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">
                        {slide.slide_number}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground leading-tight">{slide.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{slide.key_message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Style preset picker */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-amber-500" />
                  スタイル
                </h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(Object.keys(presets).length > 0 ? presets : DEFAULT_PRESETS).map(([key, preset]) => {
                    const colors = PRESET_COLORS[key] || PRESET_COLORS.corporate;
                    const isActive = selectedPreset === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedPreset(key)}
                        className={cn(
                          'px-3 py-1.5 text-xs font-medium rounded-full border transition-all',
                          isActive
                            ? `${colors.activeBg} ${colors.border} ${colors.text} ring-2 ring-offset-1 ring-amber-400`
                            : `${colors.bg} ${colors.border} ${colors.text} hover:${colors.activeBg}`
                        )}
                        title={preset.description}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Generate button */}
              <div className="flex justify-center pt-2">
                <button
                  onClick={startGeneration}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-lg shadow-amber-500/20"
                >
                  <Sparkles className="w-4 h-4" />
                  スライドを生成 ({outline.slides.length}枚)
                </button>
              </div>
            </div>
          )}

          {/* Phase: Generating */}
          {phase === 'generating' && (
            <div className="space-y-4">
              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>スライド生成中...</span>
                  <span>{generatingCompleted}/{generatingTotal}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{ width: `${generatingTotal > 0 ? (generatingCompleted / generatingTotal) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Grid of generated slides (thumbnail preview) */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {outline?.slides.map((slide, idx) => {
                  const generated = generatedSlides.find((s) => s.index === idx);
                  return (
                    <div
                      key={idx}
                      className={cn(
                        'relative aspect-video rounded-lg border overflow-hidden',
                        generated ? 'border-amber-300' : 'border-border bg-secondary/30'
                      )}
                    >
                      {generated ? (
                        <div className="w-full h-full animate-fade-in" style={{ position: 'relative' }}>
                          <div
                            style={{
                              transform: 'scale(0.15)',
                              transformOrigin: 'top left',
                              width: SLIDE_W,
                              height: SLIDE_H,
                              overflow: 'hidden',
                              pointerEvents: 'none',
                            }}
                            dangerouslySetInnerHTML={{ __html: generated.html }}
                          />
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                          <span className="text-[10px] text-muted-foreground">{slide.title}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Phase: Done - Gallery view */}
          {phase === 'done' && generatedSlides.length > 0 && (
            <div className="flex flex-col h-full gap-3">
              {/* Main slide view */}
              <div ref={mainAreaRef} className="flex-1 min-h-0 relative flex items-center justify-center">
                {/* Left arrow */}
                <button
                  onClick={() => { if (editing) persistCurrentSlide(); setActiveSlideIndex((prev) => Math.max(0, prev - 1)); }}
                  disabled={activeSlideIndex === 0}
                  className="absolute left-2 z-10 p-2 rounded-full bg-card/80 border border-border shadow-sm hover:bg-card transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                {/* Slide HTML rendered at scale */}
                {activeSlide && (
                  <div
                    className={cn(
                      'rounded-lg shadow-lg overflow-hidden',
                      editing && 'ring-2 ring-amber-400'
                    )}
                    style={{
                      width: SLIDE_W * scale,
                      height: SLIDE_H * scale,
                    }}
                  >
                    <div
                      ref={slideContainerRef}
                      style={{
                        width: SLIDE_W,
                        height: SLIDE_H,
                        overflow: 'hidden',
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                      }}
                      dangerouslySetInnerHTML={{ __html: activeSlide.html }}
                    />
                  </div>
                )}

                {/* Right arrow */}
                <button
                  onClick={() => { if (editing) persistCurrentSlide(); setActiveSlideIndex((prev) => Math.min(generatedSlides.length - 1, prev + 1)); }}
                  disabled={activeSlideIndex === generatedSlides.length - 1}
                  className="absolute right-2 z-10 p-2 rounded-full bg-card/80 border border-border shadow-sm hover:bg-card transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Slide title + editing hint */}
              {activeSlide && (
                <p className="text-center text-sm font-medium text-foreground">
                  {activeSlideIndex + 1}/{generatedSlides.length} - {activeSlide.title}
                  {activeSlide.fallback && <span className="ml-2 text-xs text-amber-500">(フォールバック - LLM生成失敗)</span>}
                  {editing && <span className="ml-2 text-xs text-amber-500">(編集中 - テキストをクリックして編集)</span>}
                </p>
              )}

              {/* Thumbnail strip */}
              <div className="flex-shrink-0 flex gap-2 overflow-x-auto py-2 px-1 scrollbar-thin">
                {generatedSlides.map((slide, idx) => (
                  <button
                    key={slide.index}
                    onClick={() => { if (editing) persistCurrentSlide(); setActiveSlideIndex(idx); }}
                    className={cn(
                      'flex-shrink-0 w-28 aspect-video rounded-md border-2 overflow-hidden transition-all',
                      idx === activeSlideIndex
                        ? 'border-amber-500 ring-2 ring-amber-500/30'
                        : 'border-border hover:border-amber-300'
                    )}
                  >
                    <div
                      style={{
                        transform: `scale(${112 / SLIDE_W})`,
                        transformOrigin: 'top left',
                        width: SLIDE_W,
                        height: SLIDE_H,
                        overflow: 'hidden',
                        pointerEvents: 'none',
                      }}
                      dangerouslySetInnerHTML={{ __html: slide.html }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
