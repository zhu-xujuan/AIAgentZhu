import PptxGenJS from 'pptxgenjs';

export const runtime = 'nodejs';

// ============================================================
// TYPES
// ============================================================

type RequestBody = {
  title?: string;
  pngs?: string[];
  deck?: {
    title?: string;
    summary?: string;
    slides: Array<SlideData>;
  };
  diagram_pngs?: Array<string | null>;
};

type SlideData = {
  title?: string;
  bullets?: string[];
  speaker_notes?: string;
  table?: { headers?: string[]; rows?: string[][] };
  image_url?: string;
  image_data_url?: string;
  diagram_mermaid?: string;
  chart?: {
    type?: string;
    title?: string;
    labels?: string[];
    datasets?: Array<{ label?: string; data?: number[] }>;
  };
  citations?: Array<{ source_id?: number | null; source_title?: string; quote?: string }>;
  layout?: 'title' | 'content' | 'visual' | 'comparison' | 'table';
};

// ============================================================
// COLOR SCHEME (Professional Corporate Theme)
// ============================================================

const COLORS = {
  // Primary palette
  primary: '4F46E5',      // Indigo-600
  primaryLight: 'EEF2FF', // Indigo-50
  primaryMid: 'C7D2FE',   // Indigo-200
  primaryDark: '3730A3',  // Indigo-800

  // Secondary palette
  secondary: '0EA5E9',    // Sky-500
  secondaryLight: 'E0F2FE', // Sky-50

  // Accent colors for charts
  accent1: '4F46E5',      // Indigo
  accent2: '0EA5E9',      // Sky
  accent3: '10B981',      // Emerald
  accent4: 'F59E0B',      // Amber
  accent5: 'EF4444',      // Red
  accent6: '8B5CF6',      // Violet

  // Neutral
  text: '111827',         // Gray-900
  textLight: '6B7280',    // Gray-500
  textMuted: '9CA3AF',    // Gray-400
  background: 'FFFFFF',
  backgroundAlt: 'F9FAFB', // Gray-50
  border: 'E5E7EB',       // Gray-200

  // Table colors
  tableHeader: '4F46E5',
  tableHeaderText: 'FFFFFF',
  tableRowEven: 'F9FAFB',
  tableRowOdd: 'FFFFFF',
};

const CHART_COLORS = [COLORS.accent1, COLORS.accent2, COLORS.accent3, COLORS.accent4, COLORS.accent5, COLORS.accent6];

// Card accent colors (like Claude's PPTX)
const CARD_ACCENT_COLORS = [
  'F4A261',  // Orange
  '6BB8C9',  // Cyan
  '10B981',  // Green (Emerald)
  'E91E63',  // Pink
  '8B5CF6',  // Violet
  'F59E0B',  // Amber
];

// ============================================================
// TOPIC ICONS (Unicode-based for universal compatibility)
// ============================================================

const TOPIC_ICONS: Record<string, string> = {
  // Japanese keywords
  '概要': '📋',
  '紹介': '👋',
  'まとめ': '✅',
  '結論': '🎯',
  '比較': '⚖️',
  '分析': '📊',
  'データ': '📈',
  'ワークフロー': '🔄',
  'プロセス': '⚙️',
  '計画': '📅',
  'スケジュール': '📅',
  '課題': '⚠️',
  '問題': '❗',
  '解決': '💡',
  '提案': '💡',
  'ポイント': '📌',
  '要点': '📌',
  'チーム': '👥',
  '組織': '🏢',
  'コスト': '💰',
  '予算': '💰',
  '技術': '🔧',
  'システム': '🖥️',
  'セキュリティ': '🔒',
  '品質': '✨',
  '目標': '🎯',
  // English keywords
  'overview': '📋',
  'summary': '✅',
  'conclusion': '🎯',
  'comparison': '⚖️',
  'analysis': '📊',
  'workflow': '🔄',
  'process': '⚙️',
  'plan': '📅',
  'issue': '⚠️',
  'solution': '💡',
  'team': '👥',
  'cost': '💰',
  'budget': '💰',
  'technology': '🔧',
  'security': '🔒',
  'quality': '✨',
  'goal': '🎯',
};

function getIconForTitle(title: string): string {
  const lowerTitle = title.toLowerCase();
  for (const [keyword, icon] of Object.entries(TOPIC_ICONS)) {
    if (lowerTitle.includes(keyword.toLowerCase())) {
      return icon;
    }
  }
  return '📄'; // Default document icon
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function isPngDataUrl(value: string) {
  return typeof value === 'string' && value.startsWith('data:image/png');
}

function sanitizeXmlText(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

function safeText(value: unknown) {
  if (typeof value !== 'string') return '';
  return sanitizeXmlText(value);
}

function safeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => safeText(v)).filter(Boolean);
}

function toTakeaway(title: string, bullets: string[]) {
  const t = safeText(title).trim() || 'このスライド';
  const b = bullets
    .slice(0, 2)
    .map((x) => safeText(x).replace(/[。.!?]$/g, '').trim())
    .filter(Boolean);
  if (b.length === 0) return `${t}のポイントを整理し、次のアクションを明確化します。`;
  return `${t}では「${b.join(' / ')}」を中心に整理し、実行判断に繋げます。`;
}

