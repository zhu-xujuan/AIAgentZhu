import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const TEMPLATES_DIR = path.resolve(process.cwd(), '..', 'upload_samples', 'proposal_templates');
const META_FILE = path.join(TEMPLATES_DIR, '_meta.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Meta = Record<string, { serviceName: string; uploadedAt: string }>;

function readMeta(): Meta {
  try {
    if (fs.existsSync(META_FILE)) {
      return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

/** Read all template files and return their text content with service names (for AI context). */
export async function GET() {
  try {
    if (!fs.existsSync(TEMPLATES_DIR)) {
      return NextResponse.json({ templates: [] });
    }

    const meta = readMeta();
    const files = fs.readdirSync(TEMPLATES_DIR).filter(f => !f.startsWith('.') && !f.startsWith('_'));
    const templates: { name: string; serviceName: string; content: string }[] = [];

    for (const name of files) {
      const filePath = path.join(TEMPLATES_DIR, name);
      const ext = path.extname(name).toLowerCase();
      const serviceName = meta[name]?.serviceName || '';

      if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8').slice(0, 5000);
          templates.push({ name, serviceName, content });
        } catch {
          // skip unreadable files
        }
      } else {
        const stat = fs.statSync(filePath);
        templates.push({
          name,
          serviceName,
          content: `[バイナリファイル: ${name}, サイズ: ${(stat.size / 1024).toFixed(0)}KB]`,
        });
      }
    }

    return NextResponse.json({ templates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const runtime = 'nodejs';
