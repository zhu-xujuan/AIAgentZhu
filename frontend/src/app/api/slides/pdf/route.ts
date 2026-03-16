export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { title, pngs } = await req.json() as { title: string; pngs: string[] };

    if (!pngs || pngs.length === 0) {
      return new Response(JSON.stringify({ error: 'No slide images provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Dynamic import of jsPDF (server-side)
    const { jsPDF } = await import('jspdf');

    // Create landscape PDF (1280x720 ratio → ~338.67mm x 190.5mm at 96dpi → use standard 16:9)
    const SLIDE_W_MM = 338.67;
    const SLIDE_H_MM = 190.5;
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [SLIDE_W_MM, SLIDE_H_MM],
    });

    for (let i = 0; i < pngs.length; i++) {
      if (i > 0) {
        doc.addPage([SLIDE_W_MM, SLIDE_H_MM], 'landscape');
      }

      const png = pngs[i];
      // data:image/png;base64,... → extract base64
      const base64 = png.includes(',') ? png.split(',')[1] : png;
      doc.addImage(base64, 'PNG', 0, 0, SLIDE_W_MM, SLIDE_H_MM);
    }

    const pdfBuffer = doc.output('arraybuffer');
    const safeName = (title || 'slides').replace(/[^a-zA-Z0-9\u3040-\u30ff\u4e00-\u9fff _-]/g, '_');

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'PDF generation failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
