'use client';

import { cn } from '@/lib/utils';
import html2canvas from 'html2canvas';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FileCode,
  FileDown,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { saveSlideDeck, updateSlideDeck } from '@/lib/api';
import { StyleOptionsPanel, type StyleOptions } from './style-options-panel';
import { TemplateManager } from './template-manager';

// ============================================================
// Types
// ============================================================

type SlideSection = {
  title: string;
  type: 'cover' | 'content' | 'back-cover';
  plan_text: string;
};

type GeneratedSlide = {
  index: number;
  title: string;
  html: string;
  type: string;
  fallback?: boolean;
};

type Phase =
  | 'planning'
  | 'plan_ready'
  | 'generating'
  | 'done'
  | 'error';

// Slide dimensions (px)
const SLIDE_W = 1280;
const SLIDE_H = 720;

// ============================================================
// Client-side MD parser
// ============================================================

function parsePlanMd(md: string): { title: string; slides: SlideSection[] } {
  const lines = md.split('\n');
  let title = 'Slides';
  const slides: SlideSection[] = [];
  let current: SlideSection | null = null;

  for (const line of lines) {
    const stripped = line.trim();

    // Deck title: # ...
    if (/^#\s+/.test(stripped) && !/^##/.test(stripped)) {
      title = stripped.replace(/^#\s+/, '').trim();
      continue;
    }

    // Slide header: ## スライドN: ...
    const slideMatch = stripped.match(/^##\s+スライド\d+[:\s：]\s*(.+)/);
    if (slideMatch) {
      if (current) slides.push(current);
      current = { title: slideMatch[1].trim(), type: 'content', plan_text: '' };
      continue;
    }

    // Fallback: any ## header
    if (/^##\s+/.test(stripped) && !slideMatch) {
      if (current) slides.push(current);
      current = { title: stripped.replace(/^##\s+/, '').trim(), type: 'content', plan_text: '' };
      continue;
    }

    if (current) {
      current.plan_text += line + '\n';
      const typeMatch = stripped.match(/^-\s*タイプ[:\s：]\s*(.+)/);
      if (typeMatch) {
        const rawType = typeMatch[1].trim().toLowerCase();
        if (rawType === 'cover' || rawType === 'back-cover') {
          current.type = rawType;
        } else if (rawType.includes('back') && rawType.includes('cover')) {
          current.type = 'back-cover';
        } else if (rawType.includes('cover')) {
          current.type = 'cover';
        }
      }
    }
  }

  if (current) slides.push(current);
  return { title, slides };
}

// ============================================================
// Component
// ============================================================

interface HtmlSlideViewerProps {
  open: boolean;
  question: string;
  answer?: string;
  onClose: () => void;
  // History/save support
  deckId?: number;
  savedSlides?: { index: number; title: string; html: string; type: string }[];
  savedPlanMd?: string;
  savedStyleOptions?: StyleOptions;
  forceRegenerate?: boolean;
  onSaveComplete?: (deckId: number) => void;
}

export function HtmlSlideViewer({
  open,
  question,
  answer,
  onClose,
  deckId: initialDeckId,
  savedSlides,
  savedPlanMd,
  savedStyleOptions,
  forceRegenerate,
  onSaveComplete,
}: HtmlSlideViewerProps) {
  // Phase state
  const [phase, setPhase] = useState<Phase>('planning');
  const [error, setError] = useState<string | null>(null);

  // Plan phase
  const [planMd, setPlanMd] = useState<string>('');
  const [deckTitle, setDeckTitle] = useState<string>('');
  const [slideSections, setSlideSections] = useState<SlideSection[]>([]);

  // Generation phase
  const [generatedSlides, setGeneratedSlides] = useState<GeneratedSlide[]>([]);
  const [generatingTotal, setGeneratingTotal] = useState(0);
  const [generatingCompleted, setGeneratingCompleted] = useState(0);

  // Gallery phase
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [editing, setEditing] = useState(false);

  // Save / deck ID
  const [currentDeckId, setCurrentDeckId] = useState<number | undefined>(initialDeckId);
  const [saving, setSaving] = useState(false);

  // Style options (Feature 4)
  const [styleOptions, setStyleOptions] = useState<StyleOptions>(savedStyleOptions || {});

  // Template manager
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [useTemplates, setUseTemplates] = useState(false);

  // Plan diagnostics
  const [planDiag, setPlanDiag] = useState<{ source?: string; model?: string; error?: string; prompt_len?: number; time?: number } | null>(null);

  // Refs
  const abortRef = useRef<AbortController | null>(null);
  const planFetchedRef = useRef(false);
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  // ============================================================
  // Scale calculation
  // ============================================================

  const updateScale = useCallback(() => {
    const el = mainAreaRef.current;
    if (!el) return;
    const padding = 80;
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
  // Phase 1: Generate plan
  // ============================================================

  const fetchPlan = useCallback(async () => {
    setPhase('planning');
    setError(null);
    planFetchedRef.current = true;

    try {
      const hasStyle = !!(styleOptions.industry || styleOptions.profession || styleOptions.ageGroup || styleOptions.colorStyle || styleOptions.font);
      const res = await fetch('/api/slides/htmlslide/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          answer,
          ...(hasStyle ? { style_options: styleOptions } : {}),
        }),
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
      const md = data.plan_md || '';
      setPlanMd(md);

      // Capture diagnostics
      setPlanDiag({
        source: data.plan_source,
        model: data.plan_model,
        error: data.plan_error,
        prompt_len: data.prompt_len,
        time: data.generation_time_seconds,
      });

      const parsed = parsePlanMd(md);
      setDeckTitle(parsed.title);
      setSlideSections(parsed.slides);
      setPhase('plan_ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate plan');
      setPhase('error');
    }
  }, [question, answer, styleOptions]);

  useEffect(() => {
    if (!open) return;

    // If we have savedSlides (from history), skip planning and go straight to done
    if (savedSlides && savedSlides.length > 0 && !forceRegenerate) {
      planFetchedRef.current = true;
      setGeneratedSlides(
        savedSlides.map((s) => ({
          index: s.index,
          title: s.title,
          html: s.html,
          type: s.type,
        })),
      );
      if (savedPlanMd) {
        setPlanMd(savedPlanMd);
        const parsed = parsePlanMd(savedPlanMd);
        setDeckTitle(parsed.title);
        setSlideSections(parsed.slides);
      }
      setPhase('done');
      setActiveSlideIndex(0);
      return;
    }

    if (!planFetchedRef.current) {
      fetchPlan();
    }
  }, [open, fetchPlan, savedSlides, savedPlanMd, forceRegenerate]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      planFetchedRef.current = false;
      setPhase('planning');
      setPlanMd('');
      setDeckTitle('');
      setSlideSections([]);
      setGeneratedSlides([]);
      setGeneratingTotal(0);
      setGeneratingCompleted(0);
      setActiveSlideIndex(0);
      setEditing(false);
      setError(null);
      setCurrentDeckId(initialDeckId);
      setSaving(false);
      setStyleOptions(savedStyleOptions || {});
      setUseTemplates(false);
      setPlanDiag(null);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    }
  }, [open, initialDeckId, savedStyleOptions]);

  // ============================================================
  // Phase 2: Generate HTML slides
  // ============================================================

  const startGeneration = useCallback(async () => {
    if (slideSections.length === 0) return;

    setPhase('generating');
    setError(null);
    setGeneratedSlides([]);
    setGeneratingCompleted(0);
    setGeneratingTotal(slideSections.length);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const slides: GeneratedSlide[] = [];

      for (let i = 0; i < slideSections.length; i++) {
        if (controller.signal.aborted) return;

        const section = slideSections[i];
        // Build style_options if any are set
        const hasStyle = !!(styleOptions.industry || styleOptions.profession || styleOptions.ageGroup || styleOptions.colorStyle || styleOptions.font);
        const res = await fetch('/api/slides/htmlslide/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slide_plan_section: section.plan_text,
            slide_title: section.title,
            slide_index: i,
            total_slides: slideSections.length,
            deck_title: deckTitle,
            slide_type: section.type,
            ...(hasStyle ? { style_options: styleOptions } : {}),
            use_templates: useTemplates,
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
          title: section.title,
          html: data.html || '',
          type: section.type,
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
  }, [slideSections, deckTitle, styleOptions, useTemplates]);

  // ============================================================
  // Editing
  // ============================================================

  useEffect(() => {
    if (!editing || phase !== 'done') return;

    const raf = requestAnimationFrame(() => {
      const container = slideContainerRef.current;
      if (!container) return;

      let editables = container.querySelectorAll('[data-editable="true"]');
      if (editables.length === 0) {
        editables = container.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td, th, span, div');
      }

      editables.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const hasDirectText = Array.from(htmlEl.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0
        );
        if (!hasDirectText && !htmlEl.hasAttribute('data-editable')) return;

        htmlEl.contentEditable = 'true';
        htmlEl.style.cursor = 'text';
        htmlEl.style.outline = 'none';
      });

      const handleFocus = (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.contentEditable === 'true') {
          target.style.outline = '2px solid rgba(20, 184, 166, 0.6)';
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

  const persistCurrentSlide = useCallback(() => {
    const container = slideContainerRef.current;
    if (!container) return;

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
  // Redraw current slide
  // ============================================================

  const [redrawing, setRedrawing] = useState(false);

  const redrawCurrentSlide = useCallback(async () => {
    const slide = generatedSlides[activeSlideIndex];
    if (!slide) return;

    persistCurrentSlide();
    setRedrawing(true);

    try {
      const section = slideSections[activeSlideIndex];
      if (!section) throw new Error('Slide section not found');

      const hasStyle = !!(styleOptions.industry || styleOptions.profession || styleOptions.ageGroup || styleOptions.colorStyle || styleOptions.font);
      const res = await fetch('/api/slides/htmlslide/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slide_plan_section: section.plan_text,
          slide_title: section.title,
          slide_index: activeSlideIndex,
          total_slides: slideSections.length,
          deck_title: deckTitle,
          slide_type: section.type,
          ...(hasStyle ? { style_options: styleOptions } : {}),
          use_templates: useTemplates,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let detail = `HTTP ${res.status}`;
        try { detail = JSON.parse(text).detail || detail; } catch { /* ignore */ }
        throw new Error(detail);
      }

      const data = await res.json();

      setGeneratedSlides((prev) =>
        prev.map((s, i) =>
          i === activeSlideIndex ? { ...s, html: data.html || s.html } : s
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Redraw failed');
    } finally {
      setRedrawing(false);
    }
  }, [generatedSlides, activeSlideIndex, slideSections, deckTitle, styleOptions, useTemplates, persistCurrentSlide]);

  // ============================================================
  // Keyboard navigation
  // ============================================================

  useEffect(() => {
    if (!open || phase !== 'done') return;

    const handler = (e: KeyboardEvent) => {
      if (editing) {
        if (e.key === 'Escape') saveEdits();
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
        scale: 2,
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
      const title = deckTitle || question;

      const pngs: string[] = [];
      for (let i = 0; i < generatedSlides.length; i++) {
        setExportProgress(`画像化中 ${i + 1}/${generatedSlides.length}`);
        const png = await renderSlideToPng(generatedSlides[i].html);
        pngs.push(png);
      }

      setExportProgress('PPTX生成中...');
      const res = await fetch('/api/slides/pptx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, pngs }),
      });

      if (!res.ok) throw new Error(`PPTX export failed: ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(deckTitle || 'slides').replace(/[^a-zA-Z0-9\u3040-\u30ff\u4e00-\u9fff _-]/g, '_')}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
      setExportProgress('');
    }
  }, [generatedSlides, deckTitle, question, renderSlideToPng]);

  // ============================================================
  // PDF Export
  // ============================================================

  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState('');

  const handlePdfExport = useCallback(async () => {
    if (generatedSlides.length === 0) return;
    setExportingPdf(true);
    setPdfProgress('');

    try {
      // Generate PDF entirely client-side (no server round-trip)
      const { jsPDF } = await import('jspdf');
      const SLIDE_W_MM = 338.67;
      const SLIDE_H_MM = 190.5;
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: [SLIDE_W_MM, SLIDE_H_MM],
      });

      for (let i = 0; i < generatedSlides.length; i++) {
        setPdfProgress(`画像化中 ${i + 1}/${generatedSlides.length}`);
        const png = await renderSlideToPng(generatedSlides[i].html);
        if (i > 0) doc.addPage([SLIDE_W_MM, SLIDE_H_MM], 'landscape');
        const base64 = png.includes(',') ? png.split(',')[1] : png;
        doc.addImage(base64, 'PNG', 0, 0, SLIDE_W_MM, SLIDE_H_MM);
      }

      setPdfProgress('PDF保存中...');
      const safeName = (deckTitle || 'slides').replace(/[^a-zA-Z0-9\u3040-\u30ff\u4e00-\u9fff _-]/g, '_');
      doc.save(`${safeName}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF export failed');
    } finally {
      setExportingPdf(false);
      setPdfProgress('');
    }
  }, [generatedSlides, deckTitle, renderSlideToPng]);

  // ============================================================
  // Save to DB
  // ============================================================

  const handleSave = useCallback(async () => {
    if (generatedSlides.length === 0) return;
    setSaving(true);

    try {
      const slidesData = generatedSlides.map((s, i) => ({
        slide_index: i,
        title: s.title,
        slide_type: s.type,
        html: s.html,
        plan_text: slideSections[i]?.plan_text,
      }));

      const styleRecord = styleOptions as Record<string, string | undefined>;

      if (currentDeckId) {
        // Update existing
        await updateSlideDeck(currentDeckId, {
          slides: slidesData,
          style_options: styleRecord,
        });
        onSaveComplete?.(currentDeckId);
      } else {
        // Create new
        const result = await saveSlideDeck({
          title: deckTitle || question,
          question,
          answer,
          plan_md: planMd || undefined,
          style_options: styleRecord,
          slides: slidesData,
        });
        setCurrentDeckId(result.id);
        onSaveComplete?.(result.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [generatedSlides, currentDeckId, deckTitle, question, answer, planMd, slideSections, styleOptions, onSaveComplete]);

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
            <FileCode className="w-5 h-5 text-teal-500" />
            <h2 className="text-base font-semibold text-foreground">
              {deckTitle || 'HTML Slides'}
            </h2>
            {phase === 'generating' && (
              <span className="text-xs text-muted-foreground">
                {generatingCompleted}/{generatingTotal}
              </span>
            )}
            {phase === 'done' && generatedSlides.some(s => s.fallback) && (
              <span className="text-xs text-teal-500 bg-teal-50 px-2 py-0.5 rounded-full">
                {generatedSlides.filter(s => s.fallback).length}枚 フォールバック
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {phase === 'done' && generatedSlides.length > 0 && !editing && (
              <>
                <button
                  onClick={() => setPhase('plan_ready')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  計画に戻る
                </button>
                <button
                  onClick={enableEditing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  編集
                </button>
              </>
            )}
            {editing && (
              <>
                <button
                  onClick={redrawCurrentSlide}
                  disabled={redrawing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-100 text-teal-700 border border-teal-300 hover:bg-teal-200 transition-colors disabled:opacity-50"
                >
                  {redrawing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  再描画
                </button>
                <button
                  onClick={saveEdits}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                >
                  完了
                </button>
              </>
            )}
            {phase === 'done' && generatedSlides.length > 0 && !editing && (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {currentDeckId ? '更新' : '保存'}
                </button>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 text-white hover:bg-teal-600 transition-colors disabled:opacity-50"
                >
                  {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {exportProgress || 'PPTX'}
                </button>
                <button
                  onClick={handlePdfExport}
                  disabled={exportingPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500 text-white hover:bg-rose-600 transition-colors disabled:opacity-50"
                >
                  {exportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                  {pdfProgress || 'PDF'}
                </button>
              </>
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
          {/* Phase: Planning */}
          {phase === 'planning' && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
              <p className="text-sm text-muted-foreground">スライド構成を計画中...</p>
            </div>
          )}

          {/* Phase: Error */}
          {phase === 'error' && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-sm text-destructive">{error}</p>
              <button
                onClick={fetchPlan}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                再試行
              </button>
            </div>
          )}

          {/* Phase: Plan ready */}
          {phase === 'plan_ready' && slideSections.length > 0 && (
            <div className="max-w-3xl mx-auto space-y-5">
              {/* Plan preview */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <FileCode className="w-4 h-4 text-teal-500" />
                  スライド計画 ({slideSections.length}枚)
                </h3>
                {/* Plan diagnostics banner */}
                {planDiag && (
                  <div className={cn(
                    'text-[10px] px-2.5 py-1.5 rounded-md border flex items-center gap-3 flex-wrap',
                    planDiag.source === 'llm'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-amber-50 border-amber-200 text-amber-700',
                  )}>
                    <span className="font-bold">{planDiag.source === 'llm' ? 'LLM生成' : 'フォールバック'}</span>
                    {planDiag.model && <span>model: {planDiag.model}</span>}
                    {planDiag.time != null && <span>{planDiag.time}s</span>}
                    {planDiag.prompt_len != null && <span>prompt: {planDiag.prompt_len}文字</span>}
                    {planDiag.source === 'fallback' && planDiag.error && (
                      <span className="text-red-600">err: {planDiag.error}</span>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  {slideSections.map((section, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-2.5 rounded-lg bg-secondary/30 border border-border/50"
                    >
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground leading-tight">{section.title}</p>
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                            section.type === 'cover' && 'bg-teal-100 text-teal-700',
                            section.type === 'back-cover' && 'bg-teal-100 text-teal-700',
                            section.type === 'content' && 'bg-secondary text-muted-foreground',
                          )}>
                            {section.type}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {section.plan_text.trim().split('\n').slice(0, 2).join(' ')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Raw plan (collapsible) */}
              <details className="group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                  計画の詳細を表示
                </summary>
                <pre className="mt-2 p-3 text-xs bg-secondary/30 border border-border/50 rounded-lg overflow-auto max-h-60 whitespace-pre-wrap font-mono">
                  {planMd}
                </pre>
              </details>

              {/* Style Options + Template Toggle */}
              <div className="flex justify-center items-center gap-2">
                <StyleOptionsPanel value={styleOptions} onChange={setStyleOptions} />
                <button
                  onClick={() => setUseTemplates(!useTemplates)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors',
                    useTemplates
                      ? 'bg-teal-100 text-teal-700 border border-teal-300'
                      : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                >
                  テンプレート{useTemplates ? ' ON' : ''}
                </button>
                <button
                  onClick={() => setTemplateManagerOpen(true)}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
                >
                  管理
                </button>
              </div>

              {/* Buttons */}
              <div className="flex justify-center gap-3 pt-2">
                <button
                  onClick={() => { planFetchedRef.current = false; fetchPlan(); }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl border border-border text-foreground hover:bg-secondary transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  計画を再生成
                </button>
                <button
                  onClick={startGeneration}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-xl bg-teal-500 text-white hover:bg-teal-600 transition-colors shadow-lg shadow-teal-500/20"
                >
                  <Sparkles className="w-4 h-4" />
                  スライドを生成 ({slideSections.length}枚)
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
                    className="h-full bg-teal-500 rounded-full transition-all duration-500"
                    style={{ width: `${generatingTotal > 0 ? (generatingCompleted / generatingTotal) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Grid of generated slides (thumbnail preview) */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {slideSections.map((section, idx) => {
                  const generated = generatedSlides.find((s) => s.index === idx);
                  return (
                    <div
                      key={idx}
                      className={cn(
                        'relative aspect-video rounded-lg border overflow-hidden',
                        generated ? 'border-teal-300' : 'border-border bg-secondary/30'
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
                          <span className="text-[10px] text-muted-foreground">{section.title}</span>
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
                      editing && 'ring-2 ring-teal-400'
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
                  {activeSlide.fallback && <span className="ml-2 text-xs text-teal-500">(フォールバック)</span>}
                  {editing && <span className="ml-2 text-xs text-teal-500">(編集中 - テキストをクリックして編集)</span>}
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
                        ? 'border-teal-500 ring-2 ring-teal-500/30'
                        : 'border-border hover:border-teal-300'
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

        {/* Template Manager modal */}
        <TemplateManager
          open={templateManagerOpen}
          onClose={() => setTemplateManagerOpen(false)}
        />
      </div>
    </div>
  );
}
