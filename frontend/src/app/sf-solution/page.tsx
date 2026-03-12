"use client";

import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Send,
  Square,
  ChevronDown,
  ChevronUp,
  Database,
  PenLine,
  FileDown,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message as MsgComponent,
  MessageContent,
  MessageResponse,
  StreamingIndicator,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

type AIProvider = "gemini" | "claude" | "chatgpt";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface DealInput {
  customerName: string;
  industry: string;
  challenge: string;
  budget: string;
  timeline: string;
  description: string;
}

// Sample deals showcasing our 3 products
const SAMPLE_DEALS: { label: string; deal: DealInput }[] = [
  {
    label: "製造業：社内ナレッジAI活用",
    deal: {
      customerName: "山田製造株式会社",
      industry: "製造業",
      challenge:
        "技術文書・マニュアルが膨大で検索に時間がかかる、ベテラン退職によるノウハウ流出、新人教育の効率化",
      budget: "1500万円",
      timeline: "3ヶ月以内",
      description:
        "従業員500名の中堅製造業。20年分の技術文書・品質マニュアル・設計図面が社内サーバーに散在。ベテラン技術者の退職が相次ぎ、暗黙知の共有が急務。AI RAG Agentによる社内ナレッジ検索システムと、DX開発による業務プロセス改善を検討中。",
    },
  },
  {
    label: "不動産業：会議録・商談記録の自動化",
    deal: {
      customerName: "サンライズ不動産株式会社",
      industry: "不動産業",
      challenge:
        "営業会議の議事録作成に毎回2時間、顧客との商談メモが属人化、情報共有が遅い",
      budget: "800万円",
      timeline: "2ヶ月以内",
      description:
        "全国30拠点の不動産会社。毎日の営業会議・顧客商談の記録が手書きメモやExcel管理で、共有が遅い。書きあげクンで会議・商談を自動文字起こし→AI RAG Agentでナレッジ蓄積→営業担当が過去の成功事例をAIに質問できる仕組みを求めている。",
    },
  },
  {
    label: "医療法人：DX基盤構築+AI導入",
    deal: {
      customerName: "中央メディカルグループ",
      industry: "医療・ヘルスケア",
      challenge:
        "紙カルテの電子化、院内情報のサイロ化、カンファレンス記録の効率化",
      budget: "3000万円",
      timeline: "6ヶ月",
      description:
        "5施設を運営する医療法人。紙ベースの業務が多く、DX開発で基幹システムの刷新を計画。カンファレンスや申し送りの音声を書きあげクンで文字起こしし、AI RAG Agentで医療ガイドライン・院内規定を即時検索できるシステムを構想中。",
    },
  },
  {
    label: "コンサル企業：提案書自動生成",
    deal: {
      customerName: "フューチャーコンサルティング株式会社",
      industry: "コンサルティング",
      challenge:
        "提案書作成に毎回丸1日、過去案件の知見活用ができていない、クライアント報告書の品質ばらつき",
      budget: "1200万円",
      timeline: "3ヶ月",
      description:
        "従業員80名の中堅コンサルファーム。コンサルタントが提案書・報告書作成に多大な時間を費やしている。AI RAG Agentで過去の提案書・調査レポートをナレッジ化し、新規提案書をAI自動生成。クライアントミーティングは書きあげクンで録音・文字起こし→要約→報告書ドラフト作成まで自動化したい。",
    },
  },
];

const SUGGESTIONS = [
  "この商談の課題に対して弊社製品でどう解決できますか",
  "AI RAG Agentの導入効果を教えてください",
  "書きあげクンと他の文字起こしサービスの違いは？",
  "DX開発で業務改善するアクションプランを作成してください",
  "3製品を組み合わせた包括ソリューションを提案してください",
];

