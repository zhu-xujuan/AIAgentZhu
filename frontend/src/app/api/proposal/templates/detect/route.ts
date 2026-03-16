import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

type AIProvider = 'gemini' | 'claude' | 'chatgpt';

const TEMPLATES_DIR = path.resolve(process.cwd(), '..', 'upload_samples', 'proposal_templates');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Meta = Record<string, { serviceName: string; uploadedAt: string }>;

function readMeta(): Meta {
  try {
    const metaFile = path.join(TEMPLATES_DIR, '_meta.json');
    if (fs.existsSync(metaFile)) {
      return JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function readFileContent(filePath: string, maxLen = 3000): string {
  const ext = path.extname(filePath).toLowerCase();
  if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
    try { return fs.readFileSync(filePath, 'utf-8').slice(0, maxLen); } catch { return ''; }
  }
  return '';
}

function buildPrompt(fileName: string, fileContent: string, existingTemplates: { name: string; serviceName: string; snippet: string }[]): string {
  let existingSection = '';
  if (existingTemplates.length > 0) {
    existingSection = `\n\n## 既存のテンプレート\n${existingTemplates.map(t =>
      `- ファイル名: ${t.name} / サービス名: ${t.serviceName || '未設定'}${t.snippet ? `\n  内容: ${t.snippet.slice(0, 200)}` : ''}`
    ).join('\n')}`;
  }

  return `以下のファイルの内容からサービス名を判定し、既存テンプレートとの類似性をチェックしてください。

## アップロードされたファイル
ファイル名: ${fileName}
${fileContent ? `内容:\n${fileContent}` : '（バイナリファイルのため内容は読めません。ファイル名から判定してください）'}
${existingSection}

## 弊社のサービス一覧
1. DX開発サービス
2. AI RAG Agent
3. 書きあげクン
4. その他（上記に該当しない場合、提案内容から適切なサービス名を提案）

## 回答形式（JSON以外のテキストは一切返さないでください）
{
  "serviceName": "判定されたサービス名",
  "confidence": "high/medium/low",
  "similarTo": "類似する既存テンプレートのファイル名（なければnull）",
  "similarityReason": "類似の理由（なければnull）"
}`;
}

async function callAI(prompt: string, provider: AIProvider, apiKey: string): Promise<string> {
  switch (provider) {
    case 'gemini': {
      const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    }
    case 'claude': {
      const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({ model, max_tokens: 500, messages: [{ role: 'user', content: prompt }] });
      return response.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
    }
    case 'chatgpt': {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 500 });
      return response.choices[0]?.message?.content || '';
    }
  }
}

/** POST - detect service name and check similarity for uploaded file(s) */
export async function POST(req: NextRequest) {
  try {
    const { fileNames, aiProvider: reqProvider, aiApiKey: reqApiKey } = await req.json();

    const provider: AIProvider = reqProvider || process.env.PROPOSAL_AI_PROVIDER || 'gemini';
    const envKeyMap: Record<AIProvider, string | undefined> = {
      gemini: process.env.GEMINI_API_KEY,
      claude: process.env.ANTHROPIC_API_KEY,
      chatgpt: process.env.OPENAI_API_KEY,
    };
    const apiKey = reqApiKey || envKeyMap[provider];
    if (!apiKey) {
      return NextResponse.json({ error: `${provider}のAPIキーが設定されていません` }, { status: 400 });
    }

    const meta = readMeta();

    // Gather existing templates info
    const existingTemplates: { name: string; serviceName: string; snippet: string }[] = [];
    if (fs.existsSync(TEMPLATES_DIR)) {
      for (const name of fs.readdirSync(TEMPLATES_DIR).filter(f => !f.startsWith('.') && !f.startsWith('_'))) {
        const snippet = readFileContent(path.join(TEMPLATES_DIR, name), 500);
        existingTemplates.push({ name, serviceName: meta[name]?.serviceName || '', snippet });
      }
    }

    const results: {
      fileName: string;
      serviceName: string;
      confidence: string;
      similarTo: string | null;
      similarityReason: string | null;
    }[] = [];

    for (const fileName of (fileNames as string[])) {
      const filePath = path.join(TEMPLATES_DIR, fileName);
      const content = fs.existsSync(filePath) ? readFileContent(filePath) : '';
      const prompt = buildPrompt(fileName, content, existingTemplates.filter(t => t.name !== fileName));

      try {
        const text = await callAI(prompt, provider, apiKey);
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        results.push({
          fileName,
          serviceName: parsed.serviceName || '',
          confidence: parsed.confidence || 'low',
          similarTo: parsed.similarTo || null,
          similarityReason: parsed.similarityReason || null,
        });
      } catch {
        // Fallback: guess from filename
        results.push({
          fileName,
          serviceName: guessServiceFromName(fileName),
          confidence: 'low',
          similarTo: null,
          similarityReason: null,
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: `検出エラー: ${message}` }, { status: 500 });
  }
}

function guessServiceFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('dx') || n.includes('開発') || n.includes('development')) return 'DX開発サービス';
  if (n.includes('rag') || n.includes('ai_agent') || n.includes('aiagent')) return 'AI RAG Agent';
  if (n.includes('書きあげ') || n.includes('kakiage') || n.includes('文字起こし')) return '書きあげクン';
  return '';
}

export const runtime = 'nodejs';