function normalizeTable(table?: { headers?: string[]; rows?: string[][] }) {
  if (!table) return null;
  const headers = safeStringArray(table.headers);
  const rowsIn = Array.isArray(table.rows) ? table.rows : [];
  const rows = rowsIn
    .filter((r) => Array.isArray(r))
    .map((r) => r.map((c) => safeText(c)));

  const maxCols = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  if (maxCols === 0) return null;

  const limitedCols = Math.min(maxCols, 6);
  const limitedHeaders = headers.slice(0, limitedCols);
  const limitedRows = rows.slice(0, 12).map((r) => r.slice(0, limitedCols));

  const padRow = (r: string[]) => {
    const next = r.slice(0, limitedCols);
    while (next.length < limitedCols) next.push('');
    return next;
  };

  return {
    headers: padRow(limitedHeaders),
    rows: limitedRows.map(padRow),
    colCount: limitedCols,
  };
}

function isImageDataUrl(value: string) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

// ============================================================
// LAYOUT DETECTION
// ============================================================

type LayoutType = 'title' | 'content' | 'visual' | 'table' | 'chart' | 'card';

function hasValidChartData(chart?: SlideData['chart']): boolean {
  if (!chart || !chart.type) return false;
  const labels = Array.isArray(chart.labels) ? chart.labels : [];
  const datasets = Array.isArray(chart.datasets) ? chart.datasets : [];
  if (labels.length === 0 || datasets.length === 0) return false;
  // Check if any dataset has actual numeric data
  return datasets.some(ds => Array.isArray(ds.data) && ds.data.length > 0 && ds.data.some(v => typeof v === 'number' && v !== 0));
}

function hasValidTableData(table?: SlideData['table']): boolean {
  if (!table) return false;
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  // Need at least headers or rows with actual content
  const hasHeaders = headers.some(h => h && h.trim().length > 0);
  const hasRows = rows.some(r => Array.isArray(r) && r.some(c => c && c.trim().length > 0));
  return hasHeaders || hasRows;
}

function detectLayout(slideData: SlideData, idx: number, totalSlides: number): LayoutType {
  // First slide is always title layout
  if (idx === 0) return 'title';

  // Auto-detect based on actual content availability
  const hasChart = hasValidChartData(slideData.chart);
  const hasTable = hasValidTableData(slideData.table);
  const hasImage = slideData.image_url || slideData.image_data_url;
  const hasDiagram = slideData.diagram_mermaid && slideData.diagram_mermaid.trim().length > 0;
  const bullets = Array.isArray(slideData.bullets) ? slideData.bullets.filter(b => b && b.trim()) : [];

  // Priority: chart > table > visual > card (2-4 bullets) > content
  if (hasChart) return 'chart';
  if (hasTable) return 'table';
  if (hasImage || hasDiagram) return 'visual';

  // Use card layout for slides with 2-4 bullet points (ideal for 2x2 grid)
  if (bullets.length >= 2 && bullets.length <= 4) return 'card';

  return 'content';
}

// ============================================================
// NATIVE CHART RENDERING (using PptxGenJS)
// ============================================================

function addNativeChart(
  pptx: PptxGenJS,
  slide: any,
  chart: SlideData['chart'],
  x: number,
  y: number,
  w: number,
  h: number
) {
  if (!chart || !chart.type) return false;

  const labels = Array.isArray(chart.labels) ? chart.labels : [];
  const datasets = Array.isArray(chart.datasets) ? chart.datasets : [];

  if (labels.length === 0 || datasets.length === 0) return false;

  const chartType = chart.type.toLowerCase();
  let pptxChartType: any;

  switch (chartType) {
    case 'bar':
      pptxChartType = pptx.ChartType.bar;
      break;
    case 'line':
      pptxChartType = pptx.ChartType.line;
      break;
    case 'pie':
    case 'doughnut':
      pptxChartType = pptx.ChartType.pie;
      break;
    default:
      pptxChartType = pptx.ChartType.bar;
  }

  // Build chart data for PptxGenJS
  const chartData = datasets.map((ds, i) => ({
    name: ds.label || `Series ${i + 1}`,
    labels: labels,
    values: ds.data || [],
  }));

  const chartOptions: any = {
    x,
    y,
    w,
    h,
    showTitle: !!chart.title,
    title: chart.title || '',
    titleFontSize: 12,
    titleColor: COLORS.text,
    showLegend: datasets.length > 1,
    legendPos: 'b',
    legendFontSize: 9,
    chartColors: CHART_COLORS.slice(0, datasets.length),
    valAxisTitle: '',
    catAxisTitle: '',
    showValue: chartType !== 'line',
    dataLabelFontSize: 9,
    dataLabelColor: COLORS.textLight,
  };

  // Type-specific options
  if (chartType === 'bar') {
    chartOptions.barDir = 'bar';
    chartOptions.barGrouping = 'clustered';
    chartOptions.barGapWidthPct = 50;
  } else if (chartType === 'line') {
    chartOptions.lineSmooth = true;
    chartOptions.lineSize = 2;
    chartOptions.lineDataSymbol = 'circle';
    chartOptions.lineDataSymbolSize = 6;
  } else if (chartType === 'pie') {
    chartOptions.showPercent = true;
    chartOptions.showValue = false;
  }

  try {
    slide.addChart(pptxChartType, chartData, chartOptions);
    return true;
  } catch (e) {
    console.error('Failed to add native chart:', e);
    return false;
  }
}

// ============================================================
// FALLBACK VISUALIZATIONS (when no chart/diagram data)
// ============================================================

