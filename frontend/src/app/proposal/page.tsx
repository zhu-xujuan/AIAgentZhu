"use client";

import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronLeft,
  Download,
  Loader2,
  RefreshCw,
  LogIn,
  BarChart3,
  FileText,
  PartyPopper,
  Lightbulb,
  Target,
  Puzzle,
  ClipboardList,
  MessageSquarePlus,
  Send,
  Pencil,
  AlertTriangle,
  Upload,
  CheckCircle2,
  X,
  Database,
  FileSpreadsheet,
  FormInput,
  Globe,
} from "lucide-react";
import type {
  DataSource,
  SFCredentials,
  KintoneCredentials,
  ManualDealInput,
  FileDealRecord,
  OpportunityListItem,
  ScenarioResult,
  AnalysisResult,
  SFData,
  AIProvider,
  Step,
} from "./types";
import {
  MOCK_OPPORTUNITIES,
  MOCK_SF_DATA_MAP,
  MOCK_FILE_DEALS,
  getMockAnalysis,
} from "./mock-data";
const AI_PROVIDERS: { id: AIProvider; label: string; placeholder: string }[] = [
  { id: "gemini", label: "Gemini", placeholder: "AIzaSy..." },
  { id: "claude", label: "Claude", placeholder: "sk-ant-..." },
  { id: "chatgpt", label: "ChatGPT", placeholder: "sk-..." },
];

const DATA_SOURCES: {
  id: DataSource;
  label: string;
  desc: string;
  icon: typeof Database;
}[] = [
  {
    id: "salesforce",
    label: "Salesforce",
    desc: "Salesforce CRMから商談データを取得",
    icon: Globe,
  },
  {
    id: "kintone",
    label: "Kintone",
    desc: "Kintoneアプリから案件データを取得",
    icon: Database,
  },
  {
    id: "file",
    label: "ファイル",
    desc: "Excel / CSV / TXT ファイルから読み込み",
    icon: FileSpreadsheet,
  },
  {
    id: "manual",
    label: "手動入力",
    desc: "商談情報を直接入力",
    icon: FormInput,
  },
];

const STEPS: { id: Step; label: string }[] = [
  { id: "source", label: "データソース" },
  { id: "select", label: "案件選択" },
  { id: "analyze", label: "分析" },
  { id: "generate", label: "提案書生成" },
];


function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-colors",
              i < idx
                ? "bg-green-500 text-white"
                : i === idx
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < idx ? <Check className="w-4 h-4" /> : i + 1}
          </div>
          <span
            className={cn(
              "text-sm font-medium",
              i === idx ? "text-primary" : "text-muted-foreground",
            )}
          >
            {step.label}
          </span>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                "w-8 h-0.5",
                i < idx ? "bg-green-400" : "bg-muted",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ScoreBar({
  value,
  max = 100,
  color,
}: {
  value: number;
  max?: number;
  color: string;
}) {
  return (
    <div className="w-full bg-muted rounded-full h-2.5">
      <div
        className={cn("h-2.5 rounded-full transition-all", color)}
        style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
      />
    </div>
  );
}

