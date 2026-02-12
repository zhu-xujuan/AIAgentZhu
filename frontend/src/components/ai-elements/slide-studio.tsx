'use client';

import { cn } from '@/lib/utils';
import { HTMLAttributes, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  FileDown,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

export type SlideCitation = {
  source_id?: number | null;
  source_title?: string;
  quote?: string;
};

export type Slide = {
  id?: string;
  title: string;
  layout?: 'title' | 'content' | 'visual' | 'table' | 'chart' | 'comparison' | null;
  bullets: string[];
  diagram_mermaid?: string;
  table?: SlideTable | null;
  image_url?: string;
  image_data_url?: string;
  image_prompt?: string;
  chart?: SlideChart | null;
  speaker_notes?: string;
  citations?: SlideCitation[];
};

export type SlideTable = {
  headers?: string[];
  rows?: string[][];
};

export type SlideChart = {
  type?: 'bar' | 'line' | 'pie';
  title?: string;
  labels?: string[];
  datasets?: Array<{
    label?: string;
    data?: number[];
  }>;
};

export type SlideDeck = {
  title: string;
  summary?: string;
  slides: Slide[];
};

function bulletsToTextarea(bullets: string[]) {
  return (bullets || []).map((b) => `- ${b}`).join('\n');
}

function textareaToBullets(text: string) {
  return (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\-\s*/, '').trim())
    .filter(Boolean);
}

function tableToCsv(table?: SlideTable | null) {
  if (!table) return '';
  const lines: string[] = [];
  const headers = table.headers || [];
  const rows = table.rows || [];
  if (headers.length > 0) lines.push(headers.join(', '));
  rows.forEach((r) => lines.push((r || []).join(', ')));
  return lines.join('\n');
}

function csvToTable(text: string): SlideTable | null {
  const lines = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const parsed = lines.map((l) => l.split(',').map((c) => c.trim()));
  const headers = parsed[0] || [];
  const rows = parsed.slice(1);
  const hasData =
    headers.some((h) => h.length > 0) || rows.some((r) => r.some((c) => c.length > 0));
  return hasData ? { headers, rows } : null;
}

function hasTableData(table?: SlideTable | null) {
  if (!table) return false;
  return (table.headers && table.headers.length > 0) || (table.rows && table.rows.length > 0);
}

function getSlideImageSrc(slide?: Slide | null) {
  if (!slide) return '';
  return slide.image_data_url || slide.image_url || '';
}

function chartToJson(chart?: SlideChart | null) {
  if (!chart) return '';
  return JSON.stringify(chart, null, 2);
}

function jsonToChart(text: string): SlideChart | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') return parsed as SlideChart;
  } catch {
    // ignore
  }
  return null;
}

function chartToQuickchartUrl(chart?: SlideChart | null) {
  if (!chart || !chart.type) return '';
  const labels = Array.isArray(chart.labels) ? chart.labels : [];
  const datasets = Array.isArray(chart.datasets) ? chart.datasets : [];
  if (labels.length === 0 || datasets.length === 0) return '';
  const config = {
    type: chart.type,
    data: { labels, datasets },
    options: {
      plugins: {
        title: {
          display: !!chart.title,
          text: chart.title || '',
        },
        legend: { display: datasets.length > 1 },
      },
      responsive: true,
      maintainAspectRatio: false,
    },
  };
  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(config))}`;
}

function buildDefaultImagePrompt(slide?: Slide | null) {
  if (!slide) return '';
  const bullets = (slide.bullets || []).slice(0, 6).join('; ');
  const base = `${slide.title || 'Slide'}. ${bullets}`.trim();
  return `${base}. Abstract flat vector illustration, clean, minimal, soft colors, no text, no numbers, no logos.`;
}

// ============================================================
// SLIDE PREVIEW STYLING
// ============================================================

const PREVIEW_COLORS = {
  primary: '#4F46E5',
  primaryLight: '#EEF2FF',
  primaryMid: '#C7D2FE',
  primaryDark: '#3730A3',
  secondary: '#0EA5E9',
  secondaryLight: '#E0F2FE',
  accent3: '#10B981',
  accent6: '#8B5CF6',
  text: '#111827',
  textLight: '#6B7280',
  textMuted: '#9CA3AF',
  border: '#E5E7EB',
  background: '#FFFFFF',
  backgroundAlt: '#F9FAFB',
};

const TOPIC_ICONS: Record<string, string> = {
  '概要': '📋', '紹介': '👋', 'まとめ': '✅', '結論': '🎯',
  '比較': '⚖️', '分析': '📊', 'データ': '📈', 'ワークフロー': '🔄',
  'プロセス': '⚙️', '計画': '📅', '課題': '⚠️', '問題': '❗',
  '解決': '💡', '提案': '💡', 'ポイント': '📌', '要点': '📌',
  'チーム': '👥', '組織': '🏢', 'コスト': '💰', '技術': '🔧',
  'セキュリティ': '🔒', '品質': '✨', '目標': '🎯',
  'overview': '📋', 'summary': '✅', 'conclusion': '🎯',
  'comparison': '⚖️', 'analysis': '📊', 'workflow': '🔄',
  'process': '⚙️', 'plan': '📅', 'issue': '⚠️', 'solution': '💡',
  'team': '👥', 'cost': '💰', 'technology': '🔧', 'security': '🔒',
};

function getIconForTitle(title: string): string {
  const lowerTitle = title.toLowerCase();
  for (const [keyword, icon] of Object.entries(TOPIC_ICONS)) {
    if (lowerTitle.includes(keyword.toLowerCase())) return icon;
  }
  return '📄';
}

type SlideLayoutType = 'title' | 'content' | 'visual' | 'table' | 'chart' | 'card';

// Card accent colors (matching PPTX)
const CARD_ACCENT_COLORS = [
  '#F4A261',  // Orange
  '#6BB8C9',  // Cyan
  '#10B981',  // Green (Emerald)
  '#E91E63',  // Pink
  '#8B5CF6',  // Violet
  '#F59E0B',  // Amber
];

function hasValidChartData(chart?: SlideChart | null): boolean {
  if (!chart || !chart.type) return false;
  const labels = Array.isArray(chart.labels) ? chart.labels : [];
  const datasets = Array.isArray(chart.datasets) ? chart.datasets : [];
  if (labels.length === 0 || datasets.length === 0) return false;
  return datasets.some(ds => Array.isArray(ds.data) && ds.data.length > 0 && ds.data.some(v => typeof v === 'number' && v !== 0));
}

function hasValidTableDataCheck(table?: SlideTable | null): boolean {
  if (!table) return false;
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const hasHeaders = headers.some(h => h && h.trim().length > 0);
  const hasRows = rows.some(r => Array.isArray(r) && r.some(c => c && c.trim().length > 0));
  return hasHeaders || hasRows;
}

function detectSlideLayout(slide: Slide, idx: number): SlideLayoutType {
  if (idx === 0) return 'title';

  // Check for actual valid data
  const hasChart = hasValidChartData(slide.chart);
  const hasTable = hasValidTableDataCheck(slide.table);
  const hasImage = slide.image_url || slide.image_data_url;
  const hasDiagram = slide.diagram_mermaid && slide.diagram_mermaid.trim().length > 0;
  const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(b => b && b.trim()) : [];

  if (hasChart) return 'chart';
  if (hasTable) return 'table';
  if (hasImage || hasDiagram) return 'visual';
  // Use card layout for slides with 2-4 bullet points
  if (bullets.length >= 2 && bullets.length <= 4) return 'card';
  return 'content';
}

function getIconForBullet(text: string, index: number): string {
  const lowerText = text.toLowerCase();
  for (const [keyword, icon] of Object.entries(TOPIC_ICONS)) {
    if (lowerText.includes(keyword.toLowerCase())) return icon;
  }
  const defaultIcons = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
  return defaultIcons[index % defaultIcons.length];
}

function deckToMarkdown(deck: SlideDeck) {
  const lines: string[] = [];
  lines.push(`# ${deck.title || 'スライド資料'}`);
  if (deck.summary?.trim()) {
    lines.push('');
    lines.push(deck.summary.trim());
  }
  lines.push('');
  deck.slides.forEach((s, idx) => {
    lines.push(`## ${idx + 1}. ${s.title || 'Slide'}`);
    (s.bullets || []).forEach((b) => lines.push(`- ${b}`));
    if (hasTableData(s.table)) {
      const headers = s.table?.headers || [];
      const rows = s.table?.rows || [];
      if (headers.length > 0) {
        lines.push('');
        lines.push(`| ${headers.join(' | ')} |`);
        lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
      }
      rows.forEach((r) => {
        lines.push(`| ${(r || []).join(' | ')} |`);
      });
    }
    if (s.image_url?.trim()) {
      lines.push('');
      lines.push(`Image: ${s.image_url.trim()}`);
    }
    if (s.chart?.type) {
      lines.push('');
      lines.push(`Chart: ${s.chart.type}${s.chart.title ? ` (${s.chart.title})` : ''}`);
    }
    if (s.speaker_notes?.trim()) {
      lines.push('');
      lines.push(`> Notes: ${s.speaker_notes.trim().replace(/\n/g, ' ')}`);
    }
    const citations = s.citations || [];
    if (citations.length > 0) {
      lines.push('');
      lines.push(`Sources:`);
      citations.slice(0, 6).forEach((c) => {
        const title = c.source_title?.trim() || 'Source';
        const quote = c.quote?.trim();
        const id = c.source_id != null ? `#${c.source_id}` : '';
        lines.push(`- ${title}${id ? ` (${id})` : ''}${quote ? `: "${quote}"` : ''}`);
      });
    }
    lines.push('');
  });
  return lines.join('\n').trim() + '\n';
}