function renderFlowBoxes(
  pptx: PptxGenJS,
  slide: any,
  bullets: string[],
  x: number,
  y: number,
  w: number,
  h: number
) {
  const items = bullets.slice(0, 5);
  if (items.length === 0) return;

  const boxH = Math.min(0.9, (h - (items.length - 1) * 0.3) / items.length);
  const gapY = 0.3;
  const boxW = w - 0.4;
  const startX = x + 0.2;
  const colors = [COLORS.primary, COLORS.secondary, COLORS.accent3, COLORS.accent4, COLORS.accent6];

  items.forEach((item, i) => {
    const boxY = y + i * (boxH + gapY);
    const color = colors[i % colors.length];

    // Box
    slide.addShape(pptx.ShapeType.roundRect, {
      x: startX,
      y: boxY,
      w: boxW,
      h: boxH,
      fill: { color: 'FFFFFF' },
      line: { color, width: 2 },
      radius: 0.1,
    } as any);

    // Number badge
    slide.addShape(pptx.ShapeType.ellipse, {
      x: startX + 0.15,
      y: boxY + (boxH - 0.4) / 2,
      w: 0.4,
      h: 0.4,
      fill: { color },
    } as any);
    slide.addText(String(i + 1), {
      x: startX + 0.15,
      y: boxY + (boxH - 0.4) / 2,
      w: 0.4,
      h: 0.4,
      fontSize: 12,
      bold: true,
      color: 'FFFFFF',
      align: 'center',
      valign: 'mid',
    } as any);

    // Text
    slide.addText(item, {
      x: startX + 0.7,
      y: boxY + 0.1,
      w: boxW - 0.9,
      h: boxH - 0.2,
      fontSize: 13,
      color: COLORS.text,
      valign: 'mid',
    } as any);

    // Arrow connector
    if (i < items.length - 1) {
      slide.addShape(pptx.ShapeType.downArrow, {
        x: startX + boxW / 2 - 0.15,
        y: boxY + boxH + 0.05,
        w: 0.3,
        h: 0.2,
        fill: { color: COLORS.textMuted },
      } as any);
    }
  });
}

function renderTableFromBullets(
  pptx: PptxGenJS,
  slide: any,
  title: string,
  bullets: string[],
  x: number,
  y: number,
  w: number,
  h: number
) {
  const items = bullets.slice(0, 6);
  if (items.length === 0) return;

  const tableRows: any[] = [];

  // Header row
  tableRows.push([
    { text: '項目', options: { bold: true, fill: COLORS.tableHeader, color: COLORS.tableHeaderText, align: 'center' } },
    { text: '内容', options: { bold: true, fill: COLORS.tableHeader, color: COLORS.tableHeaderText, align: 'center' } },
  ]);

  // Data rows
  items.forEach((item, i) => {
    tableRows.push([
      { text: `ポイント ${i + 1}`, options: { fill: i % 2 === 0 ? COLORS.tableRowEven : COLORS.tableRowOdd, color: COLORS.text, bold: true } },
      { text: item, options: { fill: i % 2 === 0 ? COLORS.tableRowEven : COLORS.tableRowOdd, color: COLORS.text } },
    ]);
  });

  slide.addTable(tableRows, {
    x,
    y,
    w,
    colW: [w * 0.25, w * 0.75],
    rowH: Math.min(0.6, h / (items.length + 1)),
    fontSize: 12,
    border: { type: 'solid', color: COLORS.border, pt: 0.5 },
  } as any);
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const base64 = buf.toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

// ============================================================
// LAYOUT RENDERERS
// ============================================================

function renderTitleSlide(
  pptx: PptxGenJS,
  slide: any,
  s: SlideData,
  deckTitle: string,
  deckSummary: string,
  SLIDE_W: number,
  SLIDE_H: number
) {
  // Gradient-like background using overlapping shapes
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: COLORS.primaryLight },
  } as any);

  // Decorative accent bar at top
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.15,
    fill: { color: COLORS.primary },
  } as any);

  // Decorative icon (top)
  const icon = getIconForTitle(safeText(s.title) || deckTitle || '');
  slide.addText(icon, {
    x: SLIDE_W / 2 - 0.5,
    y: 2.0,
    w: 1,
    h: 1,
    fontSize: 56,
    align: 'center',
    valign: 'mid',
  } as any);

  // Main title (centered, title only - no bullets)
  slide.addText(safeText(s.title) || deckTitle || 'Presentation', {
    x: 1,
    y: 3.2,
    w: SLIDE_W - 2,
    h: 1.5,
    fontSize: 48,
    bold: true,
    color: COLORS.text,
    align: 'center',
    valign: 'mid',
  } as any);

  // Subtitle from deck summary only (not from bullets)
  const subtitle = safeText(deckSummary);
  if (subtitle) {
    slide.addText(subtitle, {
      x: 1.5,
      y: 4.8,
      w: SLIDE_W - 3,
      h: 0.8,
      fontSize: 18,
      color: COLORS.textLight,
      align: 'center',
      valign: 'top',
    } as any);
  }

  // Footer line
  slide.addShape(pptx.ShapeType.rect, {
    x: 2,
    y: SLIDE_H - 0.8,
    w: SLIDE_W - 4,
    h: 0.02,
    fill: { color: COLORS.primaryMid },
  } as any);

  // AI badge
  slide.addText('AI Generated Presentation', {
    x: SLIDE_W / 2 - 1,
    y: SLIDE_H - 0.65,
    w: 2,
    h: 0.35,
    fontSize: 10,
    color: COLORS.primary,
    align: 'center',
    valign: 'mid',
  } as any);
}

