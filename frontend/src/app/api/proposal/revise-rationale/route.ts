import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

interface ServiceRecommendation {
  service: string;
  relevance: 'primary' | 'secondary' | 'optional';
  reason: string;
  features: string[];
}

interface AnalysisRationale {
  customerChallenges: string[];
  serviceRecommendations: ServiceRecommendation[];
  combinedSolution: string;
  existingProposalHints: string[];
}

type AIProvider = 'gemini' | 'claude' | 'chatgpt';

function buildRevisionPrompt(currentRationale: AnalysisRationale, feedback: string): string {
  return `あなたはDXソリューション企業の法人営業コンサルタントです。
以下の分析根拠に対して、ユーザーから補足・修正のフィードバックがありました。
フィードバックの内容を反映して、分析根拠を修正してください。

## 現在の分析根拠
### 顧客の課題
${currentRationale.customerChallenges.map((c, i) => `${i + 1}. ${c}`).join('\n')}

### 推薦サービス
${currentRationale.serviceRecommendations.map(s => `- ${s.service}（${s.relevance}）: ${s.reason}\n  機能: ${s.features.join('、')}`).join('\n')}

### 総合ソリューション
${currentRationale.combinedSolution}

### 提案書に含めるべきポイント
${currentRationale.existingProposalHints.map((h, i) => `${i + 1}. ${h}`).join('\n')}

## ユーザーからのフィードバック
${feedback}

## 弊社の製品・サービス
1. **DX開発サービス**: カスタムDXソリューション設計・開発、レガシーシステム刷新、業務プロセス自動化、API連携、Web/モバイルアプリ開発、データ基盤構築
2. **AI RAG Agent**: RAGベースのAI質問応答システム、社内ナレッジ検索、ドキュメント自動分類・検索、商談分析・提案書自動生成
3. **書きあげクン**: AI音声文字起こし、会議録・議事録自動作成、多言語対応、要約・キーポイント抽出

## 指示
- フィードバックの内容を正確に反映してください
- 誤りの指摘があれば修正してください
- 補足情報があれば取り入れて内容を充実させてください
- 削除の指示があれば該当項目を削除してください
- フィードバックに関係ない部分はそのまま維持してください

## 回答形式（JSON以外のテキストは一切返さないでください）
{
  "customerChallenges": ["修正後の課題1", "課題2", "課題3"],
  "serviceRecommendations": [
    {
      "service": "サービス名（DX開発サービス/AI RAG Agent/書きあげクン）",
      "relevance": "primary/secondary/optional",
      "reason": "修正後の推薦理由",
      "features": ["機能1", "機能2"]
    }
  ],
  "combinedSolution": "修正後の総合ソリューション説明",
  "existingProposalHints": ["修正後のポイント1", "ポイント2"]
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
      const response = await client.messages.create({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
      return response.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
    }
    case 'chatgpt': {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 2000 });
      return response.choices[0]?.message?.content || '';
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { currentRationale, feedback, aiProvider: reqProvider, aiApiKey: reqApiKey } = await req.json();

    if (!currentRationale || !feedback?.trim()) {
      return NextResponse.json({ error: 'フィードバック内容が必要です' }, { status: 400 });
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

    const prompt = buildRevisionPrompt(currentRationale, feedback);
    const text = await callAI(prompt, provider, apiKey);

    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      const revised: AnalysisRationale = {
        customerChallenges: parsed.customerChallenges || [],
        serviceRecommendations: (parsed.serviceRecommendations || []).map((s: R) => ({
          service: s.service || '',
          relevance: s.relevance || 'optional',
          reason: s.reason || '',
          features: s.features || [],
        })),
        combinedSolution: parsed.combinedSolution || '',
        existingProposalHints: parsed.existingProposalHints || [],
      };
      return NextResponse.json({ rationale: revised });
    } catch {
      return NextResponse.json({ error: 'AIの回答をパースできませんでした。再度お試しください。' }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    console.error('Revise Rationale Error:', err);
    return NextResponse.json({ error: `修正エラー: ${message}` }, { status: 500 });
  }
}

export const runtime = 'nodejs';
