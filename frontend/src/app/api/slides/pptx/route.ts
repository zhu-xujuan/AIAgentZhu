import PptxGenJS from 'pptxgenjs';

export const runtime = 'nodejs';

type RequestBody = {
  title?: string;
  pngs?: string[];
  deck?: {
    title?: string;
    summary?: string;
    slides: Array<{
      title?: string;
      bullets?: string[];
      speaker_notes?: string;
      table?: { headers?: string[]; rows?: string[][] };
      image_url?: string;
      image_data_url?: string;
      chart?: {
        type?: string;
        title?: string;
        labels?: string[];
        datasets?: Array<{ label?: string; data?: number[] }>;
      };
      citations?: Array<{ source_id?: number | null; source_title?: string; quote?: string }>;
    }>;
  };
  diagram_pngs?: Array<string | null>;
};

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

function chartToQuickchartUrl(chart?: {
  type?: string;
  title?: string;
  labels?: string[];
  datasets?: Array<{ label?: string; data?: number[] }>;
}) {
  if (!chart || !chart.type) return '';
  const labels = Array.isArray(chart.labels) ? chart.labels : [];
  const datasets = Array.isArray(chart.datasets) ? chart.datasets : [];
  if (labels.length === 0 || datasets.length === 0) return '';
  const config = {
    type: chart.type,
    data: { labels, datasets },
    options: {
      plugins: {
        title: { display: !!chart.title, text: chart.title || '' },
        legend: { display: datasets.length > 1 },
      },
      responsive: true,
      maintainAspectRatio: false,
    },
  };
  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(config))}`;
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

    // Mode B: structured PPTX (editable text + optional diagram images)
    if (!body.deck || !Array.isArray(body.deck.slides) || body.deck.slides.length === 0) {
      return new Response('Missing deck (or pngs)', { status: 400 });
    }

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';

    const slides = body.deck.slides;
    const diagramPngs = Array.isArray(body.diagram_pngs) ? body.diagram_pngs : [];

    // Inches (LAYOUT_WIDE): 13.333 x 7.5
    const SLIDE_W = 13.333;
    const SLIDE_H = 7.5;

    for (let idx = 0; idx < slides.length; idx++) {
      const s = slides[idx];
      const slide = pptx.addSlide();

      // "Icon" badge (simple shape) inspired by Presenton-like visual anchors
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.6,
        y: 0.45,
        w: 0.65,
        h: 0.65,
        fill: { color: 'EEF2FF' },
        line: { color: 'C7D2FE', width: 1 },
        radius: 0.15,
      } as any);
      slide.addText('AI', {
        x: 0.6,
        y: 0.53,
        w: 0.65,
        h: 0.5,
        fontSize: 14,
        bold: true,
        color: '4338CA',
        align: 'center',
        valign: 'mid',
      } as any);

      // Title
      slide.addText(safeText(s.title) || 'Slide', {
        x: 1.35,
        y: 0.4,
        w: SLIDE_W - 1.9,
        h: 0.9,
        fontSize: 32,
        bold: true,
        color: '111827',
      } as any);

      // Bullets (left)
      const bullets = safeStringArray(s.bullets);
      const bulletText = bullets.join('\n');
      if (bulletText.trim()) {
        slide.addText(bulletText, {
          x: 0.9,
          y: 1.55,
          w: 7.4,
          h: 5.1,
          fontSize: 20,
          color: '111827',
          bullet: { indent: 20 },
          hanging: 6,
          lineSpacingMultiple: 1.1,
        } as any);
      } else {
        slide.addText(' ', {
          x: 0.9,
          y: 1.55,
          w: 7.4,
          h: 5.1,
          fontSize: 20,
          color: '111827',
        } as any);
      }

      // Diagram (right) as PNG if present
      const diagram = diagramPngs[idx];
      const hasDiagram = typeof diagram === 'string' && isPngDataUrl(diagram);

      let imageDataUrl: string | null = null;
      if (isImageDataUrl(s.image_data_url || '')) {
        imageDataUrl = s.image_data_url as string;
      } else if (typeof s.image_url === 'string' && s.image_url.trim()) {
        imageDataUrl = await fetchImageAsDataUrl(s.image_url.trim());
      }
      const hasImage = !!imageDataUrl;
      let chartDataUrl: string | null = null;
      if (!hasImage && s.chart) {
        const chartUrl = chartToQuickchartUrl(s.chart);
        if (chartUrl) chartDataUrl = await fetchImageAsDataUrl(chartUrl);
      }
      const hasChart = !!chartDataUrl;

      if (hasImage) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 8.55,
          y: 1.55,
          w: 4.2,
          h: 5.1,
          fill: { color: 'FFFFFF' },
          line: { color: 'E5E7EB', width: 1 },
          radius: 0.2,
        } as any);
        slide.addImage({
          data: imageDataUrl as string,
          x: 8.75,
          y: 1.75,
          w: 3.8,
          h: 4.7,
        });
      } else if (hasChart) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 8.55,
          y: 1.55,
          w: 4.2,
          h: 5.1,
          fill: { color: 'FFFFFF' },
          line: { color: 'E5E7EB', width: 1 },
          radius: 0.2,
        } as any);
        slide.addImage({
          data: chartDataUrl as string,
          x: 8.75,
          y: 1.75,
          w: 3.8,
          h: 4.7,
        });
      } else if (hasDiagram) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 8.55,
          y: 1.55,
          w: 4.2,
          h: 5.1,
          fill: { color: 'FFFFFF' },
          line: { color: 'E5E7EB', width: 1 },
          radius: 0.2,
        } as any);
        slide.addImage({
          data: diagram,
          x: 8.75,
          y: 1.75,
          w: 3.8,
          h: 4.7,
        });
      }
      const table = normalizeTable(s.table);
      if (!hasImage && !hasChart && !hasDiagram && table) {
        const tableRows: any[] = [];
        if (table.headers.some((h) => h.length > 0)) {
          tableRows.push(
            table.headers.map((h) => ({
              text: h,
              options: { bold: true, fill: 'F3F4F6', color: '111827' },
            }))
          );
        }
        table.rows.forEach((r) => tableRows.push(r));
        const colW = Array(table.colCount).fill(4.2 / table.colCount);
        slide.addTable(tableRows, {
          x: 8.55,
          y: 1.55,
          w: 4.2,
          h: 5.1,
          colW,
          fontSize: 12,
          border: { color: 'E5E7EB', pt: 1 },
          valign: 'mid',
          align: 'left',
          fill: { color: 'FFFFFF' },
        } as any);
      }

      // Footer sources (compact)
      const citations = Array.isArray(s.citations) ? s.citations : [];
      const sources = citations
        .slice(0, 3)
        .map((c) => safeText(c?.source_title) || 'Source')
        .filter(Boolean);
      if (sources.length > 0) {
        slide.addText(`Sources: ${sources.join(' / ')}`, {
          x: 0.9,
          y: SLIDE_H - 0.55,
          w: SLIDE_W - 1.8,
          h: 0.4,
          fontSize: 10,
          color: '6B7280',
        } as any);
      }

      // Notes include speaker notes + summary (if any)
      const notes = [safeText(s.speaker_notes)].filter(Boolean).join('\n');
      if (notes) {
        slide.addNotes(notes);
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
    return new Response(msg, { status: 500 });
  }
}
