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

interface ScenarioResult {
  label: string;
  probability: number;
  expectedRevenue: number;
  timeline: string;
  conditions: string[];
}

interface AnalysisResult {
  winProbability: number;
  dealHealthScore: number;
  activityScore: number;
  engagementLevel: string;
  proposalReadiness: number;
  scenarios: { optimistic: ScenarioResult; base: ScenarioResult; pessimistic: ScenarioResult };
  keyDrivers: string[];
  riskFactors: string[];
  recommendedActions: string[];
  rationale: AnalysisRationale;
}

type AIProvider = 'gemini' | 'claude' | 'chatgpt';

function buildRevisionPrompt(analysis: AnalysisResult, feedback: string): string {
  const r = analysis.rationale;
  return `あなたはDXソリューション企業の法人営業コンサルタントです。
以下の分析結果と分析根拠に対して、ユーザーから補足・修正のフィードバックがありました。
フィードバックの内容を反映して、分析根拠および分析結果を修正してください。

## 現在の分析結果
- 受注確度: ${analysis.winProbability}%
- 商談健全度: ${analysis.dealHealthScore}/100
- 活動スコア: ${analysis.activityScore}/100
- エンゲージメント: ${analysis.engagementLevel}
- 提案準備度: ${analysis.proposalReadiness}/100
- 主要成功要因: ${analysis.keyDrivers.join('、')}
- リスク要因: ${analysis.riskFactors.join('、')}
- 推奨アクション: ${analysis.recommendedActions.join('、')}

### シナリオ
- 楽観: ${analysis.scenarios.optimistic.label}（確率${analysis.scenarios.optimistic.probability}%）
- 基本: ${analysis.scenarios.base.label}（確率${analysis.scenarios.base.probability}%）
- 悲観: ${analysis.scenarios.pessimistic.label}（確率${analysis.scenarios.pessimistic.probability}%）

## 現在の分析根拠
### 顧客の課題
${r.customerChallenges.map((c, i) => `${i + 1}. ${c}`).join('\n')}

### 推薦サービス
${r.serviceRecommendations.map(s => `- ${s.service}（${s.relevance}）: ${s.reason}\n  機能: ${s.features.join('、')}`).join('\n')}

### 総合ソリューション
${r.combinedSolution}

### 提案書に含めるべきポイント
${r.existingProposalHints.map((h, i) => `${i + 1}. ${h}`).join('\n')}

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
- **推薦サービスは、フィードバック内容に応じて追加・削除・変更してください。顧客の課題が変わればそれに合ったサービスを推薦し直してください**
- **分析結果（受注確度、スコア、シナリオ等）もフィードバック内容に応じて適切に更新してください。フィードバックが分析結果に影響する場合は変更し、影響しない場合はそのまま維持してください**
- フィードバックに関係ない部分はそのまま維持してください

## 回答形式（JSON以外のテキストは一切返さないでください）
{
  "rationale": {
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
  },
  "analysisUpdates": {
    "winProbability": 75,
    "dealHealthScore": 70,
    "activityScore": 60,
    "engagementLevel": "高",
    "proposalReadiness": 65,
    "keyDrivers": ["要因1", "要因2"],
    "riskFactors": ["リスク1", "リスク2"],
    "recommendedActions": ["アクション1", "アクション2"],
    "scenarios": {
      "optimistic": { "label": "楽観シナリオ", "probability": 30, "expectedRevenue": 5000000, "timeline": "3ヶ月", "conditions": ["条件1"] },
      "base": { "label": "基本シナリオ", "probability": 50, "expectedRevenue": 3000000, "timeline": "6ヶ月", "conditions": ["条件1"] },
      "pessimistic": { "label": "悲観シナリオ", "probability": 20, "expectedRevenue": 1000000, "timeline": "12ヶ月", "conditions": ["条件1"] }
    }
  }
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
      const response = await client.messages.create({ model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] });
      return response.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
    }
    case 'chatgpt': {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 4000 });
      return response.choices[0]?.message?.content || '';
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { currentRationale, currentAnalysis, feedback, aiProvider: reqProvider, aiApiKey: reqApiKey } = await req.json();

    if ((!currentRationale && !currentAnalysis) || !feedback?.trim()) {
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

    // Build full analysis object for prompt (support both old and new request formats)
    const analysis: AnalysisResult = currentAnalysis || {
      winProbability: 0, dealHealthScore: 0, activityScore: 0,
      engagementLevel: '', proposalReadiness: 0,
      scenarios: {
        optimistic: { label: '', probability: 0, expectedRevenue: 0, timeline: '', conditions: [] },
        base: { label: '', probability: 0, expectedRevenue: 0, timeline: '', conditions: [] },
        pessimistic: { label: '', probability: 0, expectedRevenue: 0, timeline: '', conditions: [] },
      },
      keyDrivers: [], riskFactors: [], recommendedActions: [],
      rationale: currentRationale,
    };
    // Ensure rationale is populated
    if (currentRationale && !analysis.rationale) {
      analysis.rationale = currentRationale;
    }

    const prompt = buildRevisionPrompt(analysis, feedback);
    const text = await callAI(prompt, provider, apiKey);

    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

      // Handle both nested format { rationale, analysisUpdates } and flat format (backward compat)
      const rationaleData = parsed.rationale || parsed;
      const analysisUpdates = parsed.analysisUpdates || null;

      const revised: AnalysisRationale = {
        customerChallenges: rationaleData.customerChallenges || [],
        serviceRecommendations: (rationaleData.serviceRecommendations || []).map((s: R) => ({
          service: s.service || '',
          relevance: s.relevance || 'optional',
          reason: s.reason || '',
          features: s.features || [],
        })),
        combinedSolution: rationaleData.combinedSolution || '',
        existingProposalHints: rationaleData.existingProposalHints || [],
      };

      const response: R = { rationale: revised };

      if (analysisUpdates) {
        const updates: R = {};
        if (analysisUpdates.winProbability != null) updates.winProbability = analysisUpdates.winProbability;
        if (analysisUpdates.dealHealthScore != null) updates.dealHealthScore = analysisUpdates.dealHealthScore;
        if (analysisUpdates.activityScore != null) updates.activityScore = analysisUpdates.activityScore;
        if (analysisUpdates.engagementLevel != null) updates.engagementLevel = analysisUpdates.engagementLevel;
        if (analysisUpdates.proposalReadiness != null) updates.proposalReadiness = analysisUpdates.proposalReadiness;
        if (analysisUpdates.keyDrivers) updates.keyDrivers = analysisUpdates.keyDrivers;
        if (analysisUpdates.riskFactors) updates.riskFactors = analysisUpdates.riskFactors;
        if (analysisUpdates.recommendedActions) updates.recommendedActions = analysisUpdates.recommendedActions;
        if (analysisUpdates.scenarios) updates.scenarios = analysisUpdates.scenarios;
        response.analysisUpdates = updates;
      }

      return NextResponse.json(response);
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