function renderContentSlide(
  pptx: PptxGenJS,
  slide: any,
  s: SlideData,
  diagramPng: string | null,
  imageDataUrl: string | null,
  SLIDE_W: number,
  SLIDE_H: number,
  slideNumber: number
) {
  const bullets = safeStringArray(s.bullets);
  const title = safeText(s.title) || 'Slide';
  const icon = getIconForTitle(title);
  const table = normalizeTable(s.table);
  const hasChart = hasValidChartData(s.chart);
  const hasTable = hasValidTableData(s.table);

  // White background
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: COLORS.background },
  } as any);

  // Top accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.08,
    fill: { color: COLORS.primary },
  } as any);

  // Icon badge with topic icon
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.5,
    y: 0.35,
    w: 0.6,
    h: 0.6,
    fill: { color: COLORS.primaryLight },
    line: { color: COLORS.primaryMid, width: 1 },
    radius: 0.1,
  } as any);
  slide.addText(icon, {
    x: 0.5,
    y: 0.4,
    w: 0.6,
    h: 0.5,
    fontSize: 20,
    align: 'center',
    valign: 'mid',
  } as any);

  // Slide number badge
  slide.addShape(pptx.ShapeType.ellipse, {
    x: SLIDE_W - 0.8,
    y: 0.35,
    w: 0.5,
    h: 0.5,
    fill: { color: COLORS.primary },
  } as any);
  slide.addText(String(slideNumber), {
    x: SLIDE_W - 0.8,
    y: 0.35,
    w: 0.5,
    h: 0.5,
    fontSize: 14,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
    valign: 'mid',
  } as any);

  // Title
  slide.addText(title, {
    x: 1.2,
    y: 0.3,
    w: SLIDE_W - 2.5,
    h: 0.75,
    fontSize: 28,
    bold: true,
    color: COLORS.text,
  } as any);

  // Determine visual content type
  const hasVisual = !!diagramPng || !!imageDataUrl || hasChart || hasTable;
  const contentWidth = hasVisual ? 7 : SLIDE_W - 1.5;

  // Bullets with custom styling (left side)
  if (bullets.length > 0) {
    const bulletItems = bullets.map((b, i) => ({
      text: b,
      options: {
        bullet: { type: 'number', style: 'arabicPeriod', color: COLORS.primary } as any,
        indentLevel: 0,
        paraSpaceBefore: i === 0 ? 0 : 6,
      },
    }));

    slide.addText(bulletItems, {
      x: 0.7,
      y: 1.3,
      w: contentWidth,
      h: 4.4,
      fontSize: 18,
      color: COLORS.text,
      lineSpacingMultiple: 1.3,
      valign: 'top',
    } as any);
  }

  // Visual content area (right side) - Priority: image/diagram > chart > table > flow boxes
  const visualX = 8.0;
  const visualY = 1.3;
  const visualW = 4.8;
  const visualH = 4.4;

  if (diagramPng || imageDataUrl) {
    // Container with shadow effect
    slide.addShape(pptx.ShapeType.roundRect, {
      x: visualX - 0.05,
      y: visualY + 0.05,
      w: visualW,
      h: visualH,
      fill: { color: COLORS.border },
      radius: 0.15,
    } as any);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: visualX,
      y: visualY,
      w: visualW,
      h: visualH,
      fill: { color: COLORS.background },
      line: { color: COLORS.border, width: 1 },
      radius: 0.15,
    } as any);

    const imgData = imageDataUrl || diagramPng;
    if (imgData) {
      slide.addImage({
        data: imgData,
        x: visualX + 0.15,
        y: visualY + 0.15,
        w: visualW - 0.3,
        h: visualH - 0.3,
        rounding: true,
      });
    }
  } else if (hasChart) {
    // Render chart on the right side
    addNativeChart(pptx, slide, s.chart, visualX, visualY, visualW, visualH);
  } else if (hasTable && table) {
    // Render table on the right side
    const tableRows: any[] = [];
    if (table.headers.some((h) => h.length > 0)) {
      tableRows.push(
        table.headers.map((h) => ({
          text: h,
          options: { bold: true, fill: COLORS.tableHeader, color: COLORS.tableHeaderText, valign: 'mid', align: 'center' },
        }))
      );
    }
    table.rows.forEach((r, rowIdx) => {
      tableRows.push(
        r.map((cell) => ({
          text: cell,
          options: { fill: rowIdx % 2 === 0 ? COLORS.tableRowEven : COLORS.tableRowOdd, color: COLORS.text, valign: 'mid' },
        }))
      );
    });
    const rowH = Math.min(0.45, visualH / Math.max(tableRows.length, 1));
    const colW = Array(table.colCount).fill(visualW / table.colCount);
    slide.addTable(tableRows, {
      x: visualX,
      y: visualY,
      w: visualW,
      colW,
      rowH,
      fontSize: 10,
      border: { type: 'solid', color: COLORS.border, pt: 0.5 },
    } as any);
  } else if (bullets.length > 0) {
    // Fallback: render flow boxes from bullets
    renderFlowBoxes(pptx, slide, bullets, visualX, visualY, visualW, visualH);
  }

  // Takeaway box
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.7,
    y: 5.9,
    w: hasVisual ? 7 : SLIDE_W - 1.4,
    h: 0.85,
    fill: { color: COLORS.primaryLight },
    line: { color: COLORS.primaryMid, width: 1 },
    radius: 0.1,
  } as any);
  slide.addText(`💡 ${toTakeaway(title, bullets)}`, {
    x: 0.85,
    y: 6.0,
    w: hasVisual ? 6.7 : SLIDE_W - 1.7,
    h: 0.65,
    fontSize: 11,
    color: COLORS.primaryDark,
  } as any);

  // Citations footer
  const citations = Array.isArray(s.citations) ? s.citations : [];
  const sources = citations.slice(0, 3).map((c) => safeText(c?.source_title) || 'Source').filter(Boolean);
  if (sources.length > 0) {
    slide.addText(`📚 ${sources.join(' • ')}`, {
      x: 0.7,
      y: SLIDE_H - 0.45,
      w: SLIDE_W - 1.4,
      h: 0.35,
      fontSize: 9,
      color: COLORS.textMuted,
    } as any);
  }

  // Speaker notes
  const notes = safeText(s.speaker_notes);
  if (notes) {
    slide.addNotes(notes);
  }
}

