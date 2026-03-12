import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import pptxgen from 'pptxgenjs';

// ---- Input Types (flexible: accepts any extra fields from SF) ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
interface SFData {
  account: R;
  opportunity: R;
  contacts: R[];
  activities: R[];
  events?: R[];
  feedItems?: R[];
  notes?: R[];
  cases?: R[];
  contracts?: R[];
  quotes?: R[];
  lineItems?: R[];
  emails?: R[];
  _meta?: { objectType: string; availableObjects: string[]; fetchedAt: string };
}
interface ScenarioResult { label: string; probability: number; expectedRevenue: number; timeline: string; conditions: string[] }
interface ServiceRecommendation {
  service: string; relevance: string; reason: string; features: string[];
}
interface AnalysisRationale {
  customerChallenges: string[];
  serviceRecommendations: ServiceRecommendation[];
  combinedSolution: string;
  existingProposalHints: string[];
}
interface AnalysisResult {
  winProbability: number; dealHealthScore: number; activityScore: number; engagementLevel: string;
  proposalReadiness?: number;
  scenarios: { optimistic: ScenarioResult; base: ScenarioResult; pessimistic: ScenarioResult };
  keyDrivers: string[]; riskFactors: string[]; recommendedActions: string[];
  rationale?: AnalysisRationale;
}

// ---- AI-generated slide structure ----
interface SlideElement {
  type: 'text' | 'shape' | 'list' | 'kpi' | 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  // text / list
  content?: string;
  items?: string[];
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  // shape
  fill?: string;
  borderColor?: string;
  // kpi
  label?: string;
  value?: string;
  valueColor?: string;
  // table
  rows?: string[][];
  headerBg?: string;
}

interface SlideDefinition {
  title: string;
  subtitle?: string;
  layout: 'title' | 'content' | 'two-column' | 'cards' | 'closing';
  bgColor: string;
  headerColor: string;
  elements: SlideElement[];
}

interface PresentationPlan {
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    lightText: string;
  };
  slides: SlideDefinition[];
}

type AIProvider = 'gemini' | 'claude' | 'chatgpt';

// ---- Helpers ----
function formatContacts(contacts: R[]): string {
  if (!contacts || contacts.length === 0) return 'なし';
  return contacts.slice(0, 5).map(c => `${c.LastName || ''}${c.FirstName || ''}（${c.Title || '役職不明'}）`).join('、');
}

function fmtAmount(amt: number): string {
  if (!amt) return '¥0';
  if (amt >= 100000000) return `¥${(amt / 100000000).toFixed(1)}億`;
  if (amt >= 10000) return `¥${(amt / 10000).toFixed(0)}万`;
  return `¥${amt.toLocaleString()}`;
}

function summarizeRecords(records: R[] | undefined, fields: string[], maxItems = 10): string {
  if (!records || records.length === 0) return 'なし';
  return records.slice(0, maxItems).map(r =>
    fields.map(f => `${f}: ${r[f] || ''}`).join(' / ')
  ).join('\n  ');
}

