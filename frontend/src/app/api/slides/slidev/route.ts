import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

function getSlidevPort() {
  const raw = process.env.SLIDEV_PORT;
  const port = raw ? Number(raw) : 3030;
  return Number.isFinite(port) && port > 0 ? port : 3030;
}

function getEntryPath() {
  // Persisted inside the Next.js container/host. Slidev watches this file for changes.
  return path.join(process.cwd(), '.slidev', 'slides.md');
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { markdown?: string };
    const markdown = typeof body.markdown === 'string' ? body.markdown : '';
    if (!markdown.trim()) return new Response('Missing markdown', { status: 400 });

    const entryPath = getEntryPath();
    await fs.mkdir(path.dirname(entryPath), { recursive: true });
    await fs.writeFile(entryPath, markdown, 'utf8');

    const port = getSlidevPort();
    const requestUrl = new URL(req.url);
    const host = requestUrl.hostname || 'localhost';
    const protocol = requestUrl.protocol || 'http:';
    const url = `${protocol}//${host}:${port}/`;

    return Response.json({
      url,
      ready: true,
      note: 'Slidev server should be started by startup script on port 3030.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    return new Response(msg, { status: 500 });
  }
}

export async function GET(req: Request) {
  const port = getSlidevPort();
  const entryPath = getEntryPath();
  const requestUrl = new URL(req.url);
  const host = requestUrl.hostname || 'localhost';
  const protocol = requestUrl.protocol || 'http:';
  const url = `${protocol}//${host}:${port}/`;
  return Response.json({
    alive: true,
    ready: true,
    port,
    entryPath,
    url,
    note: 'Health is managed externally by startup script.',
  });
}