function renderChartSlide(
  pptx: PptxGenJS,
  slide: any,
  s: SlideData,
  SLIDE_W: number,
  SLIDE_H: number,
  slideNumber: number
) {
  const title = safeText(s.title) || 'Chart';
  const bullets = safeStringArray(s.bullets);
  const icon = getIconForTitle(title);

  // Background
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: COLORS.background },
  } as any);

  // Top accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.08,
    fill: { color: COLORS.secondary },
  } as any);

  // Icon badge
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.5,
    y: 0.35,
    w: 0.6,
    h: 0.6,
    fill: { color: COLORS.secondaryLight },
    line: { color: COLORS.secondary, width: 1 },
    radius: 0.1,
  } as any);
  slide.addText('📊', {
    x: 0.5,
    y: 0.4,
    w: 0.6,
    h: 0.5,
    fontSize: 20,
    align: 'center',
    valign: 'mid',
  } as any);

  // Slide number
  slide.addShape(pptx.ShapeType.ellipse, {
    x: SLIDE_W - 0.8,
    y: 0.35,
    w: 0.5,
    h: 0.5,
    fill: { color: COLORS.secondary },
  } as any);
  slide.addText(String(slideNumber), {
    x: SLIDE_W - 0.8,
    y: 0.35,
    w: 0.5,
    h: 0.5,
    fontSize: 14,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
    valign: 'mid',
  } as any);

  // Title
  slide.addText(title, {
    x: 1.2,
    y: 0.3,
    w: SLIDE_W - 2.5,
    h: 0.75,
    fontSize: 28,
    bold: true,
    color: COLORS.text,
  } as any);

  // Chart area (larger, centered)
  const chartX = 0.8;
  const chartY = 1.2;
  const chartW = 8;
  const chartH = 5.0;

  const chartSuccess = addNativeChart(pptx, slide, s.chart, chartX, chartY, chartW, chartH);

  // Fallback: if chart failed or no data, render flow boxes from bullets
  if (!chartSuccess && bullets.length > 0) {
    renderFlowBoxes(pptx, slide, bullets, chartX, chartY, chartW, chartH);
  }

  // Key points on the right side
  if (bullets.length > 0) {
    slide.addText('Key Points', {
      x: 9.2,
      y: 1.2,
      w: 3.6,
      h: 0.4,
      fontSize: 14,
      bold: true,
      color: COLORS.text,
    } as any);

    const pointItems = bullets.slice(0, 4).map((b, i) => ({
      text: `${i + 1}. ${b}`,
      options: { paraSpaceBefore: i === 0 ? 0 : 4 },
    }));

    slide.addText(pointItems, {
      x: 9.2,
      y: 1.7,
      w: 3.6,
      h: 4.5,
      fontSize: 12,
      color: COLORS.textLight,
      lineSpacingMultiple: 1.4,
      valign: 'top',
    } as any);
  }

  // Citations
  const citations = Array.isArray(s.citations) ? s.citations : [];
  const sources = citations.slice(0, 2).map((c) => safeText(c?.source_title)).filter(Boolean);
  if (sources.length > 0) {
    slide.addText(`📚 ${sources.join(' • ')}`, {
      x: 0.7,
      y: SLIDE_H - 0.45,
      w: SLIDE_W - 1.4,
      h: 0.35,
      fontSize: 9,
      color: COLORS.textMuted,
    } as any);
  }

  // Speaker notes
  const notes = safeText(s.speaker_notes);
  if (notes) {
    slide.addNotes(notes);
  }
}