// ---- Prompt ----
function buildPrompt(data: SFData, analysis: AnalysisResult): string {
  const sections: string[] = [];

  // Basic info
  sections.push(`## 商談データ
- 顧客名: ${data.account.Name || '不明'} / 業界: ${data.account.Industry || '未設定'}
- 年商: ${fmtAmount(data.account.AnnualRevenue)} / 従業員数: ${data.account.NumberOfEmployees || '未設定'}
- 商談名: ${data.opportunity.Name || '不明'} / 金額: ${fmtAmount(data.opportunity.Amount)}
- ステージ: ${data.opportunity.StageName || '未設定'} / クローズ予定: ${data.opportunity.CloseDate || '未設定'}
- 確度: ${data.opportunity.Probability || 0}% / 説明: ${data.opportunity.Description || 'なし'}
- ネクストステップ: ${data.opportunity.NextStep || 'なし'}
- コンタクト: ${formatContacts(data.contacts)}`);

  // Activities (Tasks)
  if (data.activities && data.activities.length > 0) {
    sections.push(`## 活動記録（${data.activities.length}件）
  ${summarizeRecords(data.activities, ['Subject', 'ActivityDate', 'Status', 'Type'], 15)}`);
  }

  // Events
  if (data.events && data.events.length > 0) {
    sections.push(`## 会議・訪問（${data.events.length}件）
  ${summarizeRecords(data.events, ['Subject', 'StartDateTime', 'Location', 'Type'], 10)}`);
  }

  // Chatter / 日報
  if (data.feedItems && data.feedItems.length > 0) {
    sections.push(`## Chatter投稿・日報（${data.feedItems.length}件）
  ${data.feedItems.slice(0, 10).map(f => `[${f.CreatedDate || ''}] ${(f.Body || '').slice(0, 200)}`).join('\n  ')}`);
  }

  // Notes
  if (data.notes && data.notes.length > 0) {
    sections.push(`## メモ・ノート（${data.notes.length}件）
  ${data.notes.slice(0, 8).map(n => `[${n.CreatedDate || ''}] ${n.Title || ''}: ${(n.Body || '').slice(0, 150)}`).join('\n  ')}`);
  }

  // Cases
  if (data.cases && data.cases.length > 0) {
    sections.push(`## 問い合わせ履歴（${data.cases.length}件）
  ${summarizeRecords(data.cases, ['Subject', 'Status', 'Priority', 'CreatedDate'], 10)}`);
  }

  // Contracts
  if (data.contracts && data.contracts.length > 0) {
    sections.push(`## 契約情報（${data.contracts.length}件）
  ${summarizeRecords(data.contracts, ['ContractNumber', 'Status', 'StartDate', 'EndDate'], 5)}`);
  }

  // Quotes
  if (data.quotes && data.quotes.length > 0) {
    sections.push(`## 見積（${data.quotes.length}件）
  ${data.quotes.slice(0, 5).map(q => `${q.Name}: ${fmtAmount(q.TotalPrice)} (${q.Status})`).join('\n  ')}`);
  }

  // Line Items
  if (data.lineItems && data.lineItems.length > 0) {
    sections.push(`## 商談製品（${data.lineItems.length}件）
  ${data.lineItems.slice(0, 10).map(l => `${l.Name}: ${l.Quantity}個 × ${fmtAmount(l.UnitPrice)} = ${fmtAmount(l.TotalPrice)}`).join('\n  ')}`);
  }

  // Emails
  if (data.emails && data.emails.length > 0) {
    sections.push(`## メール履歴（${data.emails.length}件）
  ${data.emails.slice(0, 8).map(e => `[${e.Date || ''}] ${e.Subject || ''}`).join('\n  ')}`);
  }

  // Analysis
  sections.push(`## 分析結果
- 受注確率: ${analysis.winProbability}%
- ディールスコア: ${analysis.dealHealthScore}/100
- エンゲージメント: ${analysis.engagementLevel}
- キードライバー: ${analysis.keyDrivers.join('、')}
- リスク要因: ${analysis.riskFactors.join('、')}
- 推奨アクション: ${analysis.recommendedActions.join('、')}
- シナリオ楽観: 確率${Math.round(analysis.scenarios.optimistic.probability * 100)}% 金額${fmtAmount(analysis.scenarios.optimistic.expectedRevenue)}
- シナリオ標準: 確率${Math.round(analysis.scenarios.base.probability * 100)}% 金額${fmtAmount(analysis.scenarios.base.expectedRevenue)}
- シナリオ悲観: 確率${Math.round(analysis.scenarios.pessimistic.probability * 100)}% 金額${fmtAmount(analysis.scenarios.pessimistic.expectedRevenue)}`);

  // Rationale (AI-generated analysis basis — may have been revised by user)
  if (analysis.rationale) {
    const r = analysis.rationale;
    const rationaleLines: string[] = ['## 分析根拠（提案書の核となる内容 — 必ず提案書に反映すること）'];
    if (r.customerChallenges.length > 0) {
      rationaleLines.push(`### 顧客の課題\n${r.customerChallenges.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);
    }
    if (r.serviceRecommendations.length > 0) {
      rationaleLines.push(`### 推薦サービス\n${r.serviceRecommendations.map(s => `- **${s.service}**（${s.relevance}）: ${s.reason}\n  活用機能: ${s.features.join('、')}`).join('\n')}`);
    }
    if (r.combinedSolution) {
      rationaleLines.push(`### 総合ソリューション\n${r.combinedSolution}`);
    }
    if (r.existingProposalHints.length > 0) {
      rationaleLines.push(`### 提案書に含めるべきポイント\n${r.existingProposalHints.map((h, i) => `${i + 1}. ${h}`).join('\n')}`);
    }
    sections.push(rationaleLines.join('\n\n'));
  }

  return `あなたはプレゼンテーションデザイナーです。以下の顧客の全情報と分析結果・分析根拠に基づいて、提案書のスライド構成をJSON形式で設計してください。
情報量が多いほど、より具体的で説得力のある提案書を作成してください。活動記録・会議・日報・メール・問い合わせ等の履歴から顧客の課題やニーズを読み取り、提案に反映してください。
特に「分析根拠」セクションの内容（顧客課題、推薦サービス、総合ソリューション）は提案書の核となるため、必ずスライドに盛り込んでください。

${sections.join('\n\n')}

## 要件
商談の内容・規模・業界に合わせて最適なスライド構成を自由に設計してください。

### ルール
1. スライド数は5〜12枚で商談の複雑さに応じて調整
2. 各スライドに適切なレイアウト（title/content/two-column/cards/closing）を選択
3. テーマカラーは業界・顧客イメージに合わせて選択（6桁hex、#なし）
4. elementsの座標はインチ単位（スライドは10x5.625）
5. 文章は日本語で、商談固有の内容を盛り込む
6. KPI、リスト、テーブル、テキストを効果的に組み合わせる

### 提案書の品質基準
- 顧客視点で構成する：「あなたの課題 → 私たちの解決策 → 導入効果」の流れ
- 数値・根拠で説得力を持たせる（ROI試算、コスト比較、導入効果の具体例）
- 参考資料がサービス紹介資料の場合は、そのまま転記せず、顧客の課題と紐づけた提案に再構成する
- 各スライドに明確な目的を持たせ、冗長な情報は省く
- 推奨構成：表紙 → エグゼクティブサマリー → 顧客課題の整理 → 解決策（サービス別） → 導入効果・ROI → 実施スケジュール → 次のステップ

### element types
- **text**: 自由テキスト。content, fontSize, bold, italic, color, align, valign
- **shape**: 装飾用矩形。fill, borderColor
- **list**: 箇条書き。items[], fontSize, color
- **kpi**: 数値カード。label, value, valueColor, fill
- **table**: テーブル。rows[][]（1行目がヘッダー）, headerBg

### JSON形式（これ以外のテキストは一切返さないでください）
{
  "theme": {
    "primary": "1E2761",
    "secondary": "2D4A8A",
    "accent": "0891B2",
    "background": "F5F7FA",
    "text": "2C3E50",
    "lightText": "64748B"
  },
  "slides": [
    {
      "title": "スライドタイトル",
      "subtitle": "サブタイトル（任意）",
      "layout": "title",
      "bgColor": "1E2761",
      "headerColor": "FFFFFF",
      "elements": [
        { "type": "text", "x": 0.5, "y": 2, "w": 9, "h": 1, "content": "本文", "fontSize": 18, "color": "FFFFFF" }
      ]
    }
  ]
}`;
}

// ---- AI calls ----
function parsePlan(text: string): PresentationPlan {
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned) as PresentationPlan;
}