function escapeSlidevFrontmatter(value: string) {
  const v = (value || '').trim();
  if (!v) return '';
  return v.replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

function toMarkdownTable(table?: SlideTable | null) {
  if (!hasTableData(table)) return '';
  const headers = (table?.headers || []).map((h) => (h || '').trim());
  const rows = (table?.rows || []).map((r) => (r || []).map((c) => (c || '').trim()));
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  if (colCount === 0) return '';

  const padRow = (r: string[]) => {
    const next = r.slice(0, colCount);
    while (next.length < colCount) next.push('');
    return next;
  };

  const h = padRow(headers);
  const lines: string[] = [];
  lines.push(`| ${h.join(' | ')} |`);
  lines.push(`| ${h.map(() => '---').join(' | ')} |`);
  rows.map(padRow).forEach((r) => lines.push(`| ${r.join(' | ')} |`));
  return lines.join('\n');
}

function deckToSlidevMarkdown(deck: SlideDeck) {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`title: "${escapeSlidevFrontmatter(deck.title || 'Slides')}"`);
  if (deck.summary?.trim()) lines.push(`info: "${escapeSlidevFrontmatter(deck.summary)}"`);
  lines.push('theme: default');
  lines.push('---');
  lines.push('');

  // Cover slide
  lines.push(`# ${deck.title || 'スライド資料'}`);
  if (deck.summary?.trim()) {
    lines.push('');
    lines.push(deck.summary.trim());
  }
  lines.push('');

  deck.slides.forEach((s) => {
    lines.push('---');
    lines.push('');
    lines.push(`## ${s.title || 'Slide'}`);
    lines.push('');

    const bullets = (s.bullets || []).filter((b) => (b || '').trim().length > 0);
    bullets.slice(0, 12).forEach((b) => lines.push(`- ${b}`));

    const diagram = (s.diagram_mermaid || '').trim();
    if (diagram) {
      lines.push('');
      lines.push('```mermaid');
      lines.push(diagram);
      lines.push('```');
    }

    const tableMd = toMarkdownTable(s.table);
    if (tableMd) {
      lines.push('');
      lines.push(tableMd);
    }

    const imageSrc = getSlideImageSrc(s);
    if (imageSrc) {
      lines.push('');
      lines.push(`![](${imageSrc})`);
    } else {
      const chartUrl = chartToQuickchartUrl(s.chart || null);
      if (chartUrl) {
        lines.push('');
        lines.push(`![](${chartUrl})`);
      }
    }

    const citations = s.citations || [];
    if (citations.length > 0) {
      const compact = citations
        .slice(0, 3)
        .map((c) => {
          const title = (c.source_title || 'Source').trim();
          const id = c.source_id != null ? `#${c.source_id}` : '';
          return `${title}${id ? ` (${id})` : ''}`;
        })
        .filter(Boolean);
      if (compact.length > 0) {
        lines.push('');
        lines.push(`<div class="text-xs opacity-60">Sources: ${compact.join(' / ')}</div>`);
      }
    }

    const notes = (s.speaker_notes || '').trim();
    if (notes) {
      lines.push('');
      lines.push('<!--');
      lines.push(notes);
      lines.push('-->');
    }

    lines.push('');
  });

  return lines.join('\n').trim() + '\n';
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function waitNextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function getSvgSize(svg: string): { width: number; height: number } {
  const widthMatch = svg.match(/width="([\d.]+)(px)?"/i);
  const heightMatch = svg.match(/height="([\d.]+)(px)?"/i);
  if (widthMatch && heightMatch) {
    const width = Number(widthMatch[1]);
    const height = Number(heightMatch[1]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }

  const viewBoxMatch = svg.match(/viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/i);
  if (viewBoxMatch) {
    const width = Number(viewBoxMatch[1]);
    const height = Number(viewBoxMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }

  return { width: 900, height: 520 };
}

async function svgToPngDataUrl(svg: string, scale: number = 2): Promise<string> {
  const { width, height } = getSvgSize(svg);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface SlideStudioProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  deck: SlideDeck;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onDeckChange: (next: SlideDeck) => void;
  onRequestRefine?: (instruction: string) => void;
}

export function SlideStudio({
  open,
  deck,
  busy,
  error,
  onClose,
  onDeckChange,
  onRequestRefine,
  className,
  ...props
}: SlideStudioProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [instruction, setInstruction] = useState('');
  const [selectedDiagramSvg, setSelectedDiagramSvg] = useState<string>('');
  const [exportDiagramSvg, setExportDiagramSvg] = useState<string>('');
  const [exporting, setExporting] = useState<null | 'pptx' | 'pdf'>(null);
  const [exportIndex, setExportIndex] = useState<number>(0);
  const [slidevPreviewOpen, setSlidevPreviewOpen] = useState(false);
  const [slidevPreviewUrl, setSlidevPreviewUrl] = useState<string>('');
  const [slidevPreviewError, setSlidevPreviewError] = useState<string | null>(null);
  const [slidevPreviewLoading, setSlidevPreviewLoading] = useState(false);
  const exportSlideRef = useRef<HTMLDivElement>(null);
  const exportPngCacheRef = useRef<{ fingerprint: string; pngs: string[] } | null>(null);
  const slidevSyncTimerRef = useRef<number | null>(null);
  const selectedSlide = useMemo(() => deck.slides[selectedIndex], [deck.slides, selectedIndex]);
  const [chartDraft, setChartDraft] = useState('');
  const [imagePromptDraft, setImagePromptDraft] = useState('');
  const [imageGenerating, setImageGenerating] = useState(false);
  const chartUrl = useMemo(
    () => chartToQuickchartUrl(selectedSlide?.chart || null),
    [selectedSlide?.chart]
  );

  useEffect(() => {
    if (!open) return;
    setChartDraft(chartToJson(selectedSlide?.chart || null));
    setImagePromptDraft(selectedSlide?.image_prompt || '');
    // Clear diagram SVG when slide changes - will be re-rendered on demand
    setSelectedDiagramSvg('');
  }, [open, selectedSlide?.id, selectedSlide?.chart, selectedSlide?.image_prompt, selectedIndex]);

  // Auto-render Mermaid diagram when slide has diagram_mermaid
  useEffect(() => {
    if (!open || !selectedSlide?.diagram_mermaid) return;
    const code = selectedSlide.diagram_mermaid.trim();
    if (!code) return;

    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
        const id = `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const out = await mermaid.render(id, code);
        if (!cancelled && out.svg) {
          setSelectedDiagramSvg(out.svg);
        }
      } catch (e) {
        console.error('Mermaid render error:', e);
        if (!cancelled) setSelectedDiagramSvg('');
      }
    })();

    return () => { cancelled = true; };
  }, [open, selectedSlide?.diagram_mermaid, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    setInstruction('');
    setSelectedDiagramSvg('');
    setExportDiagramSvg('');
    setExporting(null);
    setSlidevPreviewOpen(false);
    setSlidevPreviewUrl('');
    setSlidevPreviewError(null);
    setSlidevPreviewLoading(false);
    if (slidevSyncTimerRef.current != null) {
      window.clearTimeout(slidevSyncTimerRef.current);
      slidevSyncTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const updateDeck = (patch: Partial<SlideDeck>) => onDeckChange({ ...deck, ...patch });
  const updateSlide = (index: number, patch: Partial<Slide>) => {
    const slides = deck.slides.slice();
    slides[index] = { ...slides[index], ...patch };
    onDeckChange({ ...deck, slides });
  };

  const handleImageFile = (file: File | null) => {
    if (!file || !selectedSlide) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;
      updateSlide(selectedIndex, {
        image_data_url: result,
        image_url: '',
      });
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateImage = async () => {
    if (!selectedSlide || imageGenerating) return;
    const prompt = (imagePromptDraft || selectedSlide.image_prompt || buildDefaultImagePrompt(selectedSlide)).trim();
    if (!prompt) return;
    setImageGenerating(true);
    try {
      const response = await fetch('/api/slides/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP error: ${response.status}`);
      }
      const data = await response.json();
      const dataUrl = data?.data_url || '';
      if (!dataUrl) throw new Error('Image generation failed');
      updateSlide(selectedIndex, {
        image_data_url: dataUrl,
        image_url: '',
        image_prompt: prompt,
      });
      setImagePromptDraft(prompt);
    } catch (err) {
      console.error('[SlideStudio] Image generation failed', err);
    } finally {
      setImageGenerating(false);
    }
  };

  const addSlide = () => {
    const slides = deck.slides.concat({
      id: `slide-${Date.now()}`,
      title: 'New Slide',
      bullets: [],
      speaker_notes: '',
      citations: [],
    });
    onDeckChange({ ...deck, slides });
    setSelectedIndex(slides.length - 1);
  };

  const deleteSlide = (index: number) => {
    const slides = deck.slides.slice();
    slides.splice(index, 1);
    onDeckChange({ ...deck, slides });
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, slides.length - 1)));
  };

  const moveSlide = (from: number, delta: -1 | 1) => {
    const to = from + delta;
    if (to < 0 || to >= deck.slides.length) return;
    const slides = deck.slides.slice();
    const [item] = slides.splice(from, 1);
    slides.splice(to, 0, item);
    onDeckChange({ ...deck, slides });
    setSelectedIndex(to);
  };

  const markdown = deckToMarkdown(deck);
  const slidevMarkdown = deckToSlidevMarkdown(deck);

  const ensureSlidevPreview = async () => {
    setSlidevPreviewLoading(true);
    setSlidevPreviewError(null);
    try {
      const response = await fetch('/api/slides/slidev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: slidevMarkdown }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP error: ${response.status}`);
      }
      const data = await response.json();
      const url = typeof data?.url === 'string' ? data.url : '';
      if (!url) throw new Error('Slidev preview URL missing');
      setSlidevPreviewUrl(url);
      setSlidevPreviewOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Slidev preview failed';
      setSlidevPreviewError(msg);
      setSlidevPreviewOpen(true);
    } finally {
      setSlidevPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!slidevPreviewOpen) return;
    if (!slidevPreviewUrl) return;
    if (slidevPreviewLoading) return;

    if (slidevSyncTimerRef.current != null) window.clearTimeout(slidevSyncTimerRef.current);
    slidevSyncTimerRef.current = window.setTimeout(async () => {
      try {
        await fetch('/api/slides/slidev', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: slidevMarkdown }),
        });
      } catch {
        // ignore
      }
    }, 800);

    return () => {
      if (slidevSyncTimerRef.current != null) {
        window.clearTimeout(slidevSyncTimerRef.current);
        slidevSyncTimerRef.current = null;
      }
    };
  }, [slidevPreviewOpen, slidevPreviewUrl, slidevPreviewLoading, slidevMarkdown]);

  const renderMermaidToSvg = async (code: string) => {
    const trimmed = (code || '').trim();
    if (!trimmed) return '';
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
    const id = `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const out = await mermaid.render(id, trimmed);
    return out.svg || '';
  };

  const ensureDiagramSvg = async () => {
    const code = selectedSlide?.diagram_mermaid || '';
    if (!code.trim()) {
      setSelectedDiagramSvg('');
      return;
    }
    try {
      const svg = await renderMermaidToSvg(code);
      setSelectedDiagramSvg(svg);
    } catch {
      setSelectedDiagramSvg('');
    }
  };

  const renderSlidePngs = async () => {
    const { default: html2canvas } = await import('html2canvas');

    // Pre-render Mermaid diagrams to SVG strings to avoid async work during capture
    const mermaidSvgByIndex: Record<number, string> = {};
    for (let i = 0; i < deck.slides.length; i++) {
      const code = deck.slides[i]?.diagram_mermaid || '';
      if (!code.trim()) continue;
      try {
        mermaidSvgByIndex[i] = await renderMermaidToSvg(code);
      } catch {
        mermaidSvgByIndex[i] = '';
      }
    }

    const pngs: string[] = [];
    for (let i = 0; i < deck.slides.length; i++) {
      setExportIndex(i);
      setExportDiagramSvg(mermaidSvgByIndex[i] || '');
      await waitNextFrame();
      await waitNextFrame();

      const el = exportSlideRef.current;
      if (!el) throw new Error('Export element not ready');

      const canvas = await html2canvas(el, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      });
      pngs.push(canvas.toDataURL('image/png'));
    }

    return pngs;
  };

  const exportPdf = async () => {
    setExporting('pdf');
    try {
      const fingerprint = `${deck.title}|${deck.summary || ''}|${deck.slides
        .map((s) => `${s.title}|${(s.bullets || []).join('•')}|${s.diagram_mermaid || ''}`)
        .join('||')}`;
      const cached = exportPngCacheRef.current;
      const pngs = cached?.fingerprint === fingerprint ? cached.pngs : await renderSlidePngs();
      exportPngCacheRef.current = { fingerprint, pngs };

      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [1280, 720],
      });
      pngs.forEach((png, idx) => {
        if (idx > 0) doc.addPage([1280, 720], 'landscape');
        doc.addImage(png, 'PNG', 0, 0, 1280, 720);
      });
      doc.save('slides.pdf');
    } finally {
      setExporting(null);
      setExportIndex(0);
    }
  };

  const exportPptx = async () => {
    setExporting('pptx');
    try {
      // Presenton-style optimization: export PPTX with editable text boxes + diagram images (smaller payload than full-slide PNGs)
      const diagramPngs: Array<string | null> = [];
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });

      for (let i = 0; i < deck.slides.length; i++) {
        setExportIndex(i);
        const code = (deck.slides[i]?.diagram_mermaid || '').trim();
        if (!code) {
          diagramPngs.push(null);
          continue;
        }
        try {
          const id = `m-pptx-${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`;
          const out = await mermaid.render(id, code);
          const png = await svgToPngDataUrl(out.svg || '');
          diagramPngs.push(png);
        } catch {
          diagramPngs.push(null);
        }
      }

      const response = await fetch('/api/slides/pptx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: deck.title || 'slides', deck, diagram_pngs: diagramPngs }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP error: ${response.status}`);
      }
      const blob = await response.blob();
      const safeTitle = (deck.title || 'slides').replace(/[\\/:*?"<>|]/g, '_');
      downloadBlob(`${safeTitle}.pptx`, blob);
    } finally {
      setExporting(null);
      setExportIndex(0);
    }
  };

  const slideForExport = deck.slides[exportIndex];
  const exportTable = slideForExport?.table;
  const exportImage = getSlideImageSrc(slideForExport);
  const exportChartUrl = chartToQuickchartUrl(slideForExport?.chart || null);
  const showExportImage = !exportDiagramSvg && !!exportImage;
  const showExportChart = !exportDiagramSvg && !exportImage && !!exportChartUrl;
  const showExportTable = !exportDiagramSvg && !exportImage && !exportChartUrl && hasTableData(exportTable);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
        'flex items-stretch justify-center p-3 sm:p-6',
        className
      )}
      {...props}
    >
      <div className="w-full max-w-6xl bg-background border border-border rounded-2xl shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Slide Studio</div>
            <input
              value={deck.title}
              onChange={(e) => updateDeck({ title: e.target.value })}
              className={cn(
                'w-full bg-transparent text-base font-semibold text-foreground outline-none',
                'placeholder:text-muted-foreground'
              )}
              placeholder="資料タイトル"
              disabled={busy || exporting !== null}
            />
            {error && (
              <div className="text-[11px] text-destructive mt-1">
                {error}
              </div>
            )}
            {exporting && (
              <div className="text-[11px] text-muted-foreground mt-1">
                Exporting {exporting.toUpperCase()}… ({Math.min(exportIndex + 1, deck.slides.length)}/{deck.slides.length})
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={async () => copyToClipboard(markdown)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
              disabled={busy || exporting !== null}
              title="Markdownとしてコピー"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>
            <button
              type="button"
              onClick={() => downloadText('slides.md', markdown)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
              disabled={busy || exporting !== null}
              title="Markdownをダウンロード"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
            <button
              type="button"
              onClick={() => downloadText('slides.slidev.md', slidevMarkdown)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
              disabled={busy || exporting !== null || deck.slides.length === 0}
              title="Slidev用Markdownをダウンロード"
            >
              <Download className="w-3.5 h-3.5" />
              Slidev
            </button>
            <button
              type="button"
              onClick={() => {
                if (slidevPreviewOpen) setSlidevPreviewOpen(false);
                else void ensureSlidevPreview();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
              disabled={busy || exporting !== null || deck.slides.length === 0}
              title={slidevPreviewOpen ? 'Slidevプレビューを閉じる' : 'Slidevプレビューを開く'}
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
            <button
              type="button"
              onClick={exportPptx}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
              disabled={busy || exporting !== null || deck.slides.length === 0}
              title="PPTXをダウンロード"
            >
              <FileDown className="w-3.5 h-3.5" />
              PPTX
            </button>
            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
              disabled={busy || exporting !== null || deck.slides.length === 0}
              title="PDFをダウンロード"
            >
              <FileDown className="w-3.5 h-3.5" />
              PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 hover:bg-accent transition-colors"
              aria-label="Close"
              disabled={busy || exporting !== null}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex">
          {/* Sidebar */}
          <div className="w-64 border-r border-border bg-card/30 flex flex-col">
            <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Slides</div>
              <button
                type="button"
                onClick={addSlide}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent transition-colors"
                disabled={busy || exporting !== null}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {deck.slides.length === 0 ? (
                <div className="text-xs text-muted-foreground px-2 py-3">
                  スライドがありません（Add で追加）
                </div>
              ) : (
                deck.slides.map((s, idx) => {
                  const selected = idx === selectedIndex;
                  const isDisabled = busy || exporting !== null;
                  return (
                    <div
                      key={s.id || idx}
                      role="button"
                      tabIndex={isDisabled ? -1 : 0}
                      onClick={() => {
                        if (isDisabled) return;
                        setSelectedIndex(idx);
                      }}
                      onKeyDown={(e) => {
                        if (isDisabled) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedIndex(idx);
                        }
                      }}
                      className={cn(
                        'w-full text-left rounded-lg border px-2.5 py-2 transition-colors',
                        selected
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border bg-background hover:bg-accent',
                        isDisabled && 'opacity-50 cursor-not-allowed'
                      )}
                      aria-disabled={isDisabled}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded flex items-center justify-center text-sm flex-shrink-0"
                            style={{
                              background: idx === 0 ? PREVIEW_COLORS.primaryLight :
                                s.chart?.type ? PREVIEW_COLORS.secondaryLight :
                                hasTableData(s.table) ? '#D1FAE5' :
                                PREVIEW_COLORS.primaryLight,
                              border: `1px solid ${idx === 0 ? PREVIEW_COLORS.primaryMid :
                                s.chart?.type ? PREVIEW_COLORS.secondary :
                                hasTableData(s.table) ? PREVIEW_COLORS.accent3 :
                                PREVIEW_COLORS.primaryMid}`
                            }}
                          >
                            {idx === 0 ? '🎯' :
                             s.chart?.type ? '📊' :
                             hasTableData(s.table) ? '📋' :
                             (s.image_url || s.image_data_url || s.diagram_mermaid) ? '🖼️' :
                             getIconForTitle(s.title || '')}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <span>{idx + 1}</span>
                              <span className="opacity-50">•</span>
                              <span className="capitalize">{detectSlideLayout(s, idx)}</span>
                            </div>
                            <div className="text-xs font-medium text-foreground truncate">
                              {s.title || 'Slide'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-70">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveSlide(idx, -1);
                            }}
                            className="p-1 rounded hover:bg-accent"
                            aria-label="Move up"
                            disabled={busy || exporting !== null || idx === 0}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveSlide(idx, 1);
                            }}
                            className="p-1 rounded hover:bg-accent"
                            aria-label="Move down"
                            disabled={busy || exporting !== null || idx === deck.slides.length - 1}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSlide(idx);
                            }}
                            className="p-1 rounded hover:bg-accent"
                            aria-label="Delete slide"
                            disabled={busy || exporting !== null}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground max-h-8 overflow-hidden">
                        {(s.bullets || []).slice(0, 2).join(' / ') || '（内容なし）'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
	          </div>

	          <div className="flex-1 min-w-0 flex">
	            {/* Editor */}
	            <div className="flex-1 min-w-0 flex flex-col">
	              {selectedSlide ? (
	                <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
	                {/* Preview - Enhanced Slide Design */}
	                <div className="rounded-xl border border-border overflow-hidden shadow-lg">
	                  {/* Slide Preview Container - 16:9 aspect ratio */}
	                  <div
	                    className="relative w-full"
	                    style={{
	                      aspectRatio: '16/9',
	                      background: detectSlideLayout(selectedSlide, selectedIndex) === 'title'
	                        ? PREVIEW_COLORS.primaryLight
	                        : PREVIEW_COLORS.background
	                    }}
	                  >
	                    {/* Top accent bar */}
	                    <div
	                      className="absolute top-0 left-0 right-0 h-1"
	                      style={{
	                        background: detectSlideLayout(selectedSlide, selectedIndex) === 'chart'
	                          ? PREVIEW_COLORS.secondary
	                          : detectSlideLayout(selectedSlide, selectedIndex) === 'table'
	                            ? PREVIEW_COLORS.accent3
	                            : PREVIEW_COLORS.primary
	                      }}
	                    />

	                    {/* Title Slide Layout - Title Only, No Bullets */}
	                    {detectSlideLayout(selectedSlide, selectedIndex) === 'title' ? (
	                      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
	                        <div className="text-5xl mb-6">{getIconForTitle(selectedSlide.title || '')}</div>
	                        <h1 className="text-3xl font-bold mb-4" style={{ color: PREVIEW_COLORS.text }}>
	                          {selectedSlide.title || 'Presentation Title'}
	                        </h1>
	                        <div
	                          className="mt-4 h-px w-32"
	                          style={{ background: PREVIEW_COLORS.primaryMid }}
	                        />
	                        <div className="mt-4 text-sm" style={{ color: PREVIEW_COLORS.primary }}>
	                          AI Generated Presentation
	                        </div>
	                      </div>
	                    ) : detectSlideLayout(selectedSlide, selectedIndex) === 'card' ? (
	                      /* Card Layout - 2x2 Grid */
	                      <div className="h-full flex flex-col">
	                        {/* Header bar */}
	                        <div
	                          className="h-10 flex items-center px-4 gap-3"
	                          style={{ background: '#0D4F6F' }}
	                        >
	                          <span className="text-xl">{getIconForTitle(selectedSlide.title || '')}</span>
	                          <h2 className="text-base font-semibold text-white flex-1">
	                            {selectedSlide.title || 'Slide'}
	                          </h2>
	                          <div
	                            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
	                            style={{ background: '#FFFFFF', color: '#0D4F6F' }}
	                          >
	                            {selectedIndex + 1}
	                          </div>
	                        </div>
	                        {/* Card Grid */}
	                        <div className="flex-1 p-3 grid grid-cols-2 gap-2">
	                          {(selectedSlide.bullets || []).slice(0, 4).map((bullet, i) => {
	                            const accentColor = CARD_ACCENT_COLORS[i % CARD_ACCENT_COLORS.length];
	                            const colonIdx = bullet.indexOf('：') !== -1 ? bullet.indexOf('：') : bullet.indexOf(':');
	                            let cardTitle = `ポイント ${i + 1}`;
	                            let cardDesc = bullet;
	                            if (colonIdx !== -1 && colonIdx < 30) {
	                              cardTitle = bullet.slice(0, colonIdx).trim();
	                              cardDesc = bullet.slice(colonIdx + 1).trim();
	                            }
	                            return (
	                              <div
	                                key={i}
	                                className="rounded-lg overflow-hidden flex"
	                                style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
	                              >
	                                {/* Accent bar */}
	                                <div className="w-1.5 flex-shrink-0" style={{ background: accentColor }} />
	                                <div className="flex-1 p-2">
	                                  <div className="flex items-center gap-1.5 mb-1">
	                                    <span
	                                      className="w-5 h-5 rounded-full flex items-center justify-center text-xs"
	                                      style={{ background: `${accentColor}20` }}
	                                    >
	                                      {getIconForBullet(bullet, i)}
	                                    </span>
	                                    <span className="text-xs font-semibold" style={{ color: PREVIEW_COLORS.text }}>
	                                      {cardTitle}
	                                    </span>
	                                  </div>
	                                  <p className="text-[10px] leading-relaxed" style={{ color: PREVIEW_COLORS.textLight }}>
	                                    {cardDesc.length > 80 ? cardDesc.slice(0, 80) + '...' : cardDesc}
	                                  </p>
	                                </div>
	                              </div>
	                            );
	                          })}
	                        </div>
	                        {/* More indicator */}
	                        {(selectedSlide.bullets || []).length > 4 && (
	                          <div className="px-3 pb-2 text-[10px] text-right" style={{ color: PREVIEW_COLORS.textMuted }}>
	                            + {(selectedSlide.bullets || []).length - 4} more items...
	                          </div>
	                        )}
	                      </div>
	                    ) : (
	                      /* Content/Visual/Table/Chart Layouts */
	                      <div className="h-full p-4 flex flex-col">
	                        {/* Header with icon and title */}
	                        <div className="flex items-center gap-3 mb-3">
	                          <div
	                            className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
	                            style={{ background: PREVIEW_COLORS.primaryLight, border: `1px solid ${PREVIEW_COLORS.primaryMid}` }}
	                          >
	                            {detectSlideLayout(selectedSlide, selectedIndex) === 'chart' ? '📊' :
	                             detectSlideLayout(selectedSlide, selectedIndex) === 'table' ? '📋' :
	                             detectSlideLayout(selectedSlide, selectedIndex) === 'visual' ? '🖼️' :
	                             getIconForTitle(selectedSlide.title || '')}
	                          </div>
	                          <h2 className="text-lg font-semibold flex-1" style={{ color: PREVIEW_COLORS.text }}>
	                            {selectedSlide.title || 'Slide'}
	                          </h2>
	                          <div
	                            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
	                            style={{ background: PREVIEW_COLORS.primary }}
	                          >
	                            {selectedIndex + 1}
	                          </div>
	                        </div>

	                        {/* Main content area */}
	                        <div className="flex-1 flex gap-4 min-h-0">
	                          {/* Left: Bullets */}
	                          <div className={cn(
	                            "flex-1 min-w-0",
	                            (getSlideImageSrc(selectedSlide) || chartUrl || hasTableData(selectedSlide.table) || selectedDiagramSvg)
	                              ? "max-w-[55%]" : "w-full"
	                          )}>
	                            {(selectedSlide.bullets || []).length > 0 ? (
	                              <ul className="space-y-1.5">
	                                {(selectedSlide.bullets || []).slice(0, 6).map((b, i) => (
	                                  <li key={i} className="flex items-start gap-2 text-sm" style={{ color: PREVIEW_COLORS.text }}>
	                                    <span
	                                      className="mt-0.5 w-5 h-5 rounded flex items-center justify-center text-xs font-medium flex-shrink-0"
	                                      style={{ background: PREVIEW_COLORS.primaryLight, color: PREVIEW_COLORS.primary }}
	                                    >
	                                      {i + 1}
	                                    </span>
	                                    <span className="leading-relaxed">{b}</span>
	                                  </li>
	                                ))}
	                              </ul>
	                            ) : (
	                              <div className="text-sm" style={{ color: PREVIEW_COLORS.textMuted }}>
	                                （内容を追加してください）
	                              </div>
	                            )}
	                          </div>

	                          {/* Right: Visual content */}
	                          {(getSlideImageSrc(selectedSlide) || chartUrl || hasTableData(selectedSlide.table) || selectedDiagramSvg) && (
	                            <div
	                              className="w-[45%] rounded-lg p-3 flex items-center justify-center overflow-hidden"
	                              style={{
	                                background: PREVIEW_COLORS.backgroundAlt,
	                                border: `1px solid ${PREVIEW_COLORS.border}`
	                              }}
	                            >
	                              {selectedDiagramSvg ? (
	                                <div
	                                  className="w-full max-h-full overflow-auto"
	                                  dangerouslySetInnerHTML={{ __html: selectedDiagramSvg }}
	                                />
	                              ) : getSlideImageSrc(selectedSlide) ? (
	                                <img
	                                  src={getSlideImageSrc(selectedSlide)}
	                                  alt="Slide visual"
	                                  className="max-w-full max-h-full object-contain rounded"
	                                />
	                              ) : chartUrl ? (
	                                <img
	                                  src={chartUrl}
	                                  alt="Slide chart"
	                                  className="max-w-full max-h-full object-contain"
	                                />
	                              ) : hasTableData(selectedSlide.table) ? (
	                                <div className="w-full overflow-auto">
	                                  <table className="w-full text-xs">
	                                    {selectedSlide.table?.headers && selectedSlide.table.headers.length > 0 && (
	                                      <thead>
	                                        <tr>
	                                          {selectedSlide.table.headers.map((h, i) => (
	                                            <th
	                                              key={i}
	                                              className="text-left font-semibold px-2 py-1.5 text-white"
	                                              style={{ background: PREVIEW_COLORS.primary }}
	                                            >
	                                              {h}
	                                            </th>
	                                          ))}
	                                        </tr>
	                                      </thead>
	                                    )}
	                                    <tbody>
	                                      {(selectedSlide.table?.rows || []).slice(0, 6).map((row, rIdx) => (
	                                        <tr key={rIdx}>
	                                          {(row || []).map((cell, cIdx) => (
	                                            <td
	                                              key={cIdx}
	                                              className="px-2 py-1.5"
	                                              style={{
	                                                background: rIdx % 2 === 0 ? PREVIEW_COLORS.backgroundAlt : PREVIEW_COLORS.background,
	                                                borderBottom: `1px solid ${PREVIEW_COLORS.border}`
	                                              }}
	                                            >
	                                              {cell}
	                                            </td>
	                                          ))}
	                                        </tr>
	                                      ))}
	                                    </tbody>
	                                  </table>
	                                </div>
	                              ) : null}
	                            </div>
	                          )}
	                        </div>

	                        {/* Takeaway box */}
	                        {(selectedSlide.bullets || []).length > 0 && (
	                          <div
	                            className="mt-3 px-3 py-2 rounded-lg text-xs"
	                            style={{
	                              background: PREVIEW_COLORS.primaryLight,
	                              border: `1px solid ${PREVIEW_COLORS.primaryMid}`,
	                              color: PREVIEW_COLORS.primaryDark
	                            }}
	                          >
	                            💡 <strong>Takeaway:</strong> {selectedSlide.title}のポイントを整理し、次のアクションを明確化
	                          </div>
	                        )}

	                        {/* Citations footer */}
	                        {(selectedSlide.citations || []).length > 0 && (
	                          <div className="mt-2 text-xs" style={{ color: PREVIEW_COLORS.textMuted }}>
	                            📚 {(selectedSlide.citations || []).slice(0, 3).map(c => c.source_title || 'Source').join(' • ')}
	                          </div>
	                        )}
	                      </div>
	                    )}
	                  </div>

	                  {/* Preview label */}
	                  <div className="px-3 py-2 bg-card border-t border-border flex items-center justify-between">
	                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
	                      <Pencil className="w-3.5 h-3.5" />
	                      Preview ({detectSlideLayout(selectedSlide, selectedIndex)} layout)
	                    </div>
	                    <button
	                      type="button"
	                      onClick={ensureDiagramSvg}
	                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
	                      disabled={busy || exporting !== null || !selectedSlide.diagram_mermaid}
	                    >
	                      {selectedSlide.diagram_mermaid ? '🔄 Render Diagram' : ''}
	                    </button>
	                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Slide title</div>
                      <input
                        value={selectedSlide.title}
                        onChange={(e) => updateSlide(selectedIndex, { title: e.target.value })}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                        disabled={busy || exporting !== null}
                      />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Bullets (1行=1項目)</div>
                    <textarea
                        value={bulletsToTextarea(selectedSlide.bullets || [])}
                        onChange={(e) =>
                          updateSlide(selectedIndex, { bullets: textareaToBullets(e.target.value) })
                        }
                        className="w-full h-44 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                        disabled={busy || exporting !== null}
                      />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Table (CSV)</div>
                      <textarea
                        value={tableToCsv(selectedSlide.table)}
                        onChange={(e) =>
                          updateSlide(selectedIndex, { table: csvToTable(e.target.value) })
                        }
                        className="w-full h-28 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40 font-mono"
                        placeholder="Header1, Header2\nValue1, Value2"
                        disabled={busy || exporting !== null}
                      />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Image (URL or Upload)</div>
                      <div className="flex items-center gap-2">
                        <input
                          value={selectedSlide.image_url || ''}
                          onChange={(e) =>
                            updateSlide(selectedIndex, {
                              image_url: e.target.value,
                              image_data_url: '',
                            })
                          }
                          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                          placeholder="https://example.com/image.png"
                          disabled={busy || exporting !== null}
                        />
                        <label className={cn(
                          'inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-2 text-xs hover:bg-accent transition-colors cursor-pointer',
                          (busy || exporting !== null) && 'opacity-50 cursor-not-allowed'
                        )}>
                          <Upload className="w-3.5 h-3.5" />
                          Upload
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={busy || exporting !== null}
                            onChange={(e) => handleImageFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            updateSlide(selectedIndex, { image_url: '', image_data_url: '' })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-2 text-xs hover:bg-accent transition-colors"
                          disabled={busy || exporting !== null}
                        >
                          <X className="w-3.5 h-3.5" />
                          Clear
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={imagePromptDraft}
                          onChange={(e) => setImagePromptDraft(e.target.value)}
                          onBlur={() => updateSlide(selectedIndex, { image_prompt: imagePromptDraft })}
                          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                          placeholder="Image prompt (abstract)"
                          disabled={busy || exporting !== null || imageGenerating}
                        />
                        <button
                          type="button"
                          onClick={handleGenerateImage}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-2 text-xs hover:bg-accent transition-colors"
                          disabled={busy || exporting !== null || imageGenerating}
                        >
                          {imageGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          Generate
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Chart (JSON)</div>
                      <textarea
                        value={chartDraft}
                        onChange={(e) => setChartDraft(e.target.value)}
                        onBlur={() => {
                          const next = jsonToChart(chartDraft);
                          if (next) updateSlide(selectedIndex, { chart: next });
                        }}
                        className="w-full h-28 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40 font-mono"
                        placeholder='{"type":"bar","title":"例","labels":["A","B"],"datasets":[{"label":"値","data":[10,20]}]}'
                        disabled={busy || exporting !== null}
                      />
                      <div className="text-[11px] text-muted-foreground mt-1">
                        変更後はフォーカスを外すと反映されます。
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-muted-foreground mb-1">Diagram (Mermaid)</div>
                        <button
                          type="button"
                          onClick={ensureDiagramSvg}
                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          disabled={busy || exporting !== null}
                        >
                          Preview
                        </button>
                      </div>
                      <textarea
                        value={selectedSlide.diagram_mermaid || ''}
                        onChange={(e) => updateSlide(selectedIndex, { diagram_mermaid: e.target.value })}
                        className="w-full h-28 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40 font-mono"
                        placeholder="例: flowchart TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[Fix]"
                        disabled={busy || exporting !== null}
                      />
                      {selectedDiagramSvg && (
                        <div className="mt-2 rounded-lg border border-border bg-background p-2 overflow-auto max-h-48">
                          <div
                            className="w-full"
                            dangerouslySetInnerHTML={{ __html: selectedDiagramSvg }}
                          />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Speaker notes</div>
                      <textarea
                        value={selectedSlide.speaker_notes || ''}
                        onChange={(e) => updateSlide(selectedIndex, { speaker_notes: e.target.value })}
                        className="w-full h-28 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                        disabled={busy || exporting !== null}
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Deck summary</div>
                      <textarea
                        value={deck.summary || ''}
                        onChange={(e) => updateDeck({ summary: e.target.value })}
                        className="w-full h-28 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                        disabled={busy || exporting !== null}
                      />
                    </div>

                    <div className="rounded-xl border border-border bg-card p-3">
                      <div className="text-xs font-medium text-muted-foreground mb-2">Citations</div>
                      {(selectedSlide.citations || []).length === 0 ? (
                        <div className="text-xs text-muted-foreground">（引用なし）</div>
                      ) : (
                        <div className="space-y-2">
                          {(selectedSlide.citations || []).slice(0, 6).map((c, i) => (
                            <div key={i} className="rounded-lg border border-border bg-background px-2.5 py-2">
                              <div className="text-[11px] text-muted-foreground">
                                {c.source_title || 'Source'}
                                {c.source_id != null ? ` (#${c.source_id})` : ''}
                              </div>
                              {c.quote?.trim() && (
                                <div className="text-xs text-foreground/90 mt-1 whitespace-pre-wrap">
                                  “{c.quote.trim()}”
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* AI refine */}
	                {onRequestRefine && (
	                  <div className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <Sparkles className="w-3.5 h-3.5" />
                      AI Edit
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                        placeholder="例: 3枚目を具体例中心に。全体を短く。"
                        disabled={busy || exporting !== null}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const v = instruction.trim();
                          if (!v) return;
                          onRequestRefine(v);
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={busy || !instruction.trim()}
                      >
                        <Sparkles className="w-4 h-4" />
                        Update
                      </button>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-2">
                      文書にない情報は追加されません（引用ベース）。
                    </div>
                  </div>
	                )}
	                </div>
	              ) : (
	                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
	                  <div className="flex items-center gap-2">
	                    <Sparkles className="w-4 h-4" />
	                    Slides を追加してください
	                  </div>
	                </div>
	              )}
	            </div>

	            {/* Slidev Preview */}
	            {slidevPreviewOpen && (
	              <div className="w-[520px] xl:w-[640px] border-l border-border bg-card/30 flex flex-col min-w-0">
	                <div className="px-3 py-2.5 border-b border-border flex items-center justify-between gap-2">
	                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
	                    <Eye className="w-3.5 h-3.5" />
	                    Slidev Preview
	                  </div>
	                  <div className="flex items-center gap-1.5">
	                    <button
	                      type="button"
	                      onClick={() => void ensureSlidevPreview()}
	                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] hover:bg-accent transition-colors"
	                      disabled={busy || exporting !== null || slidevPreviewLoading}
	                      title="プレビューを更新"
	                    >
	                      <RefreshCw className={cn('w-3.5 h-3.5', slidevPreviewLoading && 'animate-spin')} />
	                      Refresh
	                    </button>
	                    <button
	                      type="button"
	                      onClick={() => setSlidevPreviewOpen(false)}
	                      className="inline-flex items-center justify-center rounded-md border border-border bg-background p-1.5 hover:bg-accent transition-colors"
	                      aria-label="Close Slidev Preview"
	                      disabled={busy || exporting !== null}
	                    >
	                      <X className="w-3.5 h-3.5" />
	                    </button>
	                  </div>
	                </div>

	                {slidevPreviewError ? (
	                  <div className="p-3 text-xs text-destructive">
	                    {slidevPreviewError}
	                  </div>
	                ) : !slidevPreviewUrl ? (
	                  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
	                    Starting Slidev…
	                  </div>
	                ) : (
	                  <iframe
	                    title="Slidev Preview"
	                    src={slidevPreviewUrl}
	                    className="flex-1 w-full bg-white"
	                    referrerPolicy="no-referrer"
	                  />
	                )}

	                <div className="px-3 py-2 border-t border-border text-[11px] text-muted-foreground">
	                  このプレビューは Slidev dev server を利用します（Docker の場合は `3030` ポートを使用）。
	                </div>
	              </div>
	            )}
	          </div>
	        </div>

	        {/* Footer */}
	        <div className="px-4 py-3 border-t border-border bg-card text-xs text-muted-foreground">
	          PPTXは編集可能なテキスト中心、PDFは見た目優先（画像ベース）で出力します。
        </div>
      </div>

      {/* Offscreen export slide - Enhanced Design */}
      <div
        style={{ position: 'fixed', left: -99999, top: 0 }}
        aria-hidden="true"
      >
        <div
          ref={exportSlideRef}
          style={{ width: 1280, height: 720 }}
          className="bg-white text-black relative overflow-hidden"
        >
          {/* Top accent bar */}
          <div
            className="absolute top-0 left-0 right-0 h-2"
            style={{
              background: exportIndex === 0
                ? PREVIEW_COLORS.primary
                : slideForExport?.chart?.type
                  ? PREVIEW_COLORS.secondary
                  : hasTableData(slideForExport?.table)
                    ? PREVIEW_COLORS.accent3
                    : PREVIEW_COLORS.primary
            }}
          />

          {/* Title Slide Layout - Title Only, No Bullets */}
          {exportIndex === 0 ? (
            <div
              className="h-full flex flex-col items-center justify-center p-16 text-center"
              style={{ background: PREVIEW_COLORS.primaryLight }}
            >
              <div className="text-8xl mb-10">{getIconForTitle(slideForExport?.title || deck.title || '')}</div>
              <h1 className="text-6xl font-bold mb-8" style={{ color: PREVIEW_COLORS.text }}>
                {slideForExport?.title || deck.title || 'Presentation'}
              </h1>
              <div className="mt-8 h-px w-40" style={{ background: PREVIEW_COLORS.primaryMid }} />
              <div className="mt-6 text-lg" style={{ color: PREVIEW_COLORS.primary }}>
                AI Generated Presentation
              </div>
            </div>
          ) : detectSlideLayout(slideForExport!, exportIndex) === 'card' ? (
            /* Card Layout for Export - 2x2 Grid */
            <div className="h-full flex flex-col">
              {/* Header bar */}
              <div
                className="h-16 flex items-center px-8 gap-4"
                style={{ background: '#0D4F6F' }}
              >
                <span className="text-3xl">{getIconForTitle(slideForExport?.title || '')}</span>
                <h2 className="text-2xl font-semibold text-white flex-1">
                  {slideForExport?.title || 'Slide'}
                </h2>
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
                  style={{ background: '#FFFFFF', color: '#0D4F6F' }}
                >
                  {exportIndex + 1}
                </div>
              </div>
              {/* Card Grid */}
              <div className="flex-1 p-6 grid grid-cols-2 gap-4">
                {(slideForExport?.bullets || []).slice(0, 4).map((bullet, i) => {
                  const accentColor = CARD_ACCENT_COLORS[i % CARD_ACCENT_COLORS.length];
                  const colonIdx = bullet.indexOf('：') !== -1 ? bullet.indexOf('：') : bullet.indexOf(':');
                  let cardTitle = `ポイント ${i + 1}`;
                  let cardDesc = bullet;
                  if (colonIdx !== -1 && colonIdx < 30) {
                    cardTitle = bullet.slice(0, colonIdx).trim();
                    cardDesc = bullet.slice(colonIdx + 1).trim();
                  }
                  return (
                    <div
                      key={i}
                      className="rounded-xl overflow-hidden flex"
                      style={{ background: '#FFFFFF', border: '2px solid #E5E7EB', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                    >
                      {/* Accent bar */}
                      <div className="w-3 flex-shrink-0" style={{ background: accentColor }} />
                      <div className="flex-1 p-5">
                        <div className="flex items-center gap-3 mb-3">
                          <span
                            className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                            style={{ background: `${accentColor}20` }}
                          >
                            {getIconForBullet(bullet, i)}
                          </span>
                          <span className="text-xl font-semibold" style={{ color: PREVIEW_COLORS.text }}>
                            {cardTitle}
                          </span>
                        </div>
                        <p className="text-base leading-relaxed" style={{ color: PREVIEW_COLORS.textLight }}>
                          {cardDesc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* More indicator */}
              {(slideForExport?.bullets || []).length > 4 && (
                <div className="px-8 pb-4 text-sm text-right" style={{ color: PREVIEW_COLORS.textMuted }}>
                  + {(slideForExport?.bullets || []).length - 4} more items...
                </div>
              )}
            </div>
          ) : (
            /* Content Slide Layout */
            <div className="h-full p-12 flex flex-col">
              {/* Header */}
              <div className="flex items-center gap-4 mb-6">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl"
                  style={{ background: PREVIEW_COLORS.primaryLight, border: `2px solid ${PREVIEW_COLORS.primaryMid}` }}
                >
                  {slideForExport?.chart?.type ? '📊' :
                   hasTableData(slideForExport?.table) ? '📋' :
                   (exportDiagramSvg || exportImage) ? '🖼️' :
                   getIconForTitle(slideForExport?.title || '')}
                </div>
                <h2 className="text-4xl font-bold flex-1" style={{ color: PREVIEW_COLORS.text }}>
                  {slideForExport?.title || 'Slide'}
                </h2>
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold text-white"
                  style={{ background: PREVIEW_COLORS.primary }}
                >
                  {exportIndex + 1}
                </div>
              </div>

              {/* Main content */}
              <div className="flex-1 flex gap-8 min-h-0">
                {/* Left: Bullets */}
                <div className={cn(
                  "flex-1",
                  (exportDiagramSvg || showExportImage || showExportChart || showExportTable) ? "max-w-[55%]" : "w-full"
                )}>
                  <ul className="space-y-3">
                    {(slideForExport?.bullets || []).slice(0, 8).map((b, i) => (
                      <li key={i} className="flex items-start gap-3 text-xl" style={{ color: PREVIEW_COLORS.text }}>
                        <span
                          className="mt-1 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{ background: PREVIEW_COLORS.primaryLight, color: PREVIEW_COLORS.primary }}
                        >
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Right: Visual content */}
                {(exportDiagramSvg || showExportImage || showExportChart || showExportTable) && (
                  <div
                    className="w-[45%] rounded-2xl p-4 flex items-center justify-center overflow-hidden"
                    style={{ background: PREVIEW_COLORS.backgroundAlt, border: `2px solid ${PREVIEW_COLORS.border}` }}
                  >
                    {exportDiagramSvg ? (
                      <div
                        className="w-full max-h-full overflow-hidden"
                        dangerouslySetInnerHTML={{ __html: exportDiagramSvg }}
                      />
                    ) : showExportImage ? (
                      <img
                        src={exportImage}
                        alt="Slide visual"
                        className="max-w-full max-h-full object-contain rounded-lg"
                      />
                    ) : showExportChart ? (
                      <img
                        src={exportChartUrl}
                        alt="Slide chart"
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : showExportTable ? (
                      <div className="w-full overflow-auto">
                        <table className="w-full text-base">
                          {exportTable?.headers && exportTable.headers.length > 0 && (
                            <thead>
                              <tr>
                                {exportTable.headers.map((h, i) => (
                                  <th
                                    key={i}
                                    className="text-left font-bold px-4 py-3 text-white"
                                    style={{ background: PREVIEW_COLORS.primary }}
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                          )}
                          <tbody>
                            {(exportTable?.rows || []).map((row, rIdx) => (
                              <tr key={rIdx}>
                                {(row || []).map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className="px-4 py-2"
                                    style={{
                                      background: rIdx % 2 === 0 ? PREVIEW_COLORS.backgroundAlt : PREVIEW_COLORS.background,
                                      borderBottom: `1px solid ${PREVIEW_COLORS.border}`
                                    }}
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Takeaway box */}
              {(slideForExport?.bullets || []).length > 0 && (
                <div
                  className="mt-4 px-6 py-3 rounded-xl text-base"
                  style={{ background: PREVIEW_COLORS.primaryLight, border: `1px solid ${PREVIEW_COLORS.primaryMid}`, color: PREVIEW_COLORS.primaryDark }}
                >
                  💡 <strong>Takeaway:</strong> {slideForExport?.title}のポイントを整理し、次のアクションを明確化
                </div>
              )}

              {/* Citations footer */}
              {(slideForExport?.citations || []).length > 0 && (
                <div className="mt-3 text-sm" style={{ color: PREVIEW_COLORS.textMuted }}>
                  📚 Sources: {(slideForExport?.citations || []).slice(0, 4).map((c, i) => (
                    <span key={i}>
                      {i > 0 ? ' • ' : ''}
                      {c.source_title || 'Source'}{c.source_id != null ? ` (#${c.source_id})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
