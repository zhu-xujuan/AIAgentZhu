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
      citations?: Array<{ source_id?: number | null; source_title?: string; quote?: string }>;
    }>;
  };
  diagram_pngs?: Array<string | null>;
};

function isPngDataUrl(value: string) {
  return typeof value === 'string' && value.startsWith('data:image/png');
}

function safeText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function safeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => safeText(v)).filter(Boolean);
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

    slides.forEach((s, idx) => {
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
      slide.addText(bulletText || ' ', {
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

      // Diagram (right) as PNG if present
      const diagram = diagramPngs[idx];
      if (typeof diagram === 'string' && isPngDataUrl(diagram)) {
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
    });

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
