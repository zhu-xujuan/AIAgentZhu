import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const TEMPLATES_DIR = path.resolve(process.cwd(), '..', 'upload_samples', 'proposal_templates');
const META_FILE = path.join(TEMPLATES_DIR, '_meta.json');

function ensureDir() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
}

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

function writeMeta(meta: Meta) {
  ensureDir();
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

export interface TemplateInfo {
  name: string;
  serviceName: string;
  size: number;
  modified: string;
}

/** GET - list all templates with service names */
export async function GET() {
  try {
    ensureDir();
    const meta = readMeta();
    const files = fs.readdirSync(TEMPLATES_DIR)
      .filter(f => !f.startsWith('.') && !f.startsWith('_'))
      .map(name => {
        const fullPath = path.join(TEMPLATES_DIR, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          serviceName: meta[name]?.serviceName || '',
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));

    return NextResponse.json({ templates: files });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: `テンプレート一覧取得エラー: ${message}` }, { status: 500 });
  }
}

/** POST - upload templates. Returns uploaded files info. */
export async function POST(req: NextRequest) {
  try {
    ensureDir();
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    // Optional: caller can provide a service name to assign
    const assignServiceName = formData.get('serviceName') as string | null;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'ファイルが選択されていません' }, { status: 400 });
    }

    const meta = readMeta();
    const results: { name: string; size: number; serviceName: string }[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u3000-\u9FFF\uF900-\uFAFF]/g, '_');
      const filePath = path.join(TEMPLATES_DIR, safeName);
      fs.writeFileSync(filePath, buffer);

      const svcName = assignServiceName || meta[safeName]?.serviceName || '';
      meta[safeName] = { serviceName: svcName, uploadedAt: new Date().toISOString() };
      results.push({ name: safeName, size: buffer.length, serviceName: svcName });
    }

    writeMeta(meta);
    return NextResponse.json({ uploaded: results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: `アップロードエラー: ${message}` }, { status: 500 });
  }
}

/** DELETE - remove a template */
export async function DELETE(req: NextRequest) {
  try {
    ensureDir();
    const { name } = await req.json();
    if (!name) {
      return NextResponse.json({ error: 'ファイル名が必要です' }, { status: 400 });
    }
    const filePath = path.join(TEMPLATES_DIR, name);
    if (!filePath.startsWith(TEMPLATES_DIR)) {
      return NextResponse.json({ error: '不正なファイルパス' }, { status: 400 });
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    // Remove from meta
    const meta = readMeta();
    delete meta[name];
    writeMeta(meta);

    return NextResponse.json({ deleted: name });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: `削除エラー: ${message}` }, { status: 500 });
  }
}

/** PATCH - update service name or replace file */
export async function PATCH(req: NextRequest) {
  try {
    ensureDir();
    const { name, serviceName, replaceName } = await req.json();
    if (!name) {
      return NextResponse.json({ error: 'ファイル名が必要です' }, { status: 400 });
    }

    const meta = readMeta();

    // Replace: remove old file, rename new file's meta
    if (replaceName && replaceName !== name) {
      const oldPath = path.join(TEMPLATES_DIR, replaceName);
      if (oldPath.startsWith(TEMPLATES_DIR) && fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
      // Transfer service name from old to new if not explicitly set
      if (!serviceName && meta[replaceName]?.serviceName) {
        meta[name] = { ...meta[name], serviceName: meta[replaceName].serviceName };
      }
      delete meta[replaceName];
    }

    // Update service name
    if (serviceName !== undefined) {
      meta[name] = { ...meta[name], serviceName, uploadedAt: meta[name]?.uploadedAt || new Date().toISOString() };
    }

    writeMeta(meta);
    return NextResponse.json({ updated: { name, serviceName: meta[name]?.serviceName || '' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: `更新エラー: ${message}` }, { status: 500 });
  }
}

export const runtime = 'nodejs';