async function callClaude(prompt: string, apiKey: string): Promise<PresentationPlan> {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({ model, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] });
  const text = response.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
  return parsePlan(text);
}

async function callGemini(prompt: string, apiKey: string): Promise<PresentationPlan> {
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContent(prompt);
  return parsePlan(result.response.text());
}

async function callChatGPT(prompt: string, apiKey: string): Promise<PresentationPlan> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 8000 });
  return parsePlan(response.choices[0]?.message?.content || '{}');
}

async function fetchTemplateContent(): Promise<string> {
  try {
    const fs = await import('fs');
    const pathMod = await import('path');
    const dir = pathMod.default.resolve(process.cwd(), '..', 'upload_samples', 'proposal_templates');
    if (!fs.default.existsSync(dir)) return '';

    // Read metadata for service names
    const metaFile = pathMod.default.join(dir, '_meta.json');
    let meta: Record<string, { serviceName: string }> = {};
    try {
      if (fs.default.existsSync(metaFile)) {
        meta = JSON.parse(fs.default.readFileSync(metaFile, 'utf-8'));
      }
    } catch { /* ignore */ }

    const files = fs.default.readdirSync(dir).filter(f => !f.startsWith('.') && !f.startsWith('_'));
    if (files.length === 0) return '';

    const parts: string[] = [];
    for (const name of files.slice(0, 8)) {
      const serviceName = meta[name]?.serviceName || '（サービス未設定）';
      const ext = pathMod.default.extname(name).toLowerCase();
      if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
        try {
          const content = fs.default.readFileSync(pathMod.default.join(dir, name), 'utf-8').slice(0, 3000);
          parts.push(`### 【${serviceName}】 ${name}\n${content}`);
        } catch { /* skip */ }
      } else {
        parts.push(`### 【${serviceName}】 ${name}\n[バイナリファイル — 構成・トーンを参考にしてください]`);
      }
    }
    return parts.length > 0 ? `\n\n## 既存の参考資料（提案書テンプレートまたはサービス紹介資料）\n以下はサービス別の参考資料です。資料の種類に応じて以下のように活用してください：

### 資料活用ルール
- **提案書テンプレートの場合**: 構成・トーン・論理展開を参考にし、顧客固有の課題・データを組み込んで提案書に仕上げる
- **サービス紹介資料の場合**: サービスの特徴・機能・メリットを抽出し、顧客の課題解決にどう貢献するかの観点で提案書として再構成する
- いずれの場合も、最終出力は「顧客向けの説得力ある提案書」として作成すること
- 顧客の課題 → 解決策 → 具体的なサービス活用方法 → 導入効果・ROI → ネクストステップの論理的な流れを意識する
- 単なるサービス機能の羅列ではなく、「なぜこの顧客にこのサービスが必要か」を明確に伝える内容にする
- 顧客の業界・規模・課題に合わせた具体的な活用シナリオ・導入事例を盛り込む

${parts.join('\n\n')}` : '';
  } catch {
    return '';
  }
}