export default function SFSolutionPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // AI settings
  const [aiProvider, setAiProvider] = useState<AIProvider>("gemini");


  // SF data (from Proposal tab - shared via localStorage or manual input)
  const [sfData, setSfData] = useState<R | null>(null);
  const [sfDataLabel, setSfDataLabel] = useState("");

  // Deal input
  const [dealInput, setDealInput] = useState<DealInput>({
    customerName: "",
    industry: "",
    challenge: "",
    budget: "",
    timeline: "",
    description: "",
  });
  const [showDealForm, setShowDealForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pptxDownloaded, setPptxDownloaded] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Load SF data from localStorage (saved by Proposal tab)
  const loadSFData = useCallback(() => {
    try {
      const stored = localStorage.getItem("sf_proposal_data");
      if (stored) {
        const parsed = JSON.parse(stored);
        setSfData(parsed);
        setSfDataLabel(
          `${parsed.account?.Name || "不明"} / ${parsed.opportunity?.Name || ""}`,
        );
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }, []);

  const handleSubmit = useCallback(
    async (text?: string) => {
      const q = (text || question).trim();
      if (!q || isLoading) return;

      setError("");
      setQuestion("");

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: q,
        timestamp: new Date(),
      };
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);

      const allMessages = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: q },
      ];

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/proposal/solution-qa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: allMessages,
            sfData,
            dealInput:
              dealInput.customerName || dealInput.description
                ? dealInput
                : null,
            aiProvider,
            aiApiKey: undefined,
          }),
          signal: controller.signal,
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "回答生成失敗");

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: json.reply, isStreaming: false }
              : m,
          ),
        );
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? {
                    ...m,
                    content: m.content + "\n\n(中断されました)",
                    isStreaming: false,
                  }
                : m,
            ),
          );
        } else {
          const errMsg = e instanceof Error ? e.message : "エラー";
          setError(errMsg);
          setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [question, isLoading, messages, sfData, dealInput, aiProvider],
  );

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSampleDeal = useCallback(
    (sample: (typeof SAMPLE_DEALS)[0]) => {
      setDealInput(sample.deal);
      setShowDealForm(true);
      // Auto-ask first analysis
      const autoQ = `${sample.deal.customerName}（${sample.deal.industry}）の商談について分析してください。\n\n課題: ${sample.deal.challenge}\n\n詳細: ${sample.deal.description}`;
      setTimeout(() => handleSubmit(autoQ), 100);
    },
    [handleSubmit],
  );

  const handleGeneratePPTX = useCallback(async () => {
    if (messages.length === 0) return;
    setError("");

    // Build a summary of the conversation for PPTX generation
    const conversationSummary = messages
      .map(
        (m) => `[${m.role === "user" ? "質問" : "回答"}] ${m.content.slice(0, 500)}`,
      )
      .join("\n\n");

    const pptxPrompt = `以下のQ&A会話内容から、ソリューション提案書のスライドを設計してください。\n\n${conversationSummary}`;

    try {
      setIsLoading(true);
      const fakeAnalysis = {
        winProbability: 50,
        dealHealthScore: 50,
        activityScore: 50,
        engagementLevel: "中",
        scenarios: {
          optimistic: {
            label: "楽観",
            probability: 0.7,
            expectedRevenue: 0,
            timeline: "",
            conditions: [],
          },
          base: {
            label: "標準",
            probability: 0.5,
            expectedRevenue: 0,
            timeline: "",
            conditions: [],
          },
          pessimistic: {
            label: "悲観",
            probability: 0.3,
            expectedRevenue: 0,
            timeline: "",
            conditions: [],
          },
        },
        keyDrivers: [],
        riskFactors: [],
        recommendedActions: [],
      };

      const pptxData = {
        account: sfData?.account || {
          Name: dealInput.customerName || "顧客",
          Industry: dealInput.industry || "",
        },
        opportunity: sfData?.opportunity || {
          Name: dealInput.challenge || "ソリューション提案",
          Amount: 0,
          Description: pptxPrompt,
        },
        contacts: sfData?.contacts || [],
        activities: sfData?.activities || [],
      };

      const res = await fetch("/api/proposal/generate-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: pptxData,
          analysis: fakeAnalysis,
          aiProvider,
          aiApiKey: undefined,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "PPTX生成失敗");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ソリューション提案_${dealInput.customerName || sfData?.account?.Name || "提案"}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      setPptxDownloaded(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "PPTX生成失敗");
    } finally {
      setIsLoading(false);
    }
  }, [messages, sfData, dealInput, aiProvider]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Top bar: context & settings */}
      <div className="border-b border-border bg-card/50 px-4 py-2">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <h1 className="text-sm font-semibold text-foreground whitespace-nowrap">
            SF Solution Q&A
          </h1>

          {/* SF Data indicator */}
          <button
            onClick={() => {
              if (!sfData) loadSFData();
              else {
                setSfData(null);
                setSfDataLabel("");
              }
            }}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
              sfData
                ? "border-green-300 bg-green-50 text-green-700 dark:bg-green-950/30 dark:border-green-700 dark:text-green-400"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            <Database className="w-3 h-3" />
            {sfData ? sfDataLabel : "SF データ読込"}
          </button>

          {/* Deal form toggle */}
          <button
            onClick={() => setShowDealForm(!showDealForm)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
              showDealForm || dealInput.customerName
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            <PenLine className="w-3 h-3" />
            商談入力
            {showDealForm ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>

          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
              showSettings
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            AI: {aiProvider}
          </button>

          <div className="flex-1" />

          {/* PPTX button */}
          {messages.length > 0 && (
            <button
              onClick={handleGeneratePPTX}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-primary text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              <FileDown className="w-3 h-3" />
              PPTX生成
            </button>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              AI プロバイダー:
            </span>
            {(["gemini", "claude", "chatgpt"] as AIProvider[]).map((p) => (
              <button
                key={p}
                onClick={() => setAiProvider(p)}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium border transition-colors",
                  aiProvider === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {p === "gemini"
                  ? "Gemini"
                  : p === "claude"
                    ? "Claude"
                    : "ChatGPT"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Deal input form */}
      {showDealForm && (
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[
                {
                  key: "customerName",
                  label: "顧客名",
                  placeholder: "例: 山田製造株式会社",
                },
                {
                  key: "industry",
                  label: "業界",
                  placeholder: "例: 製造業",
                },
                { key: "budget", label: "予算", placeholder: "例: 3000万円" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="block text-xs text-muted-foreground mb-0.5">
                    {f.label}
                  </label>
                  <input
                    type="text"
                    placeholder={f.placeholder}
                    value={dealInput[f.key as keyof DealInput]}
                    onChange={(e) =>
                      setDealInput((p) => ({
                        ...p,
                        [f.key]: e.target.value,
                      }))
                    }
                    className="w-full border border-border rounded px-2 py-1.5 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-0.5">
                  課題
                </label>
                <input
                  type="text"
                  placeholder="例: 生産ラインの老朽化"
                  value={dealInput.challenge}
                  onChange={(e) =>
                    setDealInput((p) => ({ ...p, challenge: e.target.value }))
                  }
                  className="w-full border border-border rounded px-2 py-1.5 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-0.5">
                  期限
                </label>
                <input
                  type="text"
                  placeholder="例: 6ヶ月以内"
                  value={dealInput.timeline}
                  onChange={(e) =>
                    setDealInput((p) => ({ ...p, timeline: e.target.value }))
                  }
                  className="w-full border border-border rounded px-2 py-1.5 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-0.5">
                詳細説明
              </label>
              <textarea
                placeholder="商談の背景、要件、特記事項など自由に記述..."
                value={dealInput.description}
                onChange={(e) =>
                  setDealInput((p) => ({ ...p, description: e.target.value }))
                }
                rows={2}
                className="w-full border border-border rounded px-2 py-1.5 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs flex gap-2 items-center">
          <span>⚠</span>
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            className="ml-auto text-xs underline"
          >
            閉じる
          </button>
        </div>
      )}

      {/* Chat area */}
      <Conversation>
        <ConversationContent autoScroll={true}>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Sparkles className="w-8 h-8 text-primary" />}
              title="SF Solution Q&A"
              description="商談データをもとにAIが課題分析・解決策提案・ツール推薦を行います"
            >
              {/* Sample deals */}
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-2">
                  サンプル商談で試す:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {SAMPLE_DEALS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => handleSampleDeal(s)}
                      className="text-left p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors"
                    >
                      <div className="text-sm font-medium text-foreground">
                        {s.label}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {s.deal.challenge}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <Suggestions>
                {SUGGESTIONS.map((s, i) => (
                  <Suggestion key={i} suggestion={s} onSelect={() => handleSubmit(s)} />
                ))}
              </Suggestions>
            </ConversationEmptyState>
          ) : (
            messages.map((msg) => (
              <MsgComponent key={msg.id} from={msg.role}>
                <MessageContent>
                  <MessageResponse>
                    {msg.content}
                    {msg.isStreaming && !msg.content && (
                      <StreamingIndicator />
                    )}
                  </MessageResponse>
                </MessageContent>
              </MsgComponent>
            ))
          )}
        </ConversationContent>
      </Conversation>

      {/* PPTX disclaimer */}
      {pptxDownloaded && (
        <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-800">
          <div className="max-w-4xl mx-auto flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400 mb-1">
                ご利用にあたってのお願い
              </h3>
              <p className="text-xs text-amber-600 dark:text-amber-400/80 leading-relaxed">
                ダウンロードされた提案書はAIが自動生成したものです。内容に誤りや事実と異なる情報が含まれている場合があります。ご利用前に内容をご確認いただき、必要に応じて修正・補足を行った上でご活用ください。
                <strong>不明点や確認したい点がございましたら、担当営業より直接ご連絡差し上げた際にお気軽にご質問ください。</strong>
              </p>
            </div>
            <button
              onClick={() => setPptxDownloaded(false)}
              className="text-amber-400 hover:text-amber-600 transition-colors"
              aria-label="閉じる"
            >
              <span className="text-lg leading-none">&times;</span>
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border px-4 py-3 bg-card/50">
        <div className="max-w-4xl mx-auto">
          <PromptInput
            onSubmit={() => handleSubmit()}
          >
            <PromptInputTextarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                dealInput.customerName
                  ? `${dealInput.customerName}について質問...`
                  : sfData
                    ? `${sfData.account?.Name || ""}について質問...`
                    : "商談について質問してください..."
              }
              disabled={isLoading}
            />
            <PromptInputFooter>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {sfData && (
                  <span className="flex items-center gap-1">
                    <Database className="w-3 h-3 text-green-500" />
                    SF接続中
                  </span>
                )}
                {dealInput.customerName && (
                  <span className="flex items-center gap-1">
                    <PenLine className="w-3 h-3 text-primary" />
                    {dealInput.customerName}
                  </span>
                )}
              </div>
              {isLoading ? (
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium hover:bg-destructive/90 transition-colors"
                >
                  <Square className="w-3 h-3" />
                  停止
                </button>
              ) : (
                <PromptInputSubmit
                  status="ready"
                  disabled={!question.trim()}
                />
              )}
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
