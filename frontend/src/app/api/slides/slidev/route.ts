import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

type SlidevState = {
  port: number;
  entryPath: string;
  proc: ChildProcess;
  logs: string[];
};

declare global {
  // eslint-disable-next-line no-var
  var __slidevState: SlidevState | undefined;
}

function isAlive(proc: ChildProcess | undefined) {
  return !!proc && proc.exitCode == null && !proc.killed;
}

async function waitForServer(url: string, timeoutMs: number) {
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, { method: 'GET' });
      // Slidev may return non-2xx briefly while Vite compiles; treat any non-5xx as ready.
      if (res.status < 500) return;
    } catch {
      // ignore
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Slidev server did not become ready in ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

function getSlidevPort() {
  const raw = process.env.SLIDEV_PORT;
  const port = raw ? Number(raw) : 3030;
  return Number.isFinite(port) && port > 0 ? port : 3030;
}

function getEntryPath() {
  // Persisted inside the Next.js container/host. Slidev watches this file for changes.
  return path.join(process.cwd(), '.slidev', 'slides.md');
}

async function ensureSlidevServer(entryPath: string, port: number) {
  const state = globalThis.__slidevState;
  if (state && state.port === port && state.entryPath === entryPath && isAlive(state.proc)) {
    return;
  }

  if (state?.proc && isAlive(state.proc)) {
    state.proc.kill('SIGTERM');
    globalThis.__slidevState = undefined;
  }

  const args = [
    'slidev',
    entryPath,
    '--port',
    String(port),
    '--open',
    'false',
    '--log',
    'silent',
    // Bind to 0.0.0.0 so it works in Docker port-forwarding.
    '--bind',
    '0.0.0.0',
  ];
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const proc = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const logs: string[] = [];
  const pushLog = (text: string) => {
    if (!text) return;
    logs.push(text);
    if (logs.length > 30) logs.shift();
  };

  proc.on('exit', () => {
    if (globalThis.__slidevState?.proc === proc) globalThis.__slidevState = undefined;
  });
  proc.on('error', (e) => {
    pushLog(`[spawn-error] ${String(e)}`);
  });

  proc.stderr?.on('data', (buf: Buffer) => pushLog(buf.toString('utf8')));
  proc.stdout?.on('data', (buf: Buffer) => pushLog(buf.toString('utf8')));

  globalThis.__slidevState = { port, entryPath, proc, logs };

  try {
    await waitForServer(`http://127.0.0.1:${port}/`, 60_000);
  } catch (e) {
    const details = logs.join('\n').trim();
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(details ? `${msg}\n${details}` : msg);
  }
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
    await ensureSlidevServer(entryPath, port);

    const requestUrl = new URL(req.url);
    const host = requestUrl.hostname || 'localhost';
    const protocol = requestUrl.protocol || 'http:';
    const url = `${protocol}//${host}:${port}/`;

    return Response.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    return new Response(msg, { status: 500 });
  }
}

export async function GET(req: Request) {
  const port = getSlidevPort();
  const entryPath = getEntryPath();
  const alive = !!globalThis.__slidevState && isAlive(globalThis.__slidevState.proc);
  const requestUrl = new URL(req.url);
  const host = requestUrl.hostname || 'localhost';
  const protocol = requestUrl.protocol || 'http:';
  const url = `${protocol}//${host}:${port}/`;
  return Response.json({
    alive,
    port,
    entryPath,
    url,
    logs: globalThis.__slidevState?.logs?.slice(-10) || [],
  });
}