async function generatePlan(data: SFData, analysis: AnalysisResult, provider: AIProvider, apiKey: string): Promise<PresentationPlan> {
  const templateContext = await fetchTemplateContent();
  const prompt = buildPrompt(data, analysis) + templateContext;
  switch (provider) {
    case 'claude': return callClaude(prompt, apiKey);
    case 'gemini': return callGemini(prompt, apiKey);
    case 'chatgpt': return callChatGPT(prompt, apiKey);
  }
}

// ---- Generic PPTX renderer ----
async function renderPPTX(plan: PresentationPlan, title: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pres = new pptxgen() as any;
  pres.layout = 'LAYOUT_16x9';
  pres.author = 'SF Proposal Generator';
  pres.title = title;

  const totalSlides = plan.slides.length;
  const fontFace = 'Calibri';
  const shadow = { type: 'outer' as const, blur: 6, offset: 2, angle: 135, color: '000000', opacity: 0.10 };

  for (let si = 0; si < totalSlides; si++) {
    const sd = plan.slides[si];
    const slide = pres.addSlide();
    slide.background = { color: sd.bgColor || plan.theme.background };

    // Header bar (skip for title & closing layouts)
    if (sd.layout !== 'title' && sd.layout !== 'closing') {
      slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.75, fill: { color: plan.theme.primary } });
      slide.addText(sd.title, { x: 0.4, y: 0, w: 7, h: 0.75, fontSize: 22, fontFace, bold: true, color: 'FFFFFF', valign: 'middle', margin: 0 });
      if (sd.subtitle) {
        slide.addText(sd.subtitle, { x: 0.4, y: 0.75, w: 9, h: 0.32, fontSize: 11, fontFace, color: plan.theme.lightText, italic: true, valign: 'middle', margin: 0 });
      }
    }

    // Footer (skip for title layout)
    if (sd.layout !== 'title') {
      slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.35, w: 10, h: 0.275, fill: { color: plan.theme.primary } });
      slide.addText(`Confidential | ${si + 1} / ${totalSlides}`, { x: 0, y: 5.35, w: 10, h: 0.275, fontSize: 9, fontFace, color: plan.theme.accent || 'CADCFC', align: 'right', valign: 'middle', margin: [0, 0.3, 0, 0] });
    }

    // Render elements
    for (const el of sd.elements) {
      const baseOpts = { x: el.x, y: el.y, w: el.w, h: el.h };

      switch (el.type) {
        case 'text': {
          slide.addText(String(el.content ?? ''), {
            ...baseOpts,
            fontSize: el.fontSize || 14,
            fontFace,
            bold: el.bold || false,
            italic: el.italic || false,
            color: el.color || plan.theme.text,
            align: el.align || 'left',
            valign: el.valign || 'top',
            margin: [0.1, 0.15, 0.1, 0.15],
            ...(el.fill ? { fill: { color: el.fill } } : {}),
          });
          break;
        }

        case 'shape': {
          slide.addShape(pres.shapes.RECTANGLE, {
            ...baseOpts,
            fill: el.fill ? { color: el.fill } : undefined,
            line: el.borderColor ? { color: el.borderColor, width: 1 } : undefined,
            shadow,
          });
          break;
        }

        case 'list': {
          const items = el.items || [];
          const textItems = items.map((item, idx) => ({
            text: String(item ?? ''),
            options: { bullet: true, breakLine: idx < items.length - 1 },
          }));
          slide.addText(textItems, {
            ...baseOpts,
            fontSize: el.fontSize || 12,
            fontFace,
            color: el.color || plan.theme.text,
            valign: 'top',
            margin: [0.1, 0.15, 0.1, 0.15],
          });
          break;
        }

        case 'kpi': {
          // Card background
          slide.addShape(pres.shapes.RECTANGLE, {
            ...baseOpts,
            fill: { color: el.fill || 'FFFFFF' },
            shadow,
          });
          // Accent top bar
          slide.addShape(pres.shapes.RECTANGLE, {
            x: el.x, y: el.y, w: el.w, h: 0.06,
            fill: { color: el.valueColor || plan.theme.accent },
          });
          // Value
          slide.addText(String(el.value ?? ''), {
            x: el.x, y: el.y + 0.1, w: el.w, h: el.h * 0.55,
            fontSize: Math.min(36, Math.max(20, Math.round(el.h * 18))),
            fontFace,
            bold: true,
            color: el.valueColor || plan.theme.accent,
            align: 'center',
            valign: 'middle',
            margin: 0,
          });
          // Label
          slide.addText(String(el.label ?? ''), {
            x: el.x, y: el.y + el.h * 0.6, w: el.w, h: el.h * 0.35,
            fontSize: 11,
            fontFace,
            color: plan.theme.lightText,
            align: 'center',
            valign: 'top',
            margin: 0,
          });
          break;
        }

        case 'table': {
          const rows = el.rows || [];
          if (rows.length === 0) break;
          const headerBg = el.headerBg || plan.theme.primary;
          const tableRows = rows.map((row, ri) =>
            row.map(cell => ({
              text: String(cell ?? ''),
              options: {
                fontSize: ri === 0 ? 11 : 10,
                fontFace,
                bold: ri === 0,
                color: ri === 0 ? 'FFFFFF' : plan.theme.text,
                fill: ri === 0 ? { color: headerBg } : ri % 2 === 0 ? { color: 'F8F9FA' } : undefined,
                valign: 'middle' as const,
                margin: [0.05, 0.1, 0.05, 0.1],
              },
            }))
          );
          slide.addTable(tableRows, {
            ...baseOpts,
            border: { pt: 0.5, color: 'DEE2E6' },
            colW: Array(rows[0].length).fill(el.w / rows[0].length),
          });
          break;
        }
      }
    }
  }

  return (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
}

