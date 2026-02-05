'use client';

import { cn } from '@/lib/utils';
import { HTMLAttributes, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  FileDown,
  Pencil,
  Plus,
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
  bullets: string[];
  diagram_mermaid?: string;
  table?: SlideTable | null;
  image_url?: string;
  image_data_url?: string;
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
  const exportSlideRef = useRef<HTMLDivElement>(null);
  const exportPngCacheRef = useRef<{ fingerprint: string; pngs: string[] } | null>(null);
  const selectedSlide = useMemo(() => deck.slides[selectedIndex], [deck.slides, selectedIndex]);
  const [chartDraft, setChartDraft] = useState('');
  const chartUrl = useMemo(
    () => chartToQuickchartUrl(selectedSlide?.chart || null),
    [selectedSlide?.chart]
  );

  useEffect(() => {
    if (!open) return;
    setChartDraft(chartToJson(selectedSlide?.chart || null));
  }, [open, selectedSlide?.id, selectedSlide?.chart]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    setInstruction('');
    setSelectedDiagramSvg('');
    setExportDiagramSvg('');
    setExporting(null);
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
                        <div className="min-w-0">
                          <div className="text-[11px] text-muted-foreground">
                            {idx + 1}
                          </div>
                          <div className="text-xs font-medium text-foreground truncate">
                            {s.title || 'Slide'}
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

          {/* Editor */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedSlide ? (
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {/* Preview */}
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <Pencil className="w-3.5 h-3.5" />
                    Preview
                  </div>
                  <div className="text-lg font-semibold text-foreground">
                    {selectedSlide.title || 'Slide'}
                  </div>
                  <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-foreground/90">
                    {(selectedSlide.bullets || []).map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                    {(selectedSlide.bullets || []).length === 0 && (
                      <li className="text-muted-foreground">（内容なし）</li>
                    )}
                  </ul>
                  {getSlideImageSrc(selectedSlide) && (
                    <div className="mt-3 rounded-lg border border-border bg-background p-2">
                      <img
                        src={getSlideImageSrc(selectedSlide)}
                        alt="Slide visual"
                        className="max-h-52 w-auto object-contain"
                      />
                    </div>
                  )}
                  {chartUrl && (
                    <div className="mt-3 rounded-lg border border-border bg-background p-2">
                      <img
                        src={chartUrl}
                        alt="Slide chart"
                        className="max-h-52 w-auto object-contain"
                      />
                    </div>
                  )}
                  {hasTableData(selectedSlide.table) && (
                    <div className="mt-3 overflow-auto">
                      <table className="w-full text-xs border border-border">
                        {selectedSlide.table?.headers && selectedSlide.table.headers.length > 0 && (
                          <thead className="bg-muted/40">
                            <tr>
                              {selectedSlide.table.headers.map((h, i) => (
                                <th key={i} className="text-left font-medium px-2 py-1 border border-border">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {(selectedSlide.table?.rows || []).map((row, rIdx) => (
                            <tr key={rIdx}>
                              {(row || []).map((cell, cIdx) => (
                                <td key={cIdx} className="px-2 py-1 border border-border">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border bg-card text-xs text-muted-foreground">
          PPTXは編集可能なテキスト中心、PDFは見た目優先（画像ベース）で出力します。
        </div>
      </div>

      {/* Offscreen export slide */}
      <div
        style={{ position: 'fixed', left: -99999, top: 0 }}
        aria-hidden="true"
      >
        <div
          ref={exportSlideRef}
          style={{ width: 1280, height: 720 }}
          className="bg-white text-black"
        >
          <div className="h-full w-full p-16 flex flex-col">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-black/5 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-7 h-7 text-black/70" />
              </div>
              <div className="text-4xl font-semibold leading-tight">
                {slideForExport?.title || deck.title || 'Slide'}
              </div>
            </div>
            <div className="mt-6 flex-1 grid grid-cols-5 gap-10">
              <div className={cn('col-span-3', 'text-xl leading-relaxed')}>
                <ul className="list-disc pl-6 space-y-2">
                  {(slideForExport?.bullets || []).slice(0, 10).map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
              <div className="col-span-2">
                {exportDiagramSvg && (
                  <div className="w-full h-full border border-black/10 rounded-xl p-3 overflow-hidden flex items-center justify-center">
                    <div
                      className="w-full"
                      dangerouslySetInnerHTML={{ __html: exportDiagramSvg }}
                    />
                  </div>
                )}
                {showExportImage && (
                  <div className="w-full h-full border border-black/10 rounded-xl p-3 overflow-hidden flex items-center justify-center">
                    <img
                      src={exportImage}
                      alt="Slide visual"
                      className="max-h-full w-auto object-contain"
                    />
                  </div>
                )}
                {showExportChart && (
                  <div className="w-full h-full border border-black/10 rounded-xl p-3 overflow-hidden flex items-center justify-center">
                    <img
                      src={exportChartUrl}
                      alt="Slide chart"
                      className="max-h-full w-auto object-contain"
                    />
                  </div>
                )}
                {showExportTable && (
                  <div className="w-full h-full border border-black/10 rounded-xl p-4 overflow-auto">
                    <table className="w-full text-[14px] border border-black/10">
                      {exportTable?.headers && exportTable.headers.length > 0 && (
                        <thead>
                          <tr>
                            {exportTable.headers.map((h, i) => (
                              <th key={i} className="text-left font-semibold px-2 py-1 border border-black/10">
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
                              <td key={cIdx} className="px-2 py-1 border border-black/10">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            {(slideForExport?.citations || []).length > 0 && (
              <div className="mt-6 text-[13px] text-black/70">
                Sources:{' '}
                {(slideForExport?.citations || []).slice(0, 4).map((c, i) => (
                  <span key={i}>
                    {i > 0 ? ' / ' : ''}
                    {(c.source_title || 'Source') + (c.source_id != null ? `(#${c.source_id})` : '')}
                  </span>
                ))}
              </div>
            )}
            {exporting && (
              <div className="mt-2 text-[12px] text-black/50">
                Exporting {exporting.toUpperCase()}… ({exportIndex + 1}/{deck.slides.length})
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