function renderTableSlide(
  pptx: PptxGenJS,
  slide: any,
  s: SlideData,
  SLIDE_W: number,
  SLIDE_H: number,
  slideNumber: number
) {
  const title = safeText(s.title) || 'Table';
  const table = normalizeTable(s.table);

  // Background
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: COLORS.background },
  } as any);

  // Top accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.08,
    fill: { color: COLORS.accent3 },
  } as any);

  // Icon badge
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.5,
    y: 0.35,
    w: 0.6,
    h: 0.6,
    fill: { color: 'D1FAE5' },
    line: { color: COLORS.accent3, width: 1 },
    radius: 0.1,
  } as any);
  slide.addText('📋', {
    x: 0.5,
    y: 0.4,
    w: 0.6,
    h: 0.5,
    fontSize: 20,
    align: 'center',
    valign: 'mid',
  } as any);

  // Slide number
  slide.addShape(pptx.ShapeType.ellipse, {
    x: SLIDE_W - 0.8,
    y: 0.35,
    w: 0.5,
    h: 0.5,
    fill: { color: COLORS.accent3 },
  } as any);
  slide.addText(String(slideNumber), {
    x: SLIDE_W - 0.8,
    y: 0.35,
    w: 0.5,
    h: 0.5,
    fontSize: 14,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
    valign: 'mid',
  } as any);

  // Title
  slide.addText(title, {
    x: 1.2,
    y: 0.3,
    w: SLIDE_W - 2.5,
    h: 0.75,
    fontSize: 28,
    bold: true,
    color: COLORS.text,
  } as any);

  // Render table with improved styling
  const tableX = 0.8;
  const tableY = 1.3;
  const tableW = SLIDE_W - 1.6;
  const maxTableH = 5.2;

  if (table) {
    const tableRows: any[] = [];

    // Header row with primary color
    if (table.headers.some((h) => h.length > 0)) {
      tableRows.push(
        table.headers.map((h) => ({
          text: h,
          options: {
            bold: true,
            fill: COLORS.tableHeader,
            color: COLORS.tableHeaderText,
            valign: 'mid',
            align: 'center',
          },
        }))
      );
    }

    // Data rows with alternating colors
    table.rows.forEach((r, rowIdx) => {
      tableRows.push(
        r.map((cell) => ({
          text: cell,
          options: {
            fill: rowIdx % 2 === 0 ? COLORS.tableRowEven : COLORS.tableRowOdd,
            color: COLORS.text,
            valign: 'mid',
          },
        }))
      );
    });

    const rowCount = tableRows.length;
    const rowH = Math.min(0.5, maxTableH / Math.max(rowCount, 1));
    const colW = Array(table.colCount).fill(tableW / table.colCount);

    slide.addTable(tableRows, {
      x: tableX,
      y: tableY,
      w: tableW,
      colW,
      rowH,
      fontSize: 11,
      fontFace: 'Arial',
      border: { type: 'solid', color: COLORS.border, pt: 0.5 },
      autoPage: false,
    } as any);
  } else {
    // Fallback: generate table from bullets
    const bullets = safeStringArray(s.bullets);
    if (bullets.length > 0) {
      renderTableFromBullets(pptx, slide, title, bullets, tableX, tableY, tableW, maxTableH);
    }
  }

  // Citations
  const citations = Array.isArray(s.citations) ? s.citations : [];
  const sources = citations.slice(0, 2).map((c) => safeText(c?.source_title)).filter(Boolean);
  if (sources.length > 0) {
    slide.addText(`📚 ${sources.join(' • ')}`, {
      x: 0.7,
      y: SLIDE_H - 0.45,
      w: SLIDE_W - 1.4,
      h: 0.35,
      fontSize: 9,
      color: COLORS.textMuted,
    } as any);
  }

  // Speaker notes
  const notes = safeText(s.speaker_notes);
  if (notes) {
    slide.addNotes(notes);
  }
}

function renderVisualSlide(
  pptx: PptxGenJS,
  slide: any,
  s: SlideData,
  diagramPng: string | null,
  imageDataUrl: string | null,
  SLIDE_W: number,
  SLIDE_H: number,
  slideNumber: number
) {
  const title = safeText(s.title) || 'Visual';
  const bullets = safeStringArray(s.bullets);

  // Background
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: COLORS.background },
  } as any);

  // Top accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.08,
    fill: { color: COLORS.accent6 },
  } as any);

  // Icon badge
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.5,
    y: 0.35,
    w: 0.6,
    h: 0.6,
    fill: { color: 'EDE9FE' },
    line: { color: COLORS.accent6, width: 1 },
    radius: 0.1,
  } as any);
  slide.addText('🖼️', {
    x: 0.5,
    y: 0.4,
    w: 0.6,
    h: 0.5,
    fontSize: 20,
    align: 'center',
    valign: 'mid',
  } as any);

  // Slide number
  slide.addShape(pptx.ShapeType.ellipse, {
    x: SLIDE_W - 0.8,
    y: 0.35,
    w: 0.5,
    h: 0.5,
    fill: { color: COLORS.accent6 },
  } as any);
  slide.addText(String(slideNumber), {
    x: SLIDE_W - 0.8,
    y: 0.35,
    w: 0.5,
    h: 0.5,
    fontSize: 14,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
    valign: 'mid',
  } as any);

  // Title
  slide.addText(title, {
    x: 1.2,
    y: 0.3,
    w: SLIDE_W - 2.5,
    h: 0.75,
    fontSize: 28,
    bold: true,
    color: COLORS.text,
  } as any);

  // Large visual area (centered)
  const visualX = 1.5;
  const visualY = 1.2;
  const visualW = 7;
  const visualH = 5.0;

  // Shadow
  slide.addShape(pptx.ShapeType.roundRect, {
    x: visualX + 0.08,
    y: visualY + 0.08,
    w: visualW,
    h: visualH,
    fill: { color: COLORS.border },
    radius: 0.2,
  } as any);

  // Container
  slide.addShape(pptx.ShapeType.roundRect, {
    x: visualX,
    y: visualY,
    w: visualW,
    h: visualH,
    fill: { color: COLORS.background },
    line: { color: COLORS.border, width: 1 },
    radius: 0.2,
  } as any);

  const imgData = imageDataUrl || diagramPng;
  if (imgData) {
    slide.addImage({
      data: imgData,
      x: visualX + 0.2,
      y: visualY + 0.2,
      w: visualW - 0.4,
      h: visualH - 0.4,
    });
  } else if (bullets.length > 0) {
    // Fallback: render flow boxes if no image/diagram
    renderFlowBoxes(pptx, slide, bullets, visualX + 0.2, visualY + 0.2, visualW - 0.4, visualH - 0.4);
  }

  // Key points on the right
  if (bullets.length > 0) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 9.0,
      y: 1.2,
      w: 3.8,
      h: 5.0,
      fill: { color: COLORS.backgroundAlt },
      line: { color: COLORS.border, width: 1 },
      radius: 0.15,
    } as any);

    slide.addText('Key Points', {
      x: 9.2,
      y: 1.4,
      w: 3.4,
      h: 0.4,
      fontSize: 13,
      bold: true,
      color: COLORS.text,
    } as any);

    const pointItems = bullets.slice(0, 5).map((b, i) => ({
      text: b,
      options: {
        bullet: { code: '25CF', color: COLORS.accent6 } as any,
        paraSpaceBefore: i === 0 ? 0 : 4,
      },
    }));

    slide.addText(pointItems, {
      x: 9.2,
      y: 1.9,
      w: 3.4,
      h: 4.0,
      fontSize: 11,
      color: COLORS.textLight,
      lineSpacingMultiple: 1.3,
      valign: 'top',
    } as any);
  }

  // Citations
  const citations = Array.isArray(s.citations) ? s.citations : [];
  const sources = citations.slice(0, 2).map((c) => safeText(c?.source_title)).filter(Boolean);
  if (sources.length > 0) {
    slide.addText(`📚 ${sources.join(' • ')}`, {
      x: 0.7,
      y: SLIDE_H - 0.45,
      w: SLIDE_W - 1.4,
      h: 0.35,
      fontSize: 9,
      color: COLORS.textMuted,
    } as any);
  }

  // Speaker notes
  const notes = safeText(s.speaker_notes);
  if (notes) {
    slide.addNotes(notes);
  }
}

