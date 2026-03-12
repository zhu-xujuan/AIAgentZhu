import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

// Types
interface Activity { ActivityDate: string; }
interface SFData {
  account: { Industry: string; Name?: string; Description?: string; [k: string]: unknown };
  opportunity: {
    Amount: number; StageName: string; CloseDate: string; Probability: number;
    LeadSource: string; Type: string; CreatedDate: string; NextStep: string;
    Id: string; Name?: string; Description?: string; [k: string]: unknown;
  };
  activities: Activity[];
  contacts: { Id: string; [k: string]: unknown }[];
  events?: R[];
  feedItems?: R[];
  notes?: R[];
  cases?: R[];
  emails?: R[];
  [k: string]: unknown;
}

interface ScenarioResult {
  label: string; probability: number; expectedRevenue: number;
  timeline: string; conditions: string[];
}

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

interface AnalysisResult {
  winProbability: number; dealHealthScore: number; activityScore: number;
  engagementLevel: string; proposalReadiness: number;
  scenarios: { optimistic: ScenarioResult; base: ScenarioResult; pessimistic: ScenarioResult };
  keyDrivers: string[]; riskFactors: string[]; recommendedActions: string[];
  rationale: AnalysisRationale;
}

type AIProvider = 'gemini' | 'claude' | 'chatgpt';

// ---- Scoring ----
const STAGE_WIN_RATE: Record<string, number> = {
  'Prospecting': 0.10, 'Qualification': 0.20, 'Needs Analysis': 0.30,
  'Value Proposition': 0.40, 'Id. Decision Makers': 0.50, 'Perception Analysis': 0.55,
  'Proposal/Price Quote': 0.65, 'Negotiation/Review': 0.80, 'Closed Won': 1.00, 'Closed Lost': 0.00,
};

