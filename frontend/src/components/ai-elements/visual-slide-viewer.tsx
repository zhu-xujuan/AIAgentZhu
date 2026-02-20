'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
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
  image_data_url: string;
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
};

const DEFAULT_PRESETS: Record<string, StylePreset> = {
  blueprint:          { label: 'Blueprint', description: 'ダークブルー技術的スタイル' },
  corporate:          { label: 'Corporate', description: 'クリーンなビジネススタイル' },
  minimal:            { label: 'Minimal', description: 'シンプルなグレースタイル' },
  'sketch-notes':     { label: 'Sketch Notes', description: '手書き風の温かいスタイル' },
  'dark-atmospheric': { label: 'Dark', description: 'ダークモードスタイル' },
  'bold-editorial':   { label: 'Bold', description: '大胆なカラフルスタイル' },
};

function waitNextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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

  // Offscreen HTML for html2canvas capture
  const [offscreenHtml, setOffscreenHtml] = useState('');

  // Refs
  const abortRef = useRef<AbortController | null>(null);
  const outlineFetchedRef = useRef(false);
  const offscreenRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ question, answer, mode: mode || 'standard' }),
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
      setOffscreenHtml('');
      setError(null);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    }
  }, [open]);

  // ============================================================
  // Phase 2: Generate images via html2canvas (client-side)
  // ============================================================

  const startGeneration = useCallback(async () => {
    if (!outline) return;

    setPhase('generating');
    setError(null);
    setGeneratedSlides([]);
    setGeneratingCompleted(0);
    setGeneratingTotal(outline.slides.length);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { default: html2canvas } = await import('html2canvas');
      const slides: GeneratedSlide[] = [];

      for (let i = 0; i < outline.slides.length; i++) {
        if (controller.signal.aborted) return;

        // 1. Call backend to generate HTML via LLM
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

        // 2. Set HTML into offscreen div
        setOffscreenHtml(data.html || '');
        await waitNextFrame();
        await waitNextFrame();

        // 3. Capture with html2canvas
        const el = offscreenRef.current;
        if (!el) throw new Error('Offscreen element not ready');

        const canvas = await html2canvas(el, {
          backgroundColor: null,
          scale: 2,
          useCORS: true,
        });
        const dataUrl = canvas.toDataURL('image/png');

        slides.push({
          index: i,
          title: outline.slides[i].title,
          image_data_url: dataUrl,
        });
        setGeneratedSlides([...slides]);
        setGeneratingCompleted(i + 1);
      }

      setOffscreenHtml('');
      setPhase('done');
      setActiveSlideIndex(0);
    } catch (e) {
      if (controller.signal.aborted) return;
      setOffscreenHtml('');
      setError(e instanceof Error ? e.message : 'Generation failed');
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [outline, selectedPreset]);

  // ============================================================
  // Keyboard navigation
  // ============================================================

  useEffect(() => {
    if (!open || phase !== 'done') return;

    const handler = (e: KeyboardEvent) => {
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
  }, [open, phase, generatedSlides.length, onClose]);

  // ============================================================
  // PPTX Export (reuses existing Mode A)
  // ============================================================

  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (generatedSlides.length === 0) return;
    setExporting(true);

    try {
      const pngs = generatedSlides.map((s) => s.image_data_url);
      const title = outline?.title || question;

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
    }
  }, [generatedSlides, outline, question]);

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
          </div>
          <div className="flex items-center gap-2">
            {phase === 'done' && generatedSlides.length > 0 && (
              <button
                onClick={handleExport}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                PPTX
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
                  <ImageIcon className="w-4 h-4" />
                  画像を生成 ({outline.slides.length}枚)
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
                  <span>画像生成中...</span>
                  <span>{generatingCompleted}/{generatingTotal}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{ width: `${generatingTotal > 0 ? (generatingCompleted / generatingTotal) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Grid of generated images */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {outline?.slides.map((slide, idx) => {
                  const generated = generatedSlides.find((s) => s.index === idx);
                  return (
                    <div
                      key={idx}
                      className={cn(
                        'relative aspect-video rounded-lg border overflow-hidden',
                        generated ? 'border-amber-300 bg-black' : 'border-border bg-secondary/30'
                      )}
                    >
                      {generated ? (
                        <img
                          src={generated.image_data_url}
                          alt={generated.title}
                          className="w-full h-full object-contain animate-fade-in"
                        />
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
              <div className="flex-1 min-h-0 relative flex items-center justify-center">
                {/* Left arrow */}
                <button
                  onClick={() => setActiveSlideIndex((prev) => Math.max(0, prev - 1))}
                  disabled={activeSlideIndex === 0}
                  className="absolute left-2 z-10 p-2 rounded-full bg-card/80 border border-border shadow-sm hover:bg-card transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                {/* Slide image */}
                {activeSlide && (
                  <div className="max-w-full max-h-full flex items-center justify-center">
                    <img
                      src={activeSlide.image_data_url}
                      alt={activeSlide.title}
                      className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg"
                    />
                  </div>
                )}

                {/* Right arrow */}
                <button
                  onClick={() => setActiveSlideIndex((prev) => Math.min(generatedSlides.length - 1, prev + 1))}
                  disabled={activeSlideIndex === generatedSlides.length - 1}
                  className="absolute right-2 z-10 p-2 rounded-full bg-card/80 border border-border shadow-sm hover:bg-card transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Slide title */}
              {activeSlide && (
                <p className="text-center text-sm font-medium text-foreground">
                  {activeSlideIndex + 1}/{generatedSlides.length} - {activeSlide.title}
                </p>
              )}

              {/* Thumbnail strip */}
              <div className="flex-shrink-0 flex gap-2 overflow-x-auto py-2 px-1 scrollbar-thin">
                {generatedSlides.map((slide, idx) => (
                  <button
                    key={slide.index}
                    onClick={() => setActiveSlideIndex(idx)}
                    className={cn(
                      'flex-shrink-0 w-28 aspect-video rounded-md border-2 overflow-hidden transition-all',
                      idx === activeSlideIndex
                        ? 'border-amber-500 ring-2 ring-amber-500/30'
                        : 'border-border hover:border-amber-300'
                    )}
                  >
                    <img
                      src={slide.image_data_url}
                      alt={slide.title}
                      className="w-full h-full object-contain bg-black"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Offscreen slide rendering for html2canvas capture */}
      <div style={{ position: 'fixed', left: -99999, top: 0 }} aria-hidden="true">
        <div
          ref={offscreenRef}
          style={{ width: 1280, height: 720, overflow: 'hidden' }}
          dangerouslySetInnerHTML={{ __html: offscreenHtml }}
        />
      </div>
    </div>
  );
}
