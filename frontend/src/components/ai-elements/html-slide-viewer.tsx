'use client';

import { cn } from '@/lib/utils';
import html2canvas from 'html2canvas';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Edit3,
  FileCode,
  FileDown,
  Image,
  Layers,
  Loader2,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  Type,
  Save,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { saveSlideDeck, updateSlideDeck, fetchSlideTemplates, type SlideTemplate } from '@/lib/api';
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
  | 'setup'
  | 'planning'
  | 'plan_ready'
  | 'generating'
  | 'done'
  | 'error';

// Slide dimensions (px)
const SLIDE_W = 1280;
const SLIDE_H = 720;

// Font family presets
const FONT_PRESETS = [
  { label: 'ゴシック体', css: 'Noto Sans JP, Hiragino Sans, sans-serif' },
  { label: '明朝体', css: 'Noto Serif JP, Hiragino Mincho ProN, serif' },
  { label: '丸ゴシック', css: 'Rounded Mplus 1c, Noto Sans JP, sans-serif' },
  { label: 'モノスペース', css: 'Source Code Pro, Noto Sans Mono, monospace' },
] as const;

// Drag-to-move + Resize CSS (injected during editing only)
// Uses JS-driven [data-hovered] instead of CSS :hover for reliable hover after transforms
const DRAG_CSS = `
[data-draggable] { overflow:visible !important; }
[data-draggable][data-hovered] > [data-drag-toolbar] { opacity:1 !important }
[data-draggable][data-hovered] > [data-resize] { opacity:1 !important }
[data-draggable][data-selected] { outline:2px solid rgba(59,130,246,0.6) !important; outline-offset:2px !important; }
[data-drag-toolbar] {
  position:absolute; top:-6px; left:-6px; z-index:100;
  display:flex; align-items:center; gap:2px;
  opacity:0; transition:opacity .15s; pointer-events:auto;
}
[data-drag-toolbar] > [data-drag-handle] {
  width:22px; height:22px;
  background:rgba(255,255,255,0.95); border:1px solid rgba(0,0,0,0.12);
  border-radius:5px; display:flex; align-items:center; justify-content:center;
  cursor:grab; box-shadow:0 1px 3px rgba(0,0,0,0.1);
}
[data-drag-handle]:active { cursor:grabbing }
[data-drag-toolbar] > [data-block-action] {
  width:20px; height:20px;
  background:rgba(255,255,255,0.95); border:1px solid rgba(0,0,0,0.10);
  border-radius:4px; display:flex; align-items:center; justify-content:center;
  cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.08);
  transition:background .1s;
}
[data-block-action]:hover { background:rgba(230,230,230,0.95) !important }
[data-block-action="delete"]:hover { background:rgba(254,202,202,0.95) !important }
[data-block-menu] {
  position:absolute; top:24px; left:0; z-index:200;
  background:rgba(255,255,255,0.98); border:1px solid rgba(0,0,0,0.12);
  border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.15);
  padding:3px; min-width:110px;
}
[data-block-menu] > [data-block-action] {
  width:auto; height:auto; border:none; box-shadow:none;
  display:flex; align-items:center; gap:6px; padding:5px 10px;
  border-radius:4px; cursor:pointer; font-size:11px; white-space:nowrap;
  background:transparent; color:#374151;
}
[data-block-menu] > [data-block-action]:hover { background:rgba(0,0,0,0.05) !important }
[data-block-menu] > [data-block-action="delete"]:hover { background:rgba(254,202,202,0.5) !important }
[data-dragging] {
  outline:2px dashed rgba(20,184,166,0.5) !important;
  outline-offset:2px !important; opacity:0.85;
}
[data-resize] {
  position:absolute; background:white; border:1.5px solid rgba(20,184,166,0.7);
  border-radius:2px; z-index:101; opacity:0; transition:opacity .15s; pointer-events:auto;
  box-shadow:0 0 2px rgba(0,0,0,0.1);
}
[data-resize="se"],[data-resize="nw"],[data-resize="ne"],[data-resize="sw"] { width:8px; height:8px; }
[data-resize="se"] { bottom:-4px; right:-4px; cursor:se-resize; }
[data-resize="sw"] { bottom:-4px; left:-4px; cursor:sw-resize; }
[data-resize="ne"] { top:-4px; right:-4px; cursor:ne-resize; }
[data-resize="nw"] { top:-4px; left:-4px; cursor:nw-resize; }
[data-resize="e"],[data-resize="w"] { width:6px; height:20px; top:50%; margin-top:-10px; }
[data-resize="n"],[data-resize="s"] { height:6px; width:20px; left:50%; margin-left:-10px; }
[data-resize="e"] { right:-3px; cursor:e-resize; }
[data-resize="w"] { left:-3px; cursor:w-resize; }
[data-resize="n"] { top:-3px; cursor:n-resize; }
[data-resize="s"] { bottom:-3px; cursor:s-resize; }
[data-resizing] {
  outline:2px solid rgba(20,184,166,0.6) !important;
  outline-offset:1px !important;
}`;