// ============================================================
// CARD LAYOUT RENDERER (Claude-style 2x2 grid)
// ============================================================

function renderCardLayoutSlide(
  pptx: PptxGenJS,
  slide: any,
  s: SlideData,
  SLIDE_W: number,
  SLIDE_H: number,
  slideNumber: number
) {
  const bullets = safeStringArray(s.bullets);
  const title = safeText(s.title) || 'Slide';
  const icon = getIconForTitle(title);

  // White background
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: COLORS.background },
  } as any);

  // Header bar (dark blue like Claude's PPTX)
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 1.0,
    fill: { color: '0D4F6F' },
  } as any);

  // Icon badge in header
  slide.addText(icon, {
    x: 0.5,
    y: 0.2,
    w: 0.6,
    h: 0.6,
    fontSize: 24,
    align: 'center',
    valign: 'mid',
  } as any);

  // Title in header (white text)
  slide.addText(title, {
    x: 1.2,
    y: 0.15,
    w: SLIDE_W - 2.5,
    h: 0.7,
    fontSize: 28,
    bold: true,
    color: 'FFFFFF',
    valign: 'mid',
  } as any);

  // Slide number badge in header
  slide.addShape(pptx.ShapeType.ellipse, {
    x: SLIDE_W - 0.8,
    y: 0.25,
    w: 0.5,
    h: 0.5,
    fill: { color: 'FFFFFF' },
  } as any);
  slide.addText(String(slideNumber), {
    x: SLIDE_W - 0.8,
    y: 0.25,
    w: 0.5,
    h: 0.5,
    fontSize: 14,
    bold: true,
    color: '0D4F6F',
    align: 'center',
    valign: 'mid',
  } as any);

  // Card grid layout (2x2)
  const cardStartX = 0.5;
  const cardStartY = 1.3;
  const cardW = 6.15;  // ~half of slide width with gaps
  const cardH = 2.8;   // 2 rows fit in remaining space
  const gapX = 0.5;
  const gapY = 0.4;

  // Extract card items (max 4 for 2x2 grid)
  const cardItems = bullets.slice(0, 4);

  cardItems.forEach((bulletText, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = cardStartX + col * (cardW + gapX);
    const y = cardStartY + row * (cardH + gapY);
    const accentColor = CARD_ACCENT_COLORS[i % CARD_ACCENT_COLORS.length];

    // Card shadow
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.05,
      y: y + 0.05,
      w: cardW,
      h: cardH,
      fill: { color: 'E5E7EB' },
    } as any);

    // Card background
    slide.addShape(pptx.ShapeType.rect, {
      x: x,
      y: y,
      w: cardW,
      h: cardH,
      fill: { color: 'FFFFFF' },
      line: { color: 'E5E7EB', width: 1 },
    } as any);

    // Left accent bar
    slide.addShape(pptx.ShapeType.rect, {
      x: x,
      y: y,
      w: 0.12,
      h: cardH,
      fill: { color: accentColor },
    } as any);

    // Card icon (use topic-based icon or numbered icon)
    const cardIcon = getIconForBullet(bulletText, i);
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.35,
      y: y + 0.35,
      w: 0.6,
      h: 0.6,
      fill: { color: accentColor + '20' },  // Light version
    } as any);
    slide.addText(cardIcon, {
      x: x + 0.35,
      y: y + 0.35,
      w: 0.6,
      h: 0.6,
      fontSize: 20,
      align: 'center',
      valign: 'mid',
    } as any);

    // Card title (extract from bullet if colon exists)
    const colonIdx = bulletText.indexOf('：') !== -1 ? bulletText.indexOf('：') : bulletText.indexOf(':');
    let cardTitle = `ポイント ${i + 1}`;
    let cardDesc = bulletText;

    if (colonIdx !== -1 && colonIdx < 30) {
      cardTitle = bulletText.slice(0, colonIdx).trim();
      cardDesc = bulletText.slice(colonIdx + 1).trim();
    }

    slide.addText(cardTitle, {
      x: x + 1.1,
      y: y + 0.35,
      w: cardW - 1.4,
      h: 0.5,
      fontSize: 16,
      bold: true,
      color: COLORS.text,
      valign: 'mid',
    } as any);

    // Card description
    slide.addText(cardDesc, {
      x: x + 0.35,
      y: y + 1.1,
      w: cardW - 0.6,
      h: cardH - 1.4,
      fontSize: 13,
      color: COLORS.textLight,
      lineSpacingMultiple: 1.3,
      valign: 'top',
    } as any);
  });

  // If more than 4 bullets, add "more" indicator
  if (bullets.length > 4) {
    slide.addText(`+ ${bullets.length - 4} more items...`, {
      x: SLIDE_W - 3,
      y: SLIDE_H - 0.6,
      w: 2.5,
      h: 0.4,
      fontSize: 11,
      italic: true,
      color: COLORS.textMuted,
      align: 'right',
    } as any);
  }

  // Citations footer
  const citations = Array.isArray(s.citations) ? s.citations : [];
  const sources = citations.slice(0, 3).map((c) => safeText(c?.source_title) || 'Source').filter(Boolean);
  if (sources.length > 0) {
    slide.addText(`📚 ${sources.join(' • ')}`, {
      x: 0.5,
      y: SLIDE_H - 0.45,
      w: SLIDE_W - 4,
      h: 0.35,
      fontSize: 9,
      color: COLORS.textMuted,
    } as any);
  }

  // Speaker notes
  const notes = safeText(s.speaker_notes);
  if (notes) {
    slide.addNotes(notes);
  }
}