// ---- API route ----
export async function POST(req: NextRequest) {
  try {
    const { data, analysis, aiProvider: reqProvider, aiApiKey: reqApiKey } = await req.json();
    if (!data || !analysis) return NextResponse.json({ error: 'データまたは分析結果が不足しています' }, { status: 400 });

    const provider: AIProvider = reqProvider || process.env.PROPOSAL_AI_PROVIDER || 'gemini';
    const envKeyMap: Record<AIProvider, string | undefined> = {
      gemini: process.env.GEMINI_API_KEY,
      claude: process.env.ANTHROPIC_API_KEY,
      chatgpt: process.env.OPENAI_API_KEY,
    };
    const apiKey = reqApiKey || envKeyMap[provider];
    if (!apiKey) return NextResponse.json({ error: `${provider}のAPIキーが設定されていません。画面で入力するか環境変数を設定してください。` }, { status: 400 });

    const plan = await generatePlan(data, analysis, provider, apiKey);
    const pptxTitle = `提案書 - ${data.opportunity?.Name || '商談'}`;
    const pptxBuffer = await renderPPTX(plan, pptxTitle);
    const fileName = encodeURIComponent(`提案書_${data.account?.Name || ''}_${data.opportunity?.Name || ''}.pptx`);

    return new NextResponse(new Uint8Array(pptxBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename*=UTF-8''${fileName}`,
        'Content-Length': String(pptxBuffer.length),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    console.error('Generate PPTX Error:', err);
    return NextResponse.json({ error: `生成エラー: ${message}` }, { status: 500 });
  }
}

export const runtime = 'nodejs';
