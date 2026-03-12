import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

type AIProvider = 'gemini' | 'claude' | 'chatgpt';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `あなたは弊社（DXソリューション企業）の法人営業ソリューションコンサルタントです。
顧客の既存商談データや新規商談情報をもとに、以下の流れで分析・提案を行ってください：

1. **現状分析**: 商談データから顧客の課題・ニーズを特定
2. **解決策提案**: 課題に対する具体的な解決方法を詳しく説明
3. **自社製品・サービス推薦**: 弊社のソリューションを中心に推薦（下記の製品ラインナップ参照）
4. **アクションプラン**: 具体的な次のステップを提示

## 弊社の製品・サービスラインナップ（優先的に推薦すること）

### 1. DX開発サービス
- カスタムDXソリューションの設計・開発・導入支援
- レガシーシステムのモダナイゼーション、クラウド移行
- 業務プロセスのデジタル化・自動化（RPA、ワークフロー等）
- システムインテグレーション、API連携開発
- UI/UXデザイン、Webアプリ・モバイルアプリ開発
- データ基盤構築、BI・ダッシュボード開発

### 2. AI RAG Agent（本製品）
- RAG（Retrieval-Augmented Generation）ベースのAIエージェント
- 社内文書・ナレッジベースを活用したAI質問応答システム
- ドキュメントのアップロード → 自動分類 → チャンキング → 検索 → AI回答
- マルチモーダル対応（PDF、画像、テキスト等）
- カスタマイズ可能なプロンプト・ワークフロー
- 商談分析・提案書自動生成機能（本Q&A機能を含む）
- **活用例**: 社内FAQ、営業支援、カスタマーサポート、技術文書検索

### 3. 書きあげクン（文字起こし製品）
- 高精度AI音声文字起こしサービス
- 会議録・議事録の自動作成
- 多言語対応（日本語・英語等）
- リアルタイム文字起こし対応
- 要約・キーポイント抽出機能
- **活用例**: 会議議事録、インタビュー記録、コールセンター分析、研修記録

## 推薦ルール
- 顧客の課題に対して、まず弊社の製品・サービスで解決できる部分を提案する
- 複数の製品を組み合わせた包括的なソリューションを提示する
- 弊社製品では対応しきれない部分がある場合のみ、補完的に他社ツールを紹介する
- コスト面でも弊社サービスの優位性（SFの高額サービスと比較してリーズナブル）をアピールする
- 導入事例や活用シナリオを具体的に記載する

回答は日本語で、構造化して分かりやすく記載してください。
Markdownフォーマット（見出し、箇条書き、太字等）を使って読みやすくしてください。
不明点がある場合は質問してください。`;

function buildContextPrompt(sfData: R | null, dealInput: R | null): string {
  const parts: string[] = [];

  if (sfData) {
    parts.push('## 既存Salesforceデータ');
    if (sfData.account?.Name) {
      parts.push(`### 顧客情報
- 会社名: ${sfData.account.Name}
- 業界: ${sfData.account.Industry || '未設定'}
- 年商: ${sfData.account.AnnualRevenue || '未設定'}
- 従業員数: ${sfData.account.NumberOfEmployees || '未設定'}`);
    }
    if (sfData.opportunity?.Name) {
      parts.push(`### 商談情報
- 商談名: ${sfData.opportunity.Name}
- 金額: ${sfData.opportunity.Amount || 0}
- ステージ: ${sfData.opportunity.StageName || ''}
- 確度: ${sfData.opportunity.Probability || 0}%
- 説明: ${sfData.opportunity.Description || 'なし'}`);
    }
    if (sfData.activities?.length > 0) {
      parts.push(`### 活動記録（${sfData.activities.length}件）
${sfData.activities.slice(0, 10).map((a: R) => `- [${a.ActivityDate || ''}] ${a.Subject || ''} (${a.Status || ''})`).join('\n')}`);
    }
    if (sfData.events?.length > 0) {
      parts.push(`### 会議・訪問（${sfData.events.length}件）
${sfData.events.slice(0, 5).map((e: R) => `- [${e.StartDateTime || ''}] ${e.Subject || ''} @ ${e.Location || ''}`).join('\n')}`);
    }
    if (sfData.feedItems?.length > 0) {
      parts.push(`### Chatter/日報（${sfData.feedItems.length}件）
${sfData.feedItems.slice(0, 5).map((f: R) => `- [${f.CreatedDate || ''}] ${(f.Body || '').slice(0, 200)}`).join('\n')}`);
    }
    if (sfData.cases?.length > 0) {
      parts.push(`### 問い合わせ（${sfData.cases.length}件）
${sfData.cases.slice(0, 5).map((c: R) => `- ${c.Subject || ''} (${c.Status || ''} / ${c.Priority || ''})`).join('\n')}`);
    }
    if (sfData.contacts?.length > 0) {
      parts.push(`### 関係者（${sfData.contacts.length}名）
${sfData.contacts.slice(0, 5).map((c: R) => `- ${c.LastName || ''}${c.FirstName || ''}（${c.Title || '役職不明'}）`).join('\n')}`);
    }
    if (sfData.emails?.length > 0) {
      parts.push(`### メール履歴（${sfData.emails.length}件）
${sfData.emails.slice(0, 5).map((e: R) => `- [${e.Date || ''}] ${e.Subject || ''}`).join('\n')}`);
    }
  }

  if (dealInput) {
    parts.push('## 新規商談情報');
    if (dealInput.customerName) parts.push(`- 顧客名: ${dealInput.customerName}`);
    if (dealInput.industry) parts.push(`- 業界: ${dealInput.industry}`);
    if (dealInput.challenge) parts.push(`- 課題: ${dealInput.challenge}`);
    if (dealInput.budget) parts.push(`- 予算: ${dealInput.budget}`);
    if (dealInput.timeline) parts.push(`- 期限: ${dealInput.timeline}`);
    if (dealInput.description) parts.push(`- 詳細:\n${dealInput.description}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

async function generateResponse(
  messages: Message[],
  contextPrompt: string,
  provider: AIProvider,
  apiKey: string,
): Promise<string> {
  const systemMsg = SYSTEM_PROMPT + (contextPrompt ? `\n\n${contextPrompt}` : '');

  switch (provider) {
    case 'gemini': {
      const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: systemMsg });
      const chat = model.startChat({
        history: messages.slice(0, -1).map(m => ({
          role: m.role === 'user' ? 'user' as const : 'model' as const,
          parts: [{ text: m.content }],
        })),
      });
      const lastMsg = messages[messages.length - 1];
      const result = await chat.sendMessage(lastMsg.content);
      return result.response.text();
    }
    case 'claude': {
      const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        system: systemMsg,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });
      return response.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
    }
    case 'chatgpt': {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: systemMsg },
          ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
      });
      return response.choices[0]?.message?.content || '';
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { messages, sfData, dealInput, aiProvider: reqProvider, aiApiKey: reqApiKey } = await req.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'メッセージが必要です' }, { status: 400 });
    }

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

    const contextPrompt = buildContextPrompt(sfData || null, dealInput || null);
    const reply = await generateResponse(messages, contextPrompt, provider, apiKey);

    return NextResponse.json({ reply });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    console.error('Solution QA Error:', err);
    return NextResponse.json({ error: `回答生成エラー: ${message}` }, { status: 500 });
  }
}

export const runtime = 'nodejs';