const GRIP_SVG = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="3" r="1.5" fill="#9CA3AF"/><circle cx="10" cy="3" r="1.5" fill="#9CA3AF"/><circle cx="4" cy="7" r="1.5" fill="#9CA3AF"/><circle cx="10" cy="7" r="1.5" fill="#9CA3AF"/><circle cx="4" cy="11" r="1.5" fill="#9CA3AF"/><circle cx="10" cy="11" r="1.5" fill="#9CA3AF"/></svg>`;
const COPY_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const TRASH_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const REPLACE_IMG_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
const BG_REPLACE_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M2 17l5-5 4 4 3-3 8 8"/><circle cx="8" cy="8" r="2"/></svg>`;
const MENU_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="#6B7280"><circle cx="12" cy="5" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="19" r="2.5"/></svg>`;

// ============================================================
// Drag helpers (module-level, no React state)
// ============================================================

const SKIP_TAGS = new Set(['script', 'style', 'br', 'hr']);
const LEAF_TAGS = new Set(['table', 'svg', 'img', 'canvas', 'video', 'iframe']);

function findDraggableBlocks(container: HTMLElement): HTMLElement[] {
  // Find actual root slide div — skip <style> and injected drag elements
  let root: HTMLElement | null = null;
  for (const child of Array.from(container.children) as HTMLElement[]) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'style' || child.hasAttribute('data-drag-toolbar') || child.hasAttribute('data-resize')) continue;
    root = child;
    break;
  }
  if (!root) return [];

  const results: HTMLElement[] = [];

  const isInjected = (el: Element) =>
    el.hasAttribute('data-drag-toolbar') || el.hasAttribute('data-resize');

  // Count real (non-injected, non-skip) children that meet minimum size
  const significantChildren = (parent: HTMLElement): HTMLElement[] =>
    (Array.from(parent.children) as HTMLElement[]).filter((c) => {
      if (isInjected(c)) return false;
      const t = c.tagName.toLowerCase();
      if (SKIP_TAGS.has(t)) return false;
      return c.offsetHeight >= 20 && c.offsetWidth >= 40;
    });

  const collect = (parent: HTMLElement, depth: number) => {
    if (depth > 6) return;
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      const tag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (isInjected(child)) continue;
      // Use relaxed size threshold for images/icons (allow small icons ≥ 8px)
      const isMedia = LEAF_TAGS.has(tag);
      const minH = isMedia ? 8 : 20;
      const minW = isMedia ? 8 : 40;
      if (child.offsetHeight < minH || child.offsetWidth < minW) continue;

      // Tables, SVGs, images — always leaf blocks (no recursion)
      if (isMedia) {
        results.push(child);
        continue;
      }

      const sigKids = significantChildren(child);
      // Large block: >50% of slide width(1280) or height(720) → always try to recurse deeper
      const isLarge = child.offsetWidth > 640 || child.offsetHeight > 360;

      // Push this element as a draggable block
      results.push(child);

      // ALSO recurse into children when:
      // - 2+ significant children (composite block), OR
      // - large block with 1+ significant children (try to break it down)
      if (depth < 6 && (sigKids.length >= 2 || (isLarge && sigKids.length >= 1))) {
        collect(child, depth + 1);
      }
    }
  };

  collect(root, 0);
  return results;
}

function applyDragTranslate(el: HTMLElement, dx: number, dy: number) {
  const prevDx = parseFloat(el.dataset.dragX || '0');
  const prevDy = parseFloat(el.dataset.dragY || '0');
  const newDx = prevDx + dx;
  const newDy = prevDy + dy;
  el.dataset.dragX = String(newDx);
  el.dataset.dragY = String(newDy);
  if (!el.dataset.dragOrigTransform) {
    el.dataset.dragOrigTransform = el.style.transform || '';
  }
  const orig = el.dataset.dragOrigTransform;
  el.style.transform = orig
    ? `translate(${newDx}px,${newDy}px) ${orig}`
    : `translate(${newDx}px,${newDy}px)`;
}

function setupDragHandles(container: HTMLElement) {
  // Inject drag CSS
  const styleId = '__drag-styles';
  if (!container.querySelector(`#${styleId}`)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = DRAG_CSS;
    container.prepend(style);
  }

  const blocks = findDraggableBlocks(container);

  for (let el of blocks) {
    if (el.hasAttribute('data-draggable')) continue;

    // Void elements (img, canvas, video, iframe) can't hold children.
    // Wrap them in a <div> so toolbar + resize handles can be rendered.
    const VOID_DRAG = new Set(['img', 'svg', 'canvas', 'video', 'iframe']);
    const rawTag = el.tagName.toLowerCase();
    if (VOID_DRAG.has(rawTag)) {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-img-wrapper', '');
      // Copy positioning & size from the original element
      const cs = window.getComputedStyle(el);
      wrapper.style.position = cs.position === 'static' ? 'relative' : cs.position;
      wrapper.style.top = el.style.top || '';
      wrapper.style.right = el.style.right || '';
      wrapper.style.left = el.style.left || '';
      wrapper.style.bottom = el.style.bottom || '';
      wrapper.style.width = el.style.width || `${el.offsetWidth}px`;
      wrapper.style.height = el.style.height || `${el.offsetHeight}px`;
      wrapper.style.zIndex = el.style.zIndex || '';
      wrapper.style.display = 'inline-block';
      // Transfer transform / drag data
      if (el.style.transform) { wrapper.style.transform = el.style.transform; el.style.transform = ''; }
      if (el.dataset.dragX) { wrapper.dataset.dragX = el.dataset.dragX; delete el.dataset.dragX; }
      if (el.dataset.dragY) { wrapper.dataset.dragY = el.dataset.dragY; delete el.dataset.dragY; }
      if (el.dataset.dragOrigTransform) { wrapper.dataset.dragOrigTransform = el.dataset.dragOrigTransform; delete el.dataset.dragOrigTransform; }
      // Replace element with wrapper, put element inside
      el.replaceWith(wrapper);
      el.style.position = '';
      el.style.top = '';
      el.style.right = '';
      el.style.left = '';
      el.style.bottom = '';
      el.style.zIndex = '';
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.display = 'block';
      wrapper.appendChild(el);
      el = wrapper; // toolbar/resize go on the wrapper
    }

    el.setAttribute('data-draggable', '');

    // Ensure positioning context for the toolbar
    const cs = window.getComputedStyle(el);
    if (cs.position === 'static') {
      el.style.position = 'relative';
      el.setAttribute('data-drag-pos', '');
    }

    // Detect what actions this block supports
    const hasContentMedia = (() => {
      if (el.hasAttribute('data-img-wrapper')) return true;
      // Check for img/svg in non-injected children (toolbar not prepended yet)
      return !!(el.querySelector('img') || el.querySelector('svg'));
    })();
    const isSlideSize = el.offsetWidth >= SLIDE_W * 0.9 && el.offsetHeight >= SLIDE_H * 0.9;
    // Store capabilities on the block for the menu handler
    if (hasContentMedia) el.setAttribute('data-can-replace', '');
    if (isSlideSize) el.setAttribute('data-can-bg', '');

    // Toolbar: drag handle + ⋮ menu button (compact: only 2 icons)
    const toolbar = document.createElement('div');
    toolbar.setAttribute('data-drag-toolbar', '');
    toolbar.style.position = 'absolute';

    const grip = document.createElement('div');
    grip.setAttribute('data-drag-handle', '');
    grip.innerHTML = GRIP_SVG;

    const menuBtn = document.createElement('div');
    menuBtn.setAttribute('data-block-action', 'menu');
    menuBtn.title = 'メニュー';
    menuBtn.innerHTML = MENU_SVG;

    toolbar.append(grip, menuBtn);

    el.prepend(toolbar);

    // Resize handles: 4 corners + 4 edges
    for (const dir of ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']) {
      const rh = document.createElement('div');
      rh.setAttribute('data-resize', dir);
      el.appendChild(rh);
    }
  }
}