// Helper to get icon for a specific bullet point
function getIconForBullet(text: string, index: number): string {
  const lowerText = text.toLowerCase();
  for (const [keyword, icon] of Object.entries(TOPIC_ICONS)) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return icon;
    }
  }
  // Default numbered icons
  const defaultIcons = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
  return defaultIcons[index % defaultIcons.length];
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<RequestBody>;
    const rawTitle = body.title || body.deck?.title || 'slides';
    const title = String(rawTitle);
    const asciiTitle = title
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'slides';
    const encodedTitle = encodeURIComponent(title);
    const contentDisposition = `attachment; filename="${asciiTitle}.pptx"; filename*=UTF-8''${encodedTitle}.pptx`;

    // Mode A: image-based PPTX (pixel-perfect, larger payload)
    const pngs = Array.isArray(body.pngs) ? body.pngs : [];
    if (pngs.length > 0) {
      if (!pngs.every(isPngDataUrl)) {
        return new Response('Invalid png data URLs', { status: 400 });
      }

      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      const W = 13.333;
      const H = 7.5;

      pngs.forEach((png) => {
        const slide = pptx.addSlide();
        slide.addImage({ data: png, x: 0, y: 0, w: W, h: H });
      });

      const buf = (await (pptx as any).write('nodebuffer')) as Buffer;
      const bytes = new Uint8Array(buf);
      return new Response(bytes, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': contentDisposition,
        },
      });
    }

    // Mode B: structured PPTX (editable text + diagrams/charts/tables)
    if (!body.deck || !Array.isArray(body.deck.slides) || body.deck.slides.length === 0) {
      return new Response('Missing deck (or pngs)', { status: 400 });
    }

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'AI Assistant';
    pptx.company = 'Generated with Claude';
    pptx.subject = body.deck.title || 'AI Generated Presentation';

    const slides = body.deck.slides;
    const diagramPngs = Array.isArray(body.diagram_pngs) ? body.diagram_pngs : [];
    const deckTitle = safeText(body.deck.title) || 'Presentation';
    const deckSummary = safeText(body.deck.summary) || '';

    // Inches (LAYOUT_WIDE): 13.333 x 7.5
    const SLIDE_W = 13.333;
    const SLIDE_H = 7.5;

    for (let idx = 0; idx < slides.length; idx++) {
      const s = slides[idx];
      const slide = pptx.addSlide();
      const slideNumber = idx + 1;

      // Get diagram PNG if available
      const diagramPng = diagramPngs[idx] && isPngDataUrl(diagramPngs[idx] as string)
        ? diagramPngs[idx] as string
        : null;

      // Get image data URL
      let imageDataUrl: string | null = null;
      if (isImageDataUrl(s.image_data_url || '')) {
        imageDataUrl = s.image_data_url as string;
      } else if (typeof s.image_url === 'string' && s.image_url.trim()) {
        imageDataUrl = await fetchImageAsDataUrl(s.image_url.trim());
      }

      // Detect and render appropriate layout
      const layout = detectLayout(s, idx, slides.length);

      switch (layout) {
        case 'title':
          renderTitleSlide(pptx, slide, s, deckTitle, deckSummary, SLIDE_W, SLIDE_H);
          break;

        case 'chart':
          renderChartSlide(pptx, slide, s, SLIDE_W, SLIDE_H, slideNumber);
          break;

        case 'table':
          renderTableSlide(pptx, slide, s, SLIDE_W, SLIDE_H, slideNumber);
          break;

        case 'visual':
          renderVisualSlide(pptx, slide, s, diagramPng, imageDataUrl, SLIDE_W, SLIDE_H, slideNumber);
          break;

        case 'card':
          renderCardLayoutSlide(pptx, slide, s, SLIDE_W, SLIDE_H, slideNumber);
          break;

        case 'content':
        default:
          renderContentSlide(pptx, slide, s, diagramPng, imageDataUrl, SLIDE_W, SLIDE_H, slideNumber);
          break;
      }
    }

    const buf = (await (pptx as any).write('nodebuffer')) as Buffer;
    const bytes = new Uint8Array(buf);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': contentDisposition,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('PPTX generation error:', e);
    return new Response(msg, { status: 500 });
  }
}