function getStageScore(stageName: string): number {
  for (const [key, val] of Object.entries(STAGE_WIN_RATE)) {
    if (stageName.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return 0.30;
}

function getDaysUntilClose(closeDate: string): number {
  if (!closeDate) return 90;
  return Math.ceil((new Date(closeDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function getDealAgeInDays(createdDate: string): number {
  if (!createdDate) return 30;
  return Math.ceil((Date.now() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24));
}

function getActivityScore(activities: Activity[]): number {
  if (activities.length === 0) return 0;
  let score = 0;
  for (const act of activities) {
    const daysAgo = (Date.now() - new Date(act.ActivityDate || new Date()).getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo <= 7) score += 20;
    else if (daysAgo <= 14) score += 15;
    else if (daysAgo <= 30) score += 10;
    else if (daysAgo <= 60) score += 5;
    else score += 2;
  }
  return Math.min(100, score);
}

// ---- Proposal readiness score (new) ----
function getProposalReadiness(data: SFData, activityScore: number): number {
  let score = 0;
  // Has description/requirements
  if (data.opportunity.Description) score += 20;
  // Has contacts
  score += Math.min(20, (data.contacts?.length || 0) * 5);
  // Activity level
  score += Math.round(activityScore * 0.2);
  // Has budget
  if (data.opportunity.Amount > 0) score += 15;
  // Has timeline
  if (data.opportunity.CloseDate) score += 10;
  // Has next steps
  if (data.opportunity.NextStep) score += 10;
  // Has industry context
  if (data.account.Industry) score += 5;
  return Math.min(100, score);
}

// ---- AI-powered rationale generation ----
function buildRationalePrompt(data: SFData): string {
  const parts: string[] = [`顧客情報:
- 会社名: ${data.account.Name || '不明'}
- 業界: ${data.account.Industry || '未設定'}
- 商談名: ${data.opportunity.Name || '不明'}
- 説明: ${data.opportunity.Description || 'なし'}
- 金額: ${data.opportunity.Amount || 0}
- ステージ: ${data.opportunity.StageName || '未設定'}`];

  if (data.activities?.length > 0) {
    parts.push(`活動記録（${data.activities.length}件）: ${data.activities.slice(0, 5).map((a: R) => a.Subject || a.Description || '').filter(Boolean).join('、') || '詳細なし'}`);
  }
  if (data.cases && data.cases.length > 0) {
    parts.push(`問い合わせ（${data.cases.length}件）: ${data.cases.slice(0, 3).map((c: R) => c.Subject || '').filter(Boolean).join('、')}`);
  }
  if (data.feedItems && data.feedItems.length > 0) {
    parts.push(`Chatter/日報: ${data.feedItems.slice(0, 3).map((f: R) => (f.Body || '').slice(0, 100)).filter(Boolean).join(' / ')}`);
  }
  if (data.emails && data.emails.length > 0) {
    parts.push(`メール件名: ${data.emails.slice(0, 5).map((e: R) => e.Subject || '').filter(Boolean).join('、')}`);
  }

  return `以下の顧客データを分析し、JSON形式で回答してください。

${parts.join('\n')}

## 弊社の製品・サービス
1. **DX開発サービス**: カスタムDXソリューション設計・開発、レガシーシステム刷新、業務プロセス自動化、API連携、Web/モバイルアプリ開発、データ基盤構築
2. **AI RAG Agent**: RAGベースのAI質問応答システム、社内ナレッジ検索、ドキュメント自動分類・検索、商談分析・提案書自動生成
3. **書きあげクン**: AI音声文字起こし、会議録・議事録自動作成、多言語対応、要約・キーポイント抽出

## 回答形式（JSON以外のテキストは一切不要）
{
  "customerChallenges": ["顧客の具体的な課題1", "課題2", "課題3"],
  "serviceRecommendations": [
    {
      "service": "サービス名（DX開発サービス/AI RAG Agent/書きあげクン）",
      "relevance": "primary/secondary/optional",
      "reason": "この顧客にこのサービスを推薦する具体的な理由",
      "features": ["活用する具体的な機能1", "機能2"]
    }
  ],
  "combinedSolution": "複数サービスを組み合わせた包括的なソリューションの説明（2〜3文）",
  "existingProposalHints": ["提案書に含めるべきポイント1", "ポイント2", "ポイント3"]
}`;
}

async function generateRationale(data: SFData, provider: AIProvider, apiKey: string): Promise<AnalysisRationale> {
  const prompt = buildRationalePrompt(data);
  let text = '';

  switch (provider) {
    case 'gemini': {
      const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      text = result.response.text();
      break;
    }
    case 'claude': {
      const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
      text = response.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
      break;
    }
    case 'chatgpt': {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 2000 });
      text = response.choices[0]?.message?.content || '';
      break;
    }
  }

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
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
  } catch {
    // Fallback if AI response is not valid JSON
    return {
      customerChallenges: ['顧客課題の詳細分析にはより多くの情報が必要です'],
      serviceRecommendations: [
        { service: 'DX開発サービス', relevance: 'primary', reason: '業務プロセスのデジタル化支援', features: ['カスタム開発', 'システム統合'] },
        { service: 'AI RAG Agent', relevance: 'secondary', reason: '社内ナレッジ活用・提案書自動生成', features: ['AI質問応答', 'ドキュメント検索'] },
      ],
      combinedSolution: 'DX開発で基盤を構築し、AI RAG Agentで知識活用を最適化するソリューションを提案します。',
      existingProposalHints: ['顧客の業界特性に合わせた提案', 'ROI試算の提示'],
    };
  }
}

// ---- Main analysis ----
function analyzeData(data: SFData): Omit<AnalysisResult, 'rationale'> {
  const stageScore = getStageScore(data.opportunity.StageName);
  const activityScore = getActivityScore(data.activities);
  const contactBonus = Math.min(0.10, data.contacts.length * 0.02);
  const activityBonus = (activityScore / 100) * 0.15;
  const sfProbWeight = (data.opportunity.Probability / 100) * 0.20;
  const winProbability = Math.min(0.95, stageScore * 0.60 + sfProbWeight + activityBonus + contactBonus);
  const dealHealthScore = Math.min(100, Math.round(
    stageScore * 30 + (activityScore / 100) * 25 + Math.min(25, data.contacts.length * 5) + (data.opportunity.Probability / 100) * 20
  ));
  const total = activityScore * 0.7 + data.contacts.length * 3;
  const engagementLevel = total >= 70 ? '高' : total >= 40 ? '中' : '低';
  const proposalReadiness = getProposalReadiness(data, activityScore);
  const amount = data.opportunity.Amount || 0;
  const daysUntilClose = getDaysUntilClose(data.opportunity.CloseDate);
  const dealAge = getDealAgeInDays(data.opportunity.CreatedDate);
  const opp = data.opportunity;

  const scenarios = {
    optimistic: {
      label: '楽観シナリオ', probability: Math.min(0.95, winProbability + 0.20),
      expectedRevenue: amount * 1.10,
      timeline: daysUntilClose > 0 ? `${Math.max(7, daysUntilClose - 14)}日以内` : '即時クローズ可能',
      conditions: ['意思決定者との直接面談を早期実施', '競合他社より先行して提案書提出', '追加割引または特典の提供', '経営層のスポンサー獲得'],
    },
    base: {
      label: '標準シナリオ', probability: winProbability, expectedRevenue: amount,
      timeline: daysUntilClose > 0 ? `${daysUntilClose}日` : '要再設定',
      conditions: ['現在のエンゲージメント水準を維持', 'クローズ予定日どおりに進捗', '既存の要件・予算での合意'],
    },
    pessimistic: {
      label: '悲観シナリオ', probability: Math.max(0.05, winProbability - 0.25),
      expectedRevenue: amount * 0.75, timeline: `${daysUntilClose + 30}日以上`,
      conditions: ['予算削減・凍結リスク', '競合案件との比較検討長期化', '意思決定プロセスの複雑化', 'スコープ縮小での再提案が必要'],
    },
  };

  const keyDrivers: string[] = [];
  if (opp.Amount > 1000000) keyDrivers.push('大型案件（高い戦略的優先度）');
  if (opp.Probability >= 60) keyDrivers.push(`商談確度${opp.Probability}%（高確度）`);
  if (data.activities.length >= 5) keyDrivers.push(`活発な商談活動（直近${data.activities.length}件のアクティビティ）`);
  if (data.contacts.length >= 3) keyDrivers.push(`複数のキーパーソンとの関係構築済み（${data.contacts.length}名）`);
  if (opp.LeadSource) keyDrivers.push(`${opp.LeadSource}経由のリード（信頼性の高いソース）`);
  if (data.account.Industry) keyDrivers.push(`${data.account.Industry}業界への深い知見`);
  if (opp.NextStep) keyDrivers.push('明確なネクストステップ設定済み');
  if (keyDrivers.length < 3) keyDrivers.push('既存顧客との信頼関係', '製品適合性の高い要件');

  const riskFactors: string[] = [];
  if (daysUntilClose < 14 && daysUntilClose > 0) riskFactors.push('クローズ期限が迫っている（2週間以内）');
  if (daysUntilClose < 0) riskFactors.push('クローズ予定日超過（再スケジューリング必要）');
  if (dealAge > 180) riskFactors.push('商談長期化（6ヶ月超）による失注リスク');
  if (data.activities.length < 3) riskFactors.push('アクティビティ不足（エンゲージメント低下の兆候）');
  if (opp.Probability < 30) riskFactors.push(`商談確度低（${opp.Probability}%）`);
  if (!opp.NextStep) riskFactors.push('ネクストステップ未設定（商談進捗が不明確）');
  if (data.contacts.length < 2) riskFactors.push('コンタクト不足（意思決定者へのアクセス限定的）');
  if (riskFactors.length < 2) riskFactors.push('競合他社の存在', '予算承認プロセスの不明確さ');

  const recommendedActions: string[] = [];
  if (daysUntilClose < 30) recommendedActions.push('緊急：今週中にエグゼクティブスポンサーとのミーティングを設定');
  if (!opp.NextStep) recommendedActions.push('ネクストステップを具体的なアクションと日程で再設定');
  if (data.contacts.length < 3) recommendedActions.push('追加キーパーソン（IT・財務・調達部門）の特定とアプローチ');
  if (data.activities.length < 5) recommendedActions.push('商談活性化のためデモ・ワークショップの実施を提案');
  if (winProbability < 0.5) recommendedActions.push('競合差別化ポイントを強調したカスタム提案書を再作成');
  recommendedActions.push('ROIシミュレーション資料を用いた経営判断サポート');
  recommendedActions.push('パイロット案件での早期導入効果実証を提案');

  return {
    winProbability: Math.round(winProbability * 100), dealHealthScore, activityScore: Math.round(activityScore),
    engagementLevel, proposalReadiness, scenarios,
    keyDrivers: keyDrivers.slice(0, 5),
    riskFactors: riskFactors.slice(0, 5),
    recommendedActions: recommendedActions.slice(0, 5),
  };
}

export async function POST(req: NextRequest) {
  try {
    const { data, aiProvider: reqProvider, aiApiKey: reqApiKey } = await req.json();
    if (!data?.opportunity?.Id) {
      return NextResponse.json({ error: '商談データが不足しています' }, { status: 400 });
    }

    const analysis = analyzeData(data);

    // Generate AI rationale
    const provider: AIProvider = reqProvider || process.env.PROPOSAL_AI_PROVIDER || 'gemini';
    const envKeyMap: Record<AIProvider, string | undefined> = {
      gemini: process.env.GEMINI_API_KEY,
      claude: process.env.ANTHROPIC_API_KEY,
      chatgpt: process.env.OPENAI_API_KEY,
    };
    const apiKey = reqApiKey || envKeyMap[provider];
    console.log(`[analyze] provider=${provider}, keySource=${reqApiKey ? 'request' : 'env'}, keyPrefix=${apiKey?.slice(0, 8)}..., keyLen=${apiKey?.length}`);

    let rationale: AnalysisRationale;
    if (apiKey) {
      rationale = await generateRationale(data, provider, apiKey);
    } else {
      rationale = {
        customerChallenges: ['AI分析にはAPIキーが必要です'],
        serviceRecommendations: [],
        combinedSolution: '',
        existingProposalHints: [],
      };
    }

    return NextResponse.json({ analysis: { ...analysis, rationale } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: `分析エラー: ${message}` }, { status: 500 });
  }
}