function cleanupDragHandles(container: HTMLElement) {
  container.querySelectorAll('[data-drag-toolbar]').forEach((el) => el.remove());
  container.querySelectorAll('[data-resize]').forEach((el) => el.remove());
  container.querySelectorAll('[data-block-menu]').forEach((el) => el.remove());
  container.querySelectorAll('[data-draggable]').forEach((el) => {
    el.removeAttribute('data-draggable');
    el.removeAttribute('data-dragging');
    el.removeAttribute('data-resizing');
    el.removeAttribute('data-hovered');
    el.removeAttribute('data-selected');
    el.removeAttribute('data-can-replace');
    el.removeAttribute('data-can-bg');
    // Clean up temporary resize tracking attributes (keep width/height/transform inline styles)
    (el as HTMLElement).removeAttribute('data-resize-orig-w');
    (el as HTMLElement).removeAttribute('data-resize-orig-h');
    (el as HTMLElement).removeAttribute('data-resize-temp-dx');
    (el as HTMLElement).removeAttribute('data-resize-temp-dy');
  });
  // Unwrap img wrappers: transfer wrapper's position/size/transform back to the child element
  container.querySelectorAll('[data-img-wrapper]').forEach((wrapper) => {
    const w = wrapper as HTMLElement;
    const child = w.querySelector('img, svg, canvas, video, iframe') as HTMLElement | null;
    if (child) {
      child.style.position = w.style.position || '';
      child.style.top = w.style.top || '';
      child.style.right = w.style.right || '';
      child.style.left = w.style.left || '';
      child.style.bottom = w.style.bottom || '';
      child.style.width = w.style.width || '';
      child.style.height = w.style.height || '';
      child.style.zIndex = w.style.zIndex || '';
      child.style.transform = w.style.transform || '';
      child.style.display = '';
      // Transfer drag data
      if (w.dataset.dragX) { child.dataset.dragX = w.dataset.dragX; }
      if (w.dataset.dragY) { child.dataset.dragY = w.dataset.dragY; }
      if (w.dataset.dragOrigTransform) { child.dataset.dragOrigTransform = w.dataset.dragOrigTransform; }
      w.replaceWith(child);
    }
  });
  container.querySelectorAll('[data-drag-pos]').forEach((el) => {
    (el as HTMLElement).style.position = '';
    el.removeAttribute('data-drag-pos');
  });
  const dragStyle = container.querySelector('#__drag-styles');
  if (dragStyle) dragStyle.remove();
}

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
  const [phase, setPhase] = useState<Phase>('setup');
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
  const [styleOptions, setStyleOptions] = useState<StyleOptions>({
    font: 'ゴシック体 (Noto Sans JP, Hiragino Sans)',
    ...savedStyleOptions,
  });

  // Editing: global font family (ref to avoid re-render during editing)
  const editFontRef = useRef('Noto Sans JP, Hiragino Sans, sans-serif');

  // Template manager
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [useTemplates, setUseTemplates] = useState(false);
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState(false);
  const [templateWarning, setTemplateWarning] = useState<string | null>(null);
  const [templateList, setTemplateList] = useState<SlideTemplate[]>([]);

  // Plan diagnostics
  const [planDiag, setPlanDiag] = useState<{ source?: string; model?: string; error?: string; prompt_len?: number; time?: number } | null>(null);

  // Refs
  const abortRef = useRef<AbortController | null>(null);
  const planFetchedRef = useRef(false);
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const lastFocusedEditableRef = useRef<HTMLElement | null>(null);
  const scaleRef = useRef(0.5);
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
    const s = Math.max(0.1, Math.min(availW / SLIDE_W, availH / SLIDE_H, 1));
    scaleRef.current = s;
    setScale(s);
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

  // Load template list for setup display
  const refreshTemplateList = useCallback(async () => {
    try {
      const items = await fetchSlideTemplates();
      setTemplateList(items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase === 'setup' && open) refreshTemplateList();
  }, [phase, open, refreshTemplateList]);

  // Also refresh when template manager closes
  useEffect(() => {
    if (!templateManagerOpen && phase === 'setup') refreshTemplateList();
  }, [templateManagerOpen, phase, refreshTemplateList]);

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
      setHasGeneratedOnce(true);
      setPhase('plan_ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate plan');
      setPhase('error');
    }
  }, [question, answer, styleOptions]);

  const handlePlanGenerate = useCallback(async () => {
    setTemplateWarning(null);
    if (useTemplates) {
      try {
        const templates = await fetchSlideTemplates();
        if (!templates || templates.length === 0) {
          setTemplateWarning('テンプレートがアップロードされていません。「管理」からアップロードしてください。');
          return;
        }
      } catch {
        setTemplateWarning('テンプレートの確認に失敗しました。');
        return;
      }
    }
    planFetchedRef.current = false;
    fetchPlan();
  }, [useTemplates, fetchPlan]);

  const toggleTemplates = useCallback(() => {
    setUseTemplates(prev => !prev);
    setTemplateWarning(null);
  }, []);

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

    // Stay in 'setup' phase — don't auto-fetch plan
  }, [open, savedSlides, savedPlanMd, forceRegenerate]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      planFetchedRef.current = false;
      setPhase('setup');
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
      setHasGeneratedOnce(false);
      setTemplateWarning(null);
      editFontRef.current = 'Noto Sans JP, Hiragino Sans, sans-serif';
      document.getElementById('__font-override-head')?.remove();
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

    const container = slideContainerRef.current;
    if (!container) return;

    // Set up contentEditable on text elements
    const setup = () => {
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

      // Set up drag handles on block elements
      setupDragHandles(container);
    };

    // -- contentEditable focus/blur --
    const handleFocus = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.contentEditable === 'true') {
        lastFocusedEditableRef.current = target;
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

    // -- JS-based hover tracking (reliable after transforms, replaces CSS :hover) --
    let hoveredBlock: HTMLElement | null = null;
    const onHoverMove = (e: MouseEvent) => {
      const block = (e.target as HTMLElement).closest('[data-draggable]') as HTMLElement | null;
      if (block === hoveredBlock) return;
      if (hoveredBlock) hoveredBlock.removeAttribute('data-hovered');
      if (block) block.setAttribute('data-hovered', '');
      hoveredBlock = block;
    };
    const onHoverLeave = () => {
      if (hoveredBlock) { hoveredBlock.removeAttribute('data-hovered'); hoveredBlock = null; }
    };

    // -- Shift+click multi-select --
    const selectedBlocks = new Set<HTMLElement>();
    const onShiftClick = (e: MouseEvent) => {
      if (!e.shiftKey) return;
      const target = e.target as HTMLElement;
      // Don't interfere with text editing or toolbar buttons
      if (target.contentEditable === 'true' || target.closest('[contenteditable="true"]')) return;
      if (target.closest('[data-drag-toolbar]') || target.closest('[data-resize]')) return;
      const block = target.closest('[data-draggable]') as HTMLElement | null;
      if (!block) return;
      e.preventDefault();
      if (selectedBlocks.has(block)) {
        selectedBlocks.delete(block);
        block.removeAttribute('data-selected');
      } else {
        selectedBlocks.add(block);
        block.setAttribute('data-selected', '');
      }
    };
    // Clear selection on Escape
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedBlocks.size > 0) {
        for (const b of selectedBlocks) b.removeAttribute('data-selected');
        selectedBlocks.clear();
      }
    };

    // -- Drag-to-move + Copy/Delete --
    let dragging = false;
    let dragEl: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;

    const onDragMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Action buttons (direct or from popup menu)
      const actionBtn = target.closest('[data-block-action]') as HTMLElement | null;
      if (actionBtn) {
        e.preventDefault();
        e.stopPropagation();
        const block = actionBtn.closest('[data-draggable]') as HTMLElement | null;
        if (!block) return;
        const action = actionBtn.getAttribute('data-block-action');

        // Close any open popup menu (except when opening one)
        if (action !== 'menu') {
          container.querySelectorAll('[data-block-menu]').forEach(m => m.remove());
        }

        // ⋮ Menu toggle
        if (action === 'menu') {
          const toolbar = actionBtn.closest('[data-drag-toolbar]') as HTMLElement;
          const existing = toolbar?.querySelector('[data-block-menu]');
          // Close all menus first
          container.querySelectorAll('[data-block-menu]').forEach(m => m.remove());
          if (existing) return; // was open, now closed (toggle)

          const menu = document.createElement('div');
          menu.setAttribute('data-block-menu', '');

          // Copy
          const copyItem = document.createElement('div');
          copyItem.setAttribute('data-block-action', 'copy');
          copyItem.innerHTML = `${COPY_SVG}<span>コピー</span>`;
          menu.append(copyItem);

          // Delete
          const delItem = document.createElement('div');
          delItem.setAttribute('data-block-action', 'delete');
          delItem.innerHTML = `${TRASH_SVG}<span>削除</span>`;
          menu.append(delItem);

          // Replace image (if block has media content or is non-text icon group)
          if (block.hasAttribute('data-can-replace')) {
            const replItem = document.createElement('div');
            replItem.setAttribute('data-block-action', 'replace-image');
            replItem.innerHTML = `${REPLACE_IMG_SVG}<span>アイコン入れ替え</span>`;
            menu.append(replItem);
          }

          // Background replace (if slide-sized)
          if (block.hasAttribute('data-can-bg')) {
            const bgItem = document.createElement('div');
            bgItem.setAttribute('data-block-action', 'replace-bg');
            bgItem.innerHTML = `${BG_REPLACE_SVG}<span>背景入れ替え</span>`;
            menu.append(bgItem);
          }

          toolbar.append(menu);

          // Close menu on click outside
          const closeMenu = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
              menu.remove();
              document.removeEventListener('mousedown', closeMenu, true);
            }
          };
          setTimeout(() => document.addEventListener('mousedown', closeMenu, true), 0);
          return;
        }

        if (action === 'delete') {
          selectedBlocks.delete(block);
          block.remove();
          return;
        }

        if (action === 'replace-image') {
          // Find the actual img/svg target inside the block, skipping toolbar injections
          let imgTarget: HTMLElement | null = null;
          const candidates = block.querySelectorAll('img, svg');
          for (const m of Array.from(candidates)) {
            if (m.closest('[data-drag-toolbar]') || m.closest('[data-block-action]') || m.closest('[data-block-menu]')) continue;
            imgTarget = m as HTMLElement;
            break;
          }
          // If no img/svg found, the block itself is the target (non-text icon group)
          const replaceTarget = imgTarget || block;
          const targetRect = replaceTarget.getBoundingClientRect();

          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/svg+xml,image/png,image/jpeg,image/gif,image/webp';
          input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              const tTag = replaceTarget.tagName.toLowerCase();
              if (tTag === 'img') {
                // Swap src, keep size
                (replaceTarget as HTMLImageElement).src = dataUrl;
              } else {
                // Replace any element (svg, div, etc.) with an <img>
                const newImg = document.createElement('img');
                newImg.src = dataUrl;
                newImg.style.width = replaceTarget.style.width || `${targetRect.width}px`;
                newImg.style.height = replaceTarget.style.height || `${targetRect.height}px`;
                replaceTarget.replaceWith(newImg);
              }
              // Rebuild drag handles
              requestAnimationFrame(() => {
                cleanupDragHandles(container);
                setupDragHandles(container);
              });
            };
            reader.readAsDataURL(file);
          };
          input.click();
          return;
        }

        if (action === 'replace-bg') {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/svg+xml,image/png,image/jpeg,image/gif,image/webp';
          input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              block.style.backgroundImage = `url(${dataUrl})`;
              block.style.backgroundSize = 'cover';
              block.style.backgroundPosition = 'center';
              block.style.backgroundRepeat = 'no-repeat';
            };
            reader.readAsDataURL(file);
          };
          input.click();
          return;
        }

        if (action === 'copy') {
          const clone = block.cloneNode(true) as HTMLElement;
          // Remove toolbar & resize handles from clone (will be re-created by setupDragHandles)
          clone.querySelectorAll('[data-drag-toolbar]').forEach(el => el.remove());
          clone.querySelectorAll('[data-resize]').forEach(el => el.remove());
          clone.removeAttribute('data-draggable');
          clone.removeAttribute('data-drag-pos');
          clone.removeAttribute('data-hovered');
          clone.removeAttribute('data-selected');
          // Offset the clone slightly so it's visually distinct
          const prevDx = parseFloat(clone.dataset.dragX || '0');
          const prevDy = parseFloat(clone.dataset.dragY || '0');
          clone.dataset.dragX = String(prevDx + 20);
          clone.dataset.dragY = String(prevDy + 20);
          const orig = clone.dataset.dragOrigTransform || '';
          clone.style.transform = orig
            ? `translate(${prevDx + 20}px,${prevDy + 20}px) ${orig}`
            : `translate(${prevDx + 20}px,${prevDy + 20}px)`;
          block.parentElement?.insertBefore(clone, block.nextSibling);
          // Re-run drag handles to pick up the new element
          setupDragHandles(container);
          return;
        }
        return;
      }

      // Drag handle
      const handle = target.closest('[data-drag-handle]');
      if (!handle) return;
      e.preventDefault();
      e.stopPropagation();
      const block = handle.closest('[data-draggable]') as HTMLElement | null;
      if (!block) return;
      dragging = true;
      dragEl = block;
      startX = e.clientX;
      startY = e.clientY;
      dragEl.setAttribute('data-dragging', '');
      // If dragging a selected block, also mark all selected as dragging
      if (selectedBlocks.has(block)) {
        for (const b of selectedBlocks) { if (b !== block) b.setAttribute('data-dragging', ''); }
      }
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    };

    const onDragMouseMove = (e: MouseEvent) => {
      if (!dragging || !dragEl) return;
      e.preventDefault();
      const s = scaleRef.current;
      const dx = (e.clientX - startX) / s;
      const dy = (e.clientY - startY) / s;
      startX = e.clientX;
      startY = e.clientY;
      applyDragTranslate(dragEl, dx, dy);
      // Move all selected blocks together
      if (selectedBlocks.has(dragEl)) {
        for (const b of selectedBlocks) {
          if (b !== dragEl) applyDragTranslate(b, dx, dy);
        }
      }
    };

    const onDragMouseUp = () => {
      if (!dragging || !dragEl) return;
      dragEl.removeAttribute('data-dragging');
      if (selectedBlocks.has(dragEl)) {
        for (const b of selectedBlocks) b.removeAttribute('data-dragging');
      }
      dragging = false;
      dragEl = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    // -- Resize --
    let resizing = false;
    let resizeEl: HTMLElement | null = null;
    let resizeDir = '';
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeInitW = 0;
    let resizeInitH = 0;

    const onResizeMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const handle = target.closest('[data-resize]') as HTMLElement | null;
      if (!handle) return;
      const block = handle.closest('[data-draggable]') as HTMLElement | null;
      if (!block) return;
      e.preventDefault();
      e.stopPropagation();
      resizing = true;
      resizeEl = block;
      resizeDir = handle.getAttribute('data-resize') || 'se';
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeInitW = block.offsetWidth;
      resizeInitH = block.offsetHeight;
      block.setAttribute('data-resizing', '');
      document.body.style.cursor = `${resizeDir}-resize`;
      document.body.style.userSelect = 'none';
    };

    const onResizeMouseMove = (e: MouseEvent) => {
      if (!resizing || !resizeEl) return;
      e.preventDefault();
      const s = scaleRef.current;
      const rawDx = (e.clientX - resizeStartX) / s;
      const rawDy = (e.clientY - resizeStartY) / s;

      let newW = resizeInitW;
      let newH = resizeInitH;
      let translateDx = 0;
      let translateDy = 0;

      const dir = resizeDir;
      if (dir.includes('e')) { newW = Math.max(48, resizeInitW + rawDx); }
      if (dir.includes('w')) { newW = Math.max(48, resizeInitW - rawDx); translateDx = resizeInitW - newW; }
      if (dir.includes('s')) { newH = Math.max(24, resizeInitH + rawDy); }
      if (dir.includes('n')) { newH = Math.max(24, resizeInitH - rawDy); translateDy = resizeInitH - newH; }

      resizeEl.style.width = `${newW}px`;
      resizeEl.style.height = `${newH}px`;
      if (!resizeEl.dataset.resizeOrigW) {
        resizeEl.dataset.resizeOrigW = String(resizeInitW);
        resizeEl.dataset.resizeOrigH = String(resizeInitH);
      }

      // For n/w directions, shift position to keep opposite corner fixed
      if (translateDx !== 0 || translateDy !== 0) {
        const baseDx = parseFloat(resizeEl.dataset.dragX || '0');
        const baseDy = parseFloat(resizeEl.dataset.dragY || '0');
        const origTransform = resizeEl.dataset.dragOrigTransform || '';
        const totalDx = baseDx + translateDx;
        const totalDy = baseDy + translateDy;
        resizeEl.style.transform = origTransform
          ? `translate(${totalDx}px,${totalDy}px) ${origTransform}`
          : `translate(${totalDx}px,${totalDy}px)`;
        resizeEl.dataset.resizeTempDx = String(translateDx);
        resizeEl.dataset.resizeTempDy = String(translateDy);
      }
    };

    const onResizeMouseUp = () => {
      if (!resizing || !resizeEl) return;
      resizeEl.removeAttribute('data-resizing');
      const tempDx = parseFloat(resizeEl.dataset.resizeTempDx || '0');
      const tempDy = parseFloat(resizeEl.dataset.resizeTempDy || '0');
      if (tempDx !== 0 || tempDy !== 0) {
        const baseDx = parseFloat(resizeEl.dataset.dragX || '0');
        const baseDy = parseFloat(resizeEl.dataset.dragY || '0');
        resizeEl.dataset.dragX = String(baseDx + tempDx);
        resizeEl.dataset.dragY = String(baseDy + tempDy);
      }
      delete resizeEl.dataset.resizeTempDx;
      delete resizeEl.dataset.resizeTempDy;
      resizing = false;
      resizeEl = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const raf = requestAnimationFrame(setup);
    container.addEventListener('focusin', handleFocus);
    container.addEventListener('focusout', handleBlur);
    container.addEventListener('mouseover', onHoverMove);
    container.addEventListener('mouseleave', onHoverLeave);
    container.addEventListener('click', onShiftClick);
    container.addEventListener('mousedown', onDragMouseDown);
    container.addEventListener('mousedown', onResizeMouseDown);
    document.addEventListener('mousemove', onDragMouseMove);
    document.addEventListener('mousemove', onResizeMouseMove);
    document.addEventListener('mouseup', onDragMouseUp);
    document.addEventListener('mouseup', onResizeMouseUp);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('focusin', handleFocus);
      container.removeEventListener('focusout', handleBlur);
      container.removeEventListener('mouseover', onHoverMove);
      container.removeEventListener('mouseleave', onHoverLeave);
      container.removeEventListener('click', onShiftClick);
      container.removeEventListener('mousedown', onDragMouseDown);
      container.removeEventListener('mousedown', onResizeMouseDown);
      document.removeEventListener('mousemove', onDragMouseMove);
      document.removeEventListener('mousemove', onResizeMouseMove);
      document.removeEventListener('mouseup', onDragMouseUp);
      document.removeEventListener('mouseup', onResizeMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      cleanupDragHandles(container);
    };
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

    // Remove drag UI elements (keep position data: transform, data-drag-x/y)
    cleanupDragHandles(container);

    const updatedHtml = container.innerHTML;

    // Apply font override to ALL slides (current from DOM, others from state)
    const cssFont = editFontRef.current;
    const overrideTag = `<style id="__font-override">* { font-family: ${cssFont} !important; }</style>`;
    setGeneratedSlides((prev) =>
      prev.map((s, i) => {
        if (i === activeSlideIndex) return { ...s, html: updatedHtml };
        const cleaned = s.html.replace(/<style id="__font-override">[^<]*<\/style>/g, '');
        return { ...s, html: overrideTag + cleaned };
      })
    );
  }, [activeSlideIndex]);

  const saveEdits = useCallback(() => {
    persistCurrentSlide();
    setEditing(false);

    // Remove the head-injected font style (no longer needed after editing)
    document.getElementById('__font-override-head')?.remove();
    slideContainerRef.current?.removeAttribute('data-slide-editing');

    // Apply font override to all slides on save (persisted in HTML)
    const cssFont = editFontRef.current;
    const overrideTag = `<style id="__font-override">* { font-family: ${cssFont} !important; }</style>`;
    setGeneratedSlides(prev =>
      prev.map(s => {
        const cleaned = s.html.replace(/<style id="__font-override">[^<]*<\/style>/g, '');
        return { ...s, html: overrideTag + cleaned };
      })
    );
  }, [persistCurrentSlide]);

  // Global font change: inject into <head> for reliable CSS application
  // Uses document.head (not container) because <style> inside dangerouslySetInnerHTML
  // can be unreliable across browsers. Scoped via data attribute on the container.
  const applyGlobalFont = useCallback((cssFont: string) => {
    editFontRef.current = cssFont;

    const container = slideContainerRef.current;
    if (!container) return;

    // Mark container for CSS scoping
    container.setAttribute('data-slide-editing', '');

    const styleId = '__font-override-head';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `[data-slide-editing] * { font-family: ${cssFont} !important; }`;
  }, []);

  // Per-element font size adjustment (uses last focused element ref)
  const adjustFocusedFontSize = useCallback((delta: number) => {
    const target = lastFocusedEditableRef.current;
    if (!target || !slideContainerRef.current?.contains(target)) return;
    const computed = window.getComputedStyle(target);
    const current = parseFloat(computed.fontSize) || 16;
    const next = Math.max(8, Math.min(120, current + delta));
    target.style.fontSize = `${next}px`;
  }, []);

  // ============================================================
  // Insert uploaded image/icon into current slide (top-right)
  // ============================================================

  const insertUploadedImage = useCallback(() => {
    const container = slideContainerRef.current;
    if (!container) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/svg+xml,image/png,image/jpeg,image/gif,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const tmpImg = new window.Image();
        tmpImg.onload = () => {
          let w = tmpImg.naturalWidth;
          let h = tmpImg.naturalHeight;
          const maxW = SLIDE_W / 2;
          const maxH = SLIDE_H / 2;
          if (w > maxW || h > maxH) {
            const scale = Math.min(maxW / w, maxH / h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          // Find the root slide element (skip <style> and drag injections)
          let root: HTMLElement | null = null;
          for (const child of Array.from(container.children) as HTMLElement[]) {
            const tag = child.tagName.toLowerCase();
            if (tag === 'style' || child.hasAttribute('data-drag-toolbar') || child.hasAttribute('data-resize')) continue;
            root = child;
            break;
          }
          if (!root) return;

          const img = document.createElement('img');
          img.style.position = 'absolute';
          img.style.top = '20px';
          img.style.right = '20px';
          img.style.width = `${w}px`;
          img.style.height = `${h}px`;
          img.style.zIndex = '10';
          // Ensure root has positioning context
          const rootPos = window.getComputedStyle(root).position;
          if (rootPos === 'static') root.style.position = 'relative';
          root.appendChild(img);
          img.src = dataUrl;
          // Wait for image to load, then re-init drag handles (wrapper needs layout dimensions)
          const reinit = () => {
            cleanupDragHandles(container);
            setupDragHandles(container);
          };
          img.onload = () => requestAnimationFrame(reinit);
          // Fallback if image loads from cache synchronously
          if (img.complete) requestAnimationFrame(reinit);
        };
        tmpImg.src = dataUrl;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, []);

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
            {phase === 'plan_ready' && (
              <button
                onClick={() => setPhase('setup')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                設定に戻る
              </button>
            )}
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
                {/* Font family selector (global) */}
                <div className="flex items-center gap-1 border border-border rounded-lg px-1 py-0.5">
                  <Type className="w-3 h-3 text-muted-foreground" />
                  <select
                    defaultValue={editFontRef.current}
                    onChange={(e) => applyGlobalFont(e.target.value)}
                    className="text-[11px] bg-transparent text-foreground outline-none cursor-pointer pr-1"
                  >
                    {FONT_PRESETS.map(f => (
                      <option key={f.label} value={f.css}>{f.label}</option>
                    ))}
                  </select>
                </div>

                {/* Font size adjustment (per element) */}
                <div className="flex items-center gap-0.5 border border-border rounded-lg px-1 py-0.5">
                  <button
                    onMouseDown={(e) => { e.preventDefault(); adjustFocusedFontSize(-2); }}
                    className="p-0.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                    title="文字サイズ -2px"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-[10px] text-muted-foreground px-0.5">文字サイズ</span>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); adjustFocusedFontSize(2); }}
                    className="p-0.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                    title="文字サイズ +2px"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <button
                  onClick={insertUploadedImage}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-100 text-violet-700 border border-violet-300 hover:bg-violet-200 transition-colors"
                >
                  <Image className="w-3.5 h-3.5" />
                  アイコン追加
                </button>
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
          {/* Phase: Setup */}
          {phase === 'setup' && (() => {
            const POSITIONS: { key: string; label: string }[] = [
              { key: 'first', label: '1ページ目' },
              { key: 'middle', label: '途中ページ' },
              { key: 'last', label: '最終ページ' },
            ];
            const tplByPos = (pos: string) => templateList.find(t => t.position === pos);

            return (
              <div className="max-w-2xl mx-auto space-y-5 py-4">
                {/* Header */}
                <div className="text-center space-y-1">
                  <h3 className="text-sm font-semibold text-foreground flex items-center justify-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-teal-500" />
                    スライド生成設定
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    スタイルやテンプレートを設定してから計画を生成できます
                  </p>
                </div>

                {/* Style Options (expanded by default) */}
                <div className="space-y-2">
                  <StyleOptionsPanel value={styleOptions} onChange={setStyleOptions} defaultExpanded />
                </div>

                {/* Template Section */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleTemplates}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors',
                        useTemplates
                          ? 'bg-teal-100 text-teal-700 border border-teal-300'
                          : 'bg-secondary text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {useTemplates ? 'テンプレート ON' : 'テンプレートOFF'}
                    </button>
                    <button
                      onClick={() => setTemplateManagerOpen(true)}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
                    >
                      管理
                    </button>
                  </div>

                  {/* Template status list */}
                  <div className="p-3 bg-secondary/30 border border-border/50 rounded-lg space-y-1.5">
                    {POSITIONS.map(({ key, label }) => {
                      const tpl = tplByPos(key);
                      return (
                        <div key={key} className="flex items-center gap-2 text-xs">
                          {tpl ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                          )}
                          <span className="text-muted-foreground w-20 flex-shrink-0">{label}</span>
                          {tpl ? (
                            <span className="text-foreground flex items-center gap-1 truncate">
                              {tpl.html?.includes('data-image-template="true"') && (
                                <Image className="w-3 h-3 text-violet-500 flex-shrink-0" />
                              )}
                              {tpl.name}
                              {tpl.header_color && (
                                <span
                                  className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-border"
                                  style={{ backgroundColor: tpl.header_color }}
                                />
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">未設定</span>
                          )}
                        </div>
                      );
                    })}
                    {templateList.length === 0 && (
                      <button
                        onClick={() => setTemplateManagerOpen(true)}
                        className="flex items-center gap-1.5 text-[11px] text-teal-600 hover:text-teal-700 transition-colors mt-1"
                      >
                        <Upload className="w-3 h-3" />
                        テンプレートをアップロード
                      </button>
                    )}
                  </div>
                </div>

                {/* Template warning */}
                {templateWarning && (
                  <div className="text-center">
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
                      {templateWarning}
                    </p>
                  </div>
                )}

                {/* Summary Card */}
                <div className="p-4 bg-card border border-border rounded-xl shadow-sm space-y-3">
                  <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-teal-500" />
                    生成設定まとめ
                  </h4>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {/* Style entries */}
                    {([
                      { icon: <Layers className="w-3.5 h-3.5 text-violet-500" />, label: '産業', value: styleOptions.industry },
                      { icon: <Sparkles className="w-3.5 h-3.5 text-blue-500" />, label: '職種', value: styleOptions.profession },
                      { icon: <Type className="w-3.5 h-3.5 text-amber-500" />, label: '年代層', value: styleOptions.ageGroup },
                      { icon: <Palette className="w-3.5 h-3.5 text-pink-500" />, label: '色スタイル', value: styleOptions.colorStyle },
                    ] as const).map(({ icon, label, value }) => (
                      <div key={label} className="flex items-center gap-2 min-w-0">
                        <span className="flex-shrink-0">{icon}</span>
                        <span className="text-[11px] text-muted-foreground flex-shrink-0">{label}:</span>
                        <span className={cn(
                          'text-[11px] font-semibold truncate',
                          value ? 'text-foreground' : 'text-muted-foreground/40',
                        )}>
                          {value || '未選択'}
                        </span>
                      </div>
                    ))}

                    {/* Template status */}
                    <div className="flex items-center gap-2 min-w-0">
                      <Image className={cn('w-3.5 h-3.5 flex-shrink-0', useTemplates ? 'text-teal-500' : 'text-muted-foreground/40')} />
                      <span className="text-[11px] text-muted-foreground flex-shrink-0">テンプレート:</span>
                      <span className={cn(
                        'text-[11px] font-semibold truncate',
                        useTemplates ? 'text-teal-600' : 'text-muted-foreground/40',
                      )}>
                        {useTemplates
                          ? templateList.length > 0
                            ? `ON (${templateList.length}件)`
                            : 'ON (未アップロード)'
                          : 'OFF'}
                      </span>
                    </div>

                    {/* Font info */}
                    <div className="flex items-center gap-2 min-w-0">
                      <Type className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="text-[11px] text-muted-foreground flex-shrink-0">フォント:</span>
                      <span className="text-[11px] font-semibold text-foreground truncate">
                        {styleOptions.font?.split(' (')[0] || 'ゴシック体'}
                      </span>
                      <span className="text-[9px] text-muted-foreground/60">(編集画面で変更可)</span>
                    </div>
                  </div>

                  {/* Editable note */}
                  <textarea
                    placeholder="追加の指示やメモがあれば入力..."
                    value={(styleOptions as Record<string, string | undefined>)._note ?? ''}
                    onChange={(e) => setStyleOptions(prev => ({ ...prev, _note: e.target.value } as StyleOptions))}
                    rows={2}
                    className="w-full text-xs bg-secondary/30 border border-border/50 rounded-lg px-3 py-2 text-foreground resize-none outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 transition-colors placeholder:text-muted-foreground/40"
                  />
                </div>

                {/* Generate button */}
                <div className="flex justify-center pt-2">
                  <button
                    onClick={handlePlanGenerate}
                    className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-xl bg-teal-500 text-white hover:bg-teal-600 transition-colors shadow-lg shadow-teal-500/20"
                  >
                    <Sparkles className="w-4 h-4" />
                    {hasGeneratedOnce ? '計画を再生成' : '計画生成'}
                  </button>
                </div>
              </div>
            );
          })()}

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
                onClick={() => setPhase('setup')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                設定に戻る
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
                  onClick={toggleTemplates}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors',
                    useTemplates
                      ? 'bg-teal-100 text-teal-700 border border-teal-300'
                      : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                >
                  {useTemplates ? 'テンプレート ON' : 'テンプレートOFF'}
                </button>
                <button
                  onClick={() => setTemplateManagerOpen(true)}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
                >
                  管理
                </button>
              </div>

              {/* Template warning */}
              {templateWarning && (
                <div className="text-center">
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
                    {templateWarning}
                  </p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex justify-center gap-3 pt-2">
                <button
                  onClick={handlePlanGenerate}
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
                  {editing && <span className="ml-2 text-xs text-teal-500">(編集中 - テキスト編集 / ⋮⋮ 移動 / 角・辺リサイズ / Shift+クリックで複数選択)</span>}
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