function ScenarioCard({
  scenario,
  variant,
}: {
  scenario: ScenarioResult;
  variant: "optimistic" | "base" | "pessimistic";
}) {
  const styles = {
    optimistic:
      "border-green-300 bg-green-50 text-green-800 dark:bg-green-950/30 dark:border-green-700 dark:text-green-300",
    base: "border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-300",
    pessimistic:
      "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30 dark:border-red-700 dark:text-red-300",
  };
  return (
    <div className={cn("border-2 rounded-xl p-4", styles[variant])}>
      <div className="font-bold text-lg mb-2">{scenario.label}</div>
      <div className="text-3xl font-extrabold mb-1">
        {Math.round(scenario.probability * 100)}%
      </div>
      <div className="text-sm opacity-60 mb-2">受注確率</div>
      <div className="text-xl font-bold mb-3">
        {scenario.expectedRevenue >= 10000
          ? `¥${(scenario.expectedRevenue / 10000).toFixed(0)}万`
          : `¥${scenario.expectedRevenue.toLocaleString()}`}
      </div>
      <div className="text-xs opacity-60 mb-3">⏱ {scenario.timeline}</div>
      <ul className="space-y-1">
        {scenario.conditions.slice(0, 3).map((c, i) => (
          <li key={i} className="text-xs flex gap-1">
            <span>•</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProposalPage() {
  const [step, setStep] = useState<Step>("source");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Data source
  const [dataSource, setDataSource] = useState<DataSource>("salesforce");

  // Salesforce
  const [creds, setCreds] = useState<SFCredentials>({
    username: "",
    password: "",
    securityToken: "",
    loginUrl: "https://login.salesforce.com",
  });

  // Kintone
  const [kintone, setKintone] = useState<KintoneCredentials>({
    subdomain: "",
    apiToken: "",
    appId: "",
  });
  const [kintoneEnvConfigured, setKintoneEnvConfigured] = useState(false);

  // File upload
  const [fileDeals, setFileDeals] = useState<FileDealRecord[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileParsing, setFileParsing] = useState(false);

  // Manual input
  const [manualDeal, setManualDeal] = useState<ManualDealInput>({
    companyName: "",
    industry: "",
    dealName: "",
    amount: "",
    stage: "提案中",
    closeDate: "",
    challenges: "",
    description: "",
    contactName: "",
    contactRole: "",
  });

  // AI
  const [aiProvider, setAiProvider] = useState<AIProvider>("gemini");

  // Shared state
  const [opportunities, setOpportunities] = useState<OpportunityListItem[]>([]);
  const [sfObjectType, setSfObjectType] = useState("Opportunity");
  const [selectedOppId, setSelectedOppId] = useState("");
  const [sfData, setSfData] = useState<SFData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [revising, setRevising] = useState(false);

  // Template coverage check
  interface MissingService {
    service: string;
    hasTemplate: boolean;
    uploading: boolean;
    uploaded: boolean;
  }
  const [showTemplateCheck, setShowTemplateCheck] = useState(false);
  const [missingServices, setMissingServices] = useState<MissingService[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Load Kintone env config on mount
  useEffect(() => {
    fetch("/api/proposal/kintone-data")
      .then((res) => res.json())
      .then((cfg) => {
        if (cfg.configured) {
          setKintoneEnvConfigured(true);
          setKintone((prev) => ({
            subdomain: prev.subdomain || cfg.subdomain || "",
            apiToken: prev.apiToken || "(環境変数から設定済み)",
            appId: prev.appId || cfg.appId || "",
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Refresh data from Salesforce or Kintone (re-fetch latest)
  const handleRefreshData = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      if (dataSource === "salesforce" && selectedOppId) {
        const sfRes = await fetch("/api/proposal/sf-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "fetch",
            credentials: creds,
            opportunityId: selectedOppId,
            objectType: sfObjectType,
          }),
        });
        const sfJson = await sfRes.json();
        if (!sfRes.ok) throw new Error(sfJson.error || "データ再取得失敗");
        setSfData(sfJson.data);
        try {
          localStorage.setItem("sf_proposal_data", JSON.stringify(sfJson.data));
        } catch {}
      } else if (dataSource === "kintone" && selectedOppId) {
        const credentials = kintoneEnvConfigured
          ? undefined
          : { subdomain: kintone.subdomain, apiToken: kintone.apiToken, appId: kintone.appId };
        const res = await fetch("/api/proposal/kintone-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "fetch", credentials, recordId: selectedOppId }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Kintoneレコード再取得失敗");
        setSfData(json.data);
        try {
          localStorage.setItem("sf_proposal_data", JSON.stringify(json.data));
        } catch {}
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "データ再取得失敗");
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, dataSource, selectedOppId, creds, sfObjectType, kintone, kintoneEnvConfigured]);

  const handleReviseRationale = useCallback(async () => {
    if (!analysis?.rationale || !feedback.trim()) return;
    setRevising(true);
    setError("");
    try {
      const res = await fetch("/api/proposal/revise-rationale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentAnalysis: analysis,
          feedback: feedback.trim(),
          aiProvider,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "修正失敗");
      setAnalysis((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, rationale: json.rationale };
        if (json.analysisUpdates) {
          const u = json.analysisUpdates;
          if (u.winProbability != null) updated.winProbability = u.winProbability;
          if (u.dealHealthScore != null) updated.dealHealthScore = u.dealHealthScore;
          if (u.activityScore != null) updated.activityScore = u.activityScore;
          if (u.engagementLevel != null) updated.engagementLevel = u.engagementLevel;
          if (u.proposalReadiness != null) updated.proposalReadiness = u.proposalReadiness;
          if (u.keyDrivers) updated.keyDrivers = u.keyDrivers;
          if (u.riskFactors) updated.riskFactors = u.riskFactors;
          if (u.recommendedActions) updated.recommendedActions = u.recommendedActions;
          if (u.scenarios) updated.scenarios = u.scenarios;
        }
        return updated;
      });
      setFeedback("");
      setShowFeedback(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "修正失敗");
    } finally {
      setRevising(false);
    }
  }, [analysis, feedback, aiProvider]);

  // --- Salesforce flow ---
  const handleFetchOpportunities = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      // --- MOCK: Salesforce商談一覧をダミーデータで返す ---
      await new Promise((r) => setTimeout(r, 500));
      setOpportunities(MOCK_OPPORTUNITIES);
      setSfObjectType("Opportunity");
      setStep("select");
      // --- END MOCK ---

      /* --- ORIGINAL: 本番接続時はこちらを使用 ---
      const res = await fetch("/api/proposal/sf-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", credentials: creds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "接続失敗");
      setOpportunities(json.opportunities);
      setSfObjectType(json.objectType || "Opportunity");
      setStep("select");
      --- END ORIGINAL --- */
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "接続失敗");
    } finally {
      setLoading(false);
    }
  }, [creds]);

  const handleFetchAndAnalyze = useCallback(async () => {
    if (!selectedOppId) {
      setError("商談を選択してください");
      return;
    }
    setError("");
    setLoading(true);
    try {
      // --- MOCK: ダミーデータで商談詳細＋分析結果を返す ---
      await new Promise((r) => setTimeout(r, 800));
      const mockData = MOCK_SF_DATA_MAP[selectedOppId] || Object.values(MOCK_SF_DATA_MAP)[0];
      setSfData(mockData);
      try {
        localStorage.setItem("sf_proposal_data", JSON.stringify(mockData));
      } catch { /* ignore */ }
      setAnalysis(getMockAnalysis(selectedOppId, mockData));
      setStep("analyze");
      // --- END MOCK ---

      /* --- ORIGINAL: 本番接続時はこちらを使用 ---
      const sfRes = await fetch("/api/proposal/sf-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fetch",
          credentials: creds,
          opportunityId: selectedOppId,
          objectType: sfObjectType,
        }),
      });
      const sfJson = await sfRes.json();
      if (!sfRes.ok) throw new Error(sfJson.error || "データ取得失敗");
      setSfData(sfJson.data);
      try {
        localStorage.setItem("sf_proposal_data", JSON.stringify(sfJson.data));
      } catch {}

      const anaRes = await fetch("/api/proposal/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: sfJson.data,
          aiProvider,
          aiApiKey: undefined,
        }),
      });
      const anaJson = await anaRes.json();
      if (!anaRes.ok) throw new Error(anaJson.error || "分析失敗");
      setAnalysis(anaJson.analysis);
      setStep("analyze");
      --- END ORIGINAL --- */
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "データ取得失敗");
    } finally {
      setLoading(false);
    }
  }, [creds, selectedOppId, sfObjectType, aiProvider]);

  // --- File upload flow ---
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileParsing(true);
      setError("");
      try {
        // --- MOCK: ファイル解析をダミーデータで返す ---
        await new Promise((r) => setTimeout(r, 600));
        setFileDeals(MOCK_FILE_DEALS);
        setFileName(file.name);
        setStep("select");
        // --- END MOCK ---

        /* --- ORIGINAL: 本番接続時はこちらを使用 ---
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/proposal/parse-file", {
          method: "POST",
          body: formData,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "解析失敗");
        setFileDeals(json.deals || []);
        setFileName(json.fileName || file.name);
        if (json.deals && json.deals.length > 0) {
          if (json.deals.length === 1) {
            await analyzeFromDeal(json.deals[0]);
          } else {
            setStep("select");
          }
        } else {
          setError("ファイルから案件データを抽出できませんでした");
        }
        --- END ORIGINAL --- */
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "ファイル解析失敗");
      } finally {
        setFileParsing(false);
        e.target.value = "";
      }
    },
    [aiProvider],
  );

  // --- Manual input flow ---
  const handleManualSubmit = useCallback(async () => {
    if (!manualDeal.companyName && !manualDeal.dealName) {
      setError("会社名または案件名を入力してください");
      return;
    }
    const deal: FileDealRecord = {
      companyName: manualDeal.companyName,
      dealName: manualDeal.dealName,
      amount: parseFloat(manualDeal.amount) || 0,
      stage: manualDeal.stage,
      closeDate: manualDeal.closeDate,
      industry: manualDeal.industry,
      description: [manualDeal.challenges, manualDeal.description]
        .filter(Boolean)
        .join("\n"),
      contacts: [manualDeal.contactName, manualDeal.contactRole]
        .filter(Boolean)
        .join(" / "),
    };
    await analyzeFromDeal(deal);
  }, [manualDeal, aiProvider]);

  // --- Kintone flow ---
  const handleKintoneConnect = useCallback(async () => {
    if (!kintoneEnvConfigured && (!kintone.subdomain || !kintone.apiToken || !kintone.appId)) {
      setError("Kintoneのサブドメイン、APIトークン、アプリIDを入力してください");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const credentials = kintoneEnvConfigured
        ? undefined
        : { subdomain: kintone.subdomain, apiToken: kintone.apiToken, appId: kintone.appId };
      const res = await fetch("/api/proposal/kintone-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", credentials }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Kintone接続失敗");
      setOpportunities(json.opportunities);
      setStep("select");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Kintone接続失敗");
    } finally {
      setLoading(false);
    }
  }, [kintone, kintoneEnvConfigured]);

  // --- Kintone: select and analyze ---
  const handleKintoneAnalyze = useCallback(async () => {
    if (!selectedOppId) {
      setError("案件を選択してください");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const credentials = kintoneEnvConfigured
        ? undefined
        : { subdomain: kintone.subdomain, apiToken: kintone.apiToken, appId: kintone.appId };
      const res = await fetch("/api/proposal/kintone-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch", credentials, recordId: selectedOppId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "レコード取得失敗");
      const data = json.data;
      setSfData(data);
      try {
        localStorage.setItem("sf_proposal_data", JSON.stringify(data));
      } catch { /* ignore */ }

      const anaRes = await fetch("/api/proposal/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, aiProvider }),
      });
      const anaJson = await anaRes.json();
      if (!anaRes.ok) throw new Error(anaJson.error || "分析失敗");
      setAnalysis(anaJson.analysis);
      setStep("analyze");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "データ取得失敗");
    } finally {
      setLoading(false);
    }
  }, [kintone, kintoneEnvConfigured, selectedOppId, aiProvider]);

  // --- Common: analyze from a deal record (file/manual) ---
  const analyzeFromDeal = useCallback(
    async (deal: FileDealRecord) => {
      setError("");
      setLoading(true);
      try {
        const data: SFData = {
          account: {
            Name: deal.companyName || "不明",
            Industry: deal.industry || "",
          },
          opportunity: {
            Name: deal.dealName || "案件",
            Amount: deal.amount,
            StageName: deal.stage,
            CloseDate: deal.closeDate,
            Description: deal.description,
          },
          activities: [],
          contacts: deal.contacts ? [{ Name: deal.contacts }] : [],
        };
        setSfData(data);
        try {
          localStorage.setItem("sf_proposal_data", JSON.stringify(data));
        } catch { /* ignore */ }

        // --- MOCK: 分析結果をダミーデータで返す ---
        await new Promise((r) => setTimeout(r, 800));
        setAnalysis(getMockAnalysis("", data));
        setStep("analyze");
        // --- END MOCK ---

        /* --- ORIGINAL: 本番接続時はこちらを使用 ---
        const anaRes = await fetch("/api/proposal/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data,
            aiProvider,
            aiApiKey: undefined,
          }),
        });
        const anaJson = await anaRes.json();
        if (!anaRes.ok) throw new Error(anaJson.error || "分析失敗");
        setAnalysis(anaJson.analysis);
        setStep("analyze");
        --- END ORIGINAL --- */
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "分析失敗");
      } finally {
        setLoading(false);
      }
    },
    [aiProvider],
  );

  // --- File deal selection ---
  const handleFileSelectAndAnalyze = useCallback(async () => {
    if (!selectedOppId) {
      setError("案件を選択してください");
      return;
    }
    const deal = fileDeals[parseInt(selectedOppId)];
    if (!deal) return;
    await analyzeFromDeal(deal);
  }, [selectedOppId, fileDeals, analyzeFromDeal]);

  // Check template coverage before generating
  const handlePreGenerate = useCallback(async () => {
    if (!sfData || !analysis?.rationale) return;
    setError("");

    const recommendedServices =
      analysis.rationale.serviceRecommendations.map((r) => r.service);
    if (recommendedServices.length === 0) {
      doGenerate();
      return;
    }

    try {
      const res = await fetch("/api/proposal/templates");
      const json = await res.json();
      const templateServiceNames: string[] = (json.templates || [])
        .map((t: { serviceName: string }) => t.serviceName)
        .filter(Boolean);

      const missing: MissingService[] = recommendedServices.map((svc) => {
        const hasTemplate = templateServiceNames.some(
          (tsn) => tsn === svc || tsn.includes(svc) || svc.includes(tsn),
        );
        return { service: svc, hasTemplate, uploading: false, uploaded: false };
      });

      const hasMissing = missing.some((m) => !m.hasTemplate);
      if (hasMissing) {
        setMissingServices(missing);
        setShowTemplateCheck(true);
      } else {
        doGenerate();
      }
    } catch {
      doGenerate();
    }
  }, [sfData, analysis]);

  const handleTemplateUploadForService = useCallback(
    async (serviceIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setMissingServices((prev) =>
        prev.map((m, i) =>
          i === serviceIndex ? { ...m, uploading: true } : m,
        ),
      );

      try {
        const serviceName = missingServices[serviceIndex]?.service || "";
        const formData = new FormData();
        Array.from(files).forEach((f) => formData.append("files", f));
        formData.append("serviceName", serviceName);
        const res = await fetch("/api/proposal/templates", {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          setMissingServices((prev) =>
            prev.map((m, i) =>
              i === serviceIndex
                ? { ...m, uploading: false, uploaded: true, hasTemplate: true }
                : m,
            ),
          );
        }
      } catch {
        /* ignore */
      }

      setMissingServices((prev) =>
        prev.map((m, i) =>
          i === serviceIndex ? { ...m, uploading: false } : m,
        ),
      );
      e.target.value = "";
    },
    [missingServices],
  );

  const doGenerate = useCallback(async () => {
    if (!sfData || !analysis) return;
    setShowTemplateCheck(false);
    setError("");
    setGenerating(true);
    try {
      const res = await fetch("/api/proposal/generate-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: sfData,
          analysis,
          aiProvider,
          aiApiKey: undefined,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "生成失敗");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = sfData
        ? `提案書_${sfData.account.Name}_${sfData.opportunity.Name}.pptx`
        : "提案書.pptx";
      a.click();
      URL.revokeObjectURL(url);
      setStep("generate");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "生成失敗");
    } finally {
      setGenerating(false);
    }
  }, [sfData, analysis, aiProvider]);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">SalesAssist</h1>
        <p className="text-sm text-muted-foreground mt-1">
          多様なデータソース × AI で商談提案書を自動生成
        </p>
      </div>

      <StepIndicator current={step} />

      {error && (
        <div className="mb-6 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-4 py-3 text-sm flex gap-2 items-start">
          <span className="shrink-0">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: Data Source Selection */}
      {step === "source" && (
        <div className="space-y-6">
          {/* Data Source Cards */}
          <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
            <h2 className="text-xl font-bold text-foreground mb-4">
              データソースを選択
            </h2>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {DATA_SOURCES.map((src) => {
                const Icon = src.icon;
                return (
                  <button
                    key={src.id}
                    onClick={() => setDataSource(src.id)}
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all",
                      dataSource === src.id
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div
                      className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                        dataSource === src.id
                          ? "bg-primary/15"
                          : "bg-muted",
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-5 h-5",
                          dataSource === src.id
                            ? "text-primary"
                            : "text-muted-foreground",
                        )}
                      />
                    </div>
                    <div>
                      <div
                        className={cn(
                          "font-bold text-sm",
                          dataSource === src.id
                            ? "text-primary"
                            : "text-foreground",
                        )}
                      >
                        {src.label}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {src.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* AI Provider (common to all sources) */}
            <div className="border-t border-border pt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  AI プロバイダー
                </label>
                <div className="flex gap-2">
                  {AI_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setAiProvider(p.id)}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors",
                        aiProvider === p.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Source-specific forms */}
          {dataSource === "salesforce" && (
            <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
              <h2 className="text-lg font-bold text-foreground mb-4">
                Salesforce 認証情報
              </h2>
              <div className="grid grid-cols-1 gap-4">
                {(
                  [
                    {
                      label: "ユーザー名（メールアドレス）",
                      key: "username",
                      type: "email",
                      placeholder: "you@company.com",
                    },
                    {
                      label: "パスワード",
                      key: "password",
                      type: "password",
                      placeholder: "••••••••",
                    },
                    {
                      label: "セキュリティトークン（任意）",
                      key: "securityToken",
                      type: "password",
                      placeholder: "未設定でもログイン可能",
                    },
                  ] as const
                ).map((f) => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">
                      {f.label}
                    </label>
                    <input
                      type={f.type}
                      placeholder={f.placeholder}
                      value={creds[f.key]}
                      onChange={(e) =>
                        setCreds((p) => ({ ...p, [f.key]: e.target.value }))
                      }
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    ログインURL{" "}
                    <span className="opacity-60">
                      （Sandbox: test.salesforce.com）
                    </span>
                  </label>
                  <input
                    type="text"
                    value={creds.loginUrl}
                    onChange={(e) =>
                      setCreds((p) => ({ ...p, loginUrl: e.target.value }))
                    }
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>
              <button
                onClick={handleFetchOpportunities}
                disabled={loading || !creds.username || !creds.password}
                className={cn(
                  "mt-6 w-full font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2",
                  "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    接続中...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Salesforceに接続して商談一覧を取得
                  </>
                )}
              </button>
            </div>
          )}

          {dataSource === "kintone" && (
            <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
              <h2 className="text-lg font-bold text-foreground mb-4">
                Kintone 接続情報
              </h2>
              {kintoneEnvConfigured && (
                <div className="flex items-center gap-2 mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  環境変数から接続情報が設定されています（{kintone.subdomain}.cybozu.com / アプリID: {kintone.appId}）
                </div>
              )}
              {!kintoneEnvConfigured && (
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">
                      サブドメイン{" "}
                      <span className="opacity-60">
                        （例: mycompany → mycompany.cybozu.com）
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="mycompany"
                      value={kintone.subdomain}
                      onChange={(e) =>
                        setKintone((p) => ({
                          ...p,
                          subdomain: e.target.value,
                        }))
                      }
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">
                      APIトークン
                    </label>
                    <input
                      type="password"
                      placeholder="xxxxxxxxxxxxxx"
                      value={kintone.apiToken}
                      onChange={(e) =>
                        setKintone((p) => ({
                          ...p,
                          apiToken: e.target.value,
                        }))
                      }
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">
                      アプリID{" "}
                      <span className="opacity-60">
                        （案件管理アプリのID）
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="123"
                      value={kintone.appId}
                      onChange={(e) =>
                        setKintone((p) => ({ ...p, appId: e.target.value }))
                      }
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                </div>
              )}
              <button
                onClick={handleKintoneConnect}
                disabled={
                  loading ||
                  (!kintoneEnvConfigured &&
                    (!kintone.subdomain ||
                      !kintone.apiToken ||
                      !kintone.appId))
                }
                className={cn(
                  "mt-6 w-full font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2",
                  "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    接続中...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Kintoneに接続して案件一覧を取得
                  </>
                )}
              </button>
            </div>
          )}

          {dataSource === "file" && (
            <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
              <h2 className="text-lg font-bold text-foreground mb-2">
                ファイルから案件データを読み込み
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                Excel (.xlsx), CSV, TXT ファイルをアップロードしてください。
                ヘッダー行に「会社名」「案件名」「金額」等があると自動マッピングされます。
              </p>
              <label
                className={cn(
                  "flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors",
                  fileParsing
                    ? "border-primary/40 bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-primary/5",
                )}
              >
                {fileParsing ? (
                  <>
                    <Loader2 className="w-8 h-8 text-primary animate-spin mb-2" />
                    <span className="text-sm font-medium text-primary">
                      ファイルを解析中...
                    </span>
                  </>
                ) : fileName ? (
                  <>
                    <CheckCircle2 className="w-8 h-8 text-green-500 mb-2" />
                    <span className="text-sm font-medium text-foreground">
                      {fileName} ({fileDeals.length}件の案件)
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">
                      別のファイルを選択するにはクリック
                    </span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-8 h-8 text-muted-foreground mb-2" />
                    <span className="text-sm font-medium text-foreground">
                      ファイルを選択またはドラッグ＆ドロップ
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">
                      .xlsx, .csv, .txt をサポート
                    </span>
                  </>
                )}
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv,.txt,.md"
                  onChange={handleFileUpload}
                  disabled={fileParsing}
                />
              </label>
            </div>
          )}

          {dataSource === "manual" && (
            <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
              <h2 className="text-lg font-bold text-foreground mb-4">
                商談情報を入力
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {(
                  [
                    {
                      label: "会社名",
                      key: "companyName",
                      placeholder: "株式会社○○",
                      full: false,
                    },
                    {
                      label: "業種",
                      key: "industry",
                      placeholder: "製造業、IT、小売 等",
                      full: false,
                    },
                    {
                      label: "案件名",
                      key: "dealName",
                      placeholder: "DX推進プロジェクト",
                      full: true,
                    },
                    {
                      label: "金額（円）",
                      key: "amount",
                      placeholder: "5000000",
                      full: false,
                    },
                    {
                      label: "ステージ",
                      key: "stage",
                      placeholder: "提案中 / 見積もり / 交渉中",
                      full: false,
                    },
                    {
                      label: "完了予定日",
                      key: "closeDate",
                      placeholder: "2026-06-30",
                      full: false,
                    },
                    {
                      label: "担当者名",
                      key: "contactName",
                      placeholder: "田中太郎",
                      full: false,
                    },
                    {
                      label: "担当者の役職",
                      key: "contactRole",
                      placeholder: "DX推進部長",
                      full: false,
                    },
                  ] as const
                ).map((f) => (
                  <div
                    key={f.key}
                    className={f.full ? "col-span-2" : ""}
                  >
                    <label className="block text-sm font-medium text-muted-foreground mb-1">
                      {f.label}
                    </label>
                    <input
                      type="text"
                      placeholder={f.placeholder}
                      value={manualDeal[f.key]}
                      onChange={(e) =>
                        setManualDeal((p) => ({
                          ...p,
                          [f.key]: e.target.value,
                        }))
                      }
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    顧客の課題・要望
                  </label>
                  <textarea
                    placeholder="現在の業務プロセスに非効率な部分があり、DXによる改善を検討中..."
                    value={manualDeal.challenges}
                    onChange={(e) =>
                      setManualDeal((p) => ({
                        ...p,
                        challenges: e.target.value,
                      }))
                    }
                    rows={3}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    備考・補足情報
                  </label>
                  <textarea
                    placeholder="過去の取引実績、競合情報、予算制約など"
                    value={manualDeal.description}
                    onChange={(e) =>
                      setManualDeal((p) => ({
                        ...p,
                        description: e.target.value,
                      }))
                    }
                    rows={2}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  />
                </div>
              </div>
              <button
                onClick={handleManualSubmit}
                disabled={
                  loading ||
                  (!manualDeal.companyName && !manualDeal.dealName)
                }
                className={cn(
                  "mt-6 w-full font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2",
                  "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    AI分析中...
                  </>
                ) : (
                  <>
                    <BarChart3 className="w-4 h-4" />
                    入力内容でAI分析を開始
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Select Deal */}
      {step === "select" && (
        <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
          <h2 className="text-xl font-bold text-foreground mb-2">
            {dataSource === "salesforce"
              ? sfObjectType === "Opportunity"
                ? "商談"
                : sfObjectType === "Lead"
                  ? "リード"
                  : "アカウント"
              : dataSource === "kintone"
                ? "案件"
                : "案件"}
            を選択
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            {dataSource === "salesforce" && sfObjectType !== "Opportunity" && (
              <span className="text-amber-500 mr-2">
                Opportunity未対応のため{sfObjectType}を使用
              </span>
            )}
            {dataSource === "file" && (
              <span>
                {fileName} から {fileDeals.length} 件の案件を検出
              </span>
            )}
            {(dataSource === "salesforce" || dataSource === "kintone") && (
              <span>最新50件</span>
            )}
          </p>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
            {dataSource === "file"
              ? fileDeals.map((deal, i) => (
                  <label
                    key={i}
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors",
                      selectedOppId === String(i)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="deal"
                      value={i}
                      checked={selectedOppId === String(i)}
                      onChange={() => setSelectedOppId(String(i))}
                      className="mt-1 accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground truncate">
                        {deal.dealName || `案件 ${i + 1}`}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {deal.companyName}
                      </div>
                      <div className="flex gap-3 mt-1 text-xs">
                        {deal.stage && (
                          <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                            {deal.stage}
                          </span>
                        )}
                        {deal.amount > 0 && (
                          <span className="text-muted-foreground">
                            {deal.amount >= 10000
                              ? `¥${(deal.amount / 10000).toFixed(0)}万`
                              : `¥${deal.amount.toLocaleString()}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))
              : opportunities.map((opp) => (
                  <label
                    key={opp.Id}
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors",
                      selectedOppId === opp.Id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="opp"
                      value={opp.Id}
                      checked={selectedOppId === opp.Id}
                      onChange={() => setSelectedOppId(opp.Id)}
                      className="mt-1 accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground truncate">
                        {opp.Name}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {opp.AccountName}
                      </div>
                      <div className="flex gap-3 mt-1 text-xs">
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          {opp.StageName}
                        </span>
                        <span className="text-muted-foreground">
                          {opp.Amount >= 10000
                            ? `¥${(opp.Amount / 10000).toFixed(0)}万`
                            : `¥${opp.Amount?.toLocaleString()}`}
                        </span>
                        {opp.CloseDate && (
                          <span className="text-muted-foreground/60">
                            クローズ: {opp.CloseDate}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
          </div>
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => {
                setStep("source");
                setSelectedOppId("");
              }}
              className="flex-1 border border-border text-muted-foreground font-bold py-3 rounded-xl hover:bg-accent transition-colors flex items-center justify-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              戻る
            </button>
            <button
              onClick={
                dataSource === "salesforce"
                  ? handleFetchAndAnalyze
                  : dataSource === "kintone"
                    ? handleKintoneAnalyze
                    : handleFileSelectAndAnalyze
              }
              disabled={loading || !selectedOppId}
              className={cn(
                "flex-[2] font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2",
                "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  データ取得・分析中...
                </>
              ) : (
                <>
                  <BarChart3 className="w-4 h-4" />
                  選択して分析を開始
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Analysis Results */}
      {step === "analyze" && analysis && sfData && (
        <div>
          {/* Rationale Section (above analysis) */}
          {analysis.rationale && (
            <div className="bg-card border border-border rounded-2xl shadow-sm p-8 mb-6">
              <h2 className="text-xl font-bold text-foreground mb-1 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-500" />
                分析根拠
              </h2>
              <p className="text-sm text-muted-foreground mb-5 flex items-center gap-2">
                <span>{sfData.account.Name} / {sfData.opportunity.Name} — AI分析による提案根拠</span>
                {(dataSource === "salesforce" || dataSource === "kintone") && (
                  <button
                    onClick={handleRefreshData}
                    disabled={refreshing}
                    title="最新データを再取得"
                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
                  </button>
                )}
              </p>

              {/* Proposal Readiness Score */}
              <div className="bg-muted/50 rounded-xl p-4 border border-border mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    提案準備スコア
                  </span>
                  <span
                    className={cn(
                      "text-2xl font-extrabold",
                      analysis.proposalReadiness >= 70
                        ? "text-green-600"
                        : analysis.proposalReadiness >= 40
                          ? "text-amber-500"
                          : "text-red-500",
                    )}
                  >
                    {analysis.proposalReadiness}/100
                  </span>
                </div>
                <ScoreBar
                  value={analysis.proposalReadiness}
                  color={
                    analysis.proposalReadiness >= 70
                      ? "bg-green-500"
                      : analysis.proposalReadiness >= 40
                        ? "bg-amber-500"
                        : "bg-red-500"
                  }
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  {analysis.proposalReadiness >= 70
                    ? "提案書作成に十分なデータが揃っています"
                    : analysis.proposalReadiness >= 40
                      ? "基本情報はありますが、追加情報で提案の精度が向上します"
                      : "データ不足のため、追加情報の取得を推奨します"}
                </p>
              </div>

              {/* Customer Challenges */}
              <div className="mb-5">
                <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                  <Target className="w-4 h-4 text-red-500" />
                  顧客の課題
                </h3>
                <ul className="space-y-1.5">
                  {analysis.rationale.customerChallenges.map((c, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2"
                    >
                      <span className="text-red-400 shrink-0 font-bold">
                        {i + 1}.
                      </span>
                      <span className="text-foreground">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Service Recommendations */}
              <div className="mb-5">
                <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                  <Puzzle className="w-4 h-4 text-primary" />
                  推薦サービス
                </h3>
                <div className="space-y-3">
                  {analysis.rationale.serviceRecommendations.map((rec, i) => (
                    <div
                      key={i}
                      className="border border-border rounded-xl p-4 bg-muted/30"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="font-bold text-foreground">
                          {rec.service}
                        </span>
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-medium",
                            rec.relevance === "primary"
                              ? "bg-primary/15 text-primary"
                              : rec.relevance === "secondary"
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {rec.relevance === "primary"
                            ? "主要"
                            : rec.relevance === "secondary"
                              ? "補助"
                              : "任意"}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {rec.reason}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {rec.features.map((f, j) => (
                          <span
                            key={j}
                            className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Combined Solution */}
              {analysis.rationale.combinedSolution && (
                <div className="mb-5">
                  <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                    <Puzzle className="w-4 h-4 text-teal-500" />
                    総合ソリューション
                  </h3>
                  <div className="bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 rounded-xl px-4 py-3 text-sm text-foreground">
                    {analysis.rationale.combinedSolution}
                  </div>
                </div>
              )}

              {/* Proposal Hints */}
              {analysis.rationale.existingProposalHints.length > 0 && (
                <div className="mb-5">
                  <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-amber-500" />
                    提案書に含めるべきポイント
                  </h3>
                  <ul className="space-y-1.5">
                    {analysis.rationale.existingProposalHints.map((h, i) => (
                      <li
                        key={i}
                        className="flex gap-2 text-sm bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-1.5"
                      >
                        <span className="text-amber-500 shrink-0">✓</span>
                        <span className="text-foreground">{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Feedback / Revision Section */}
              <div className="border-t border-border pt-5">
                {!showFeedback ? (
                  <button
                    onClick={() => setShowFeedback(true)}
                    className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    分析根拠を修正・補足する
                  </button>
                ) : (
                  <div>
                    <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                      <MessageSquarePlus className="w-4 h-4 text-primary" />
                      修正・補足フィードバック
                    </h3>
                    <p className="text-xs text-muted-foreground mb-2">
                      誤りの指摘、補足情報、削除依頼などを記入してください。AIが内容を修正します。
                    </p>
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder='例: 「顧客の課題に「社内文書の検索効率が低い」を追加してください」「書きあげクンは不要です、削除してください」「予算は500万円です」'
                      rows={3}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={handleReviseRationale}
                        disabled={revising || !feedback.trim()}
                        className={cn(
                          "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors",
                          "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
                        )}
                      >
                        {revising ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />{" "}
                            AIで修正中...
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" /> AIで根拠を修正
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setShowFeedback(false);
                          setFeedback("");
                        }}
                        className="px-4 py-2.5 border border-border text-muted-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
            <h2 className="text-xl font-bold text-foreground mb-1">
              分析結果
            </h2>
            <p className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
              <span>{sfData.account.Name} / {sfData.opportunity.Name}</span>
              {(dataSource === "salesforce" || dataSource === "kintone") && (
                <button
                  onClick={handleRefreshData}
                  disabled={refreshing}
                  title="最新データを再取得"
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
                </button>
              )}
            </p>

            {/* KPI Cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                {
                  label: "受注確率",
                  value: `${analysis.winProbability}%`,
                  color:
                    analysis.winProbability >= 60
                      ? "text-green-600"
                      : analysis.winProbability >= 40
                        ? "text-amber-500"
                        : "text-red-500",
                  bar: "bg-blue-500",
                },
                {
                  label: "ディールスコア",
                  value: `${analysis.dealHealthScore}/100`,
                  color: "text-blue-600",
                  bar: "bg-blue-400",
                },
                {
                  label: "エンゲージメント",
                  value: analysis.engagementLevel,
                  color: "text-teal-600",
                  bar: "bg-teal-400",
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="bg-muted/50 rounded-xl p-4 border border-border"
                >
                  <div className={cn("text-2xl font-extrabold", c.color)}>
                    {c.value}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 mb-2">
                    {c.label}
                  </div>
                  <ScoreBar value={parseInt(c.value) || 0} color={c.bar} />
                </div>
              ))}
            </div>

            {/* Scenario Simulation */}
            <h3 className="font-bold text-foreground mb-3">
              シナリオシミュレーション
            </h3>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <ScenarioCard
                scenario={analysis.scenarios.optimistic}
                variant="optimistic"
              />
              <ScenarioCard
                scenario={analysis.scenarios.base}
                variant="base"
              />
              <ScenarioCard
                scenario={analysis.scenarios.pessimistic}
                variant="pessimistic"
              />
            </div>

            {/* Drivers & Risks */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="font-bold text-foreground mb-2">
                  キードライバー
                </h3>
                <ul className="space-y-1.5">
                  {analysis.keyDrivers.map((d, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm bg-green-50 dark:bg-green-950/30 rounded-lg px-3 py-1.5"
                    >
                      <span className="text-green-500 shrink-0">▸</span>
                      <span className="text-foreground">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-2">
                  リスクファクター
                </h3>
                <ul className="space-y-1.5">
                  {analysis.riskFactors.map((r, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-1.5"
                    >
                      <span className="text-red-400 shrink-0">▸</span>
                      <span className="text-foreground">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Recommended Actions */}
            <h3 className="font-bold text-foreground mt-5 mb-2">
              推奨アクション
            </h3>
            <ol className="space-y-2">
              {analysis.recommendedActions.map((a, i) => (
                <li
                  key={i}
                  className="flex gap-3 text-sm bg-primary/5 rounded-lg px-3 py-2"
                >
                  <span className="font-bold text-primary w-5 shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-foreground">{a}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Action Buttons (inline at bottom) */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={() =>
                setStep(
                  dataSource === "file" && fileDeals.length > 1
                    ? "select"
                    : "source",
                )
              }
              className="flex-1 border border-border text-muted-foreground font-bold py-3 rounded-xl hover:bg-accent transition-colors flex items-center justify-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              戻る
            </button>
            <button
              onClick={handlePreGenerate}
              disabled={generating}
              className={cn(
                "flex-[2] font-bold py-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2",
                "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AIで提案書を生成中...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  PPTX提案書を生成・ダウンロード
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Template Coverage Check Dialog */}
      {showTemplateCheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-foreground">
                  提案書テンプレートの確認
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  推薦サービスの既存提案書テンプレートを確認しました。
                </p>
              </div>
              <button
                onClick={() => setShowTemplateCheck(false)}
                className="ml-auto p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 mb-5">
              {missingServices.map((svc, i) => (
                <div
                  key={i}
                  className={cn(
                    "border rounded-xl p-4",
                    svc.hasTemplate
                      ? "border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800"
                      : "border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800",
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {svc.hasTemplate ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                    <span className="font-bold text-foreground text-sm">
                      {svc.service}
                    </span>
                    {svc.hasTemplate ? (
                      <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">
                        テンプレートあり
                      </span>
                    ) : svc.uploaded ? (
                      <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">
                        アップロード済み
                      </span>
                    ) : (
                      <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded-full">
                        テンプレートなし
                      </span>
                    )}
                  </div>

                  {!svc.hasTemplate && !svc.uploaded && (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground mb-2">
                        「{svc.service}
                        」の既存提案書がありません。アップロードするか、AIに新規設計を任せてください。
                      </p>
                      <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-xs font-medium hover:bg-primary/20 transition-colors">
                        {svc.uploading ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />{" "}
                            アップロード中...
                          </>
                        ) : (
                          <>
                            <Upload className="w-3 h-3" />{" "}
                            提案書をアップロード
                          </>
                        )}
                        <input
                          type="file"
                          className="hidden"
                          accept=".txt,.md,.pdf,.pptx,.docx,.csv,.json"
                          multiple
                          onChange={(e) =>
                            handleTemplateUploadForService(i, e)
                          }
                          disabled={svc.uploading}
                        />
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {missingServices.some((s) => !s.hasTemplate && !s.uploaded) && (
              <div className="bg-muted/50 border border-border rounded-lg p-3 mb-4">
                <p className="text-sm text-foreground">
                  テンプレートがないサービスについては、
                  <span className="font-bold text-primary">
                    AIが新規に提案内容を設計
                  </span>
                  します。
                  既存の提案書をアップロードすると、その内容を参考により精度の高い提案書が作成されます。
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={doGenerate}
                disabled={generating}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-colors",
                  "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
                )}
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> 生成中...
                  </>
                ) : missingServices.every(
                    (s) => s.hasTemplate || s.uploaded,
                  ) ? (
                  <>
                    <Download className="w-4 h-4" />{" "}
                    全テンプレートで提案書を生成
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />{" "}
                    AIで新規設計して提案書を生成
                  </>
                )}
              </button>
              <button
                onClick={() => setShowTemplateCheck(false)}
                className="px-4 py-3 border border-border text-muted-foreground rounded-xl text-sm font-medium hover:bg-accent transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === "generate" && (
        <div className="bg-card border border-border rounded-2xl shadow-sm p-10 text-center">
          <PartyPopper className="w-16 h-16 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-extrabold text-foreground mb-2">
            提案書の生成が完了しました
          </h2>
          <p className="text-muted-foreground mb-6">
            PPTXファイルがダウンロードされました
          </p>
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 mb-8 text-left max-w-xl mx-auto">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400 mb-1">
                  ご確認のお願い
                </h3>
                <p className="text-xs text-amber-600 dark:text-amber-400/80 leading-relaxed">
                  本提案書はAIによって自動生成されたものです。内容に誤りや事実と異なる情報（ハルシネーション）が含まれている可能性があります。
                  <strong>顧客へ提供する前に、必ず内容を確認し、事実確認・修正・改善を行ってください。</strong>
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setStep("analyze")}
              className="border border-primary text-primary font-bold px-6 py-3 rounded-xl hover:bg-primary/5 transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              別の形式で再生成
            </button>
            <button
              onClick={() => {
                setStep("source");
                setAnalysis(null);
                setSfData(null);
                setSelectedOppId("");
              }}
              className="bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              新しい案件を処理
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
