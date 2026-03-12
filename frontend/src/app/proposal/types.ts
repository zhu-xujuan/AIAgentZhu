/** SalesAssist 共通型定義 */

export type DataSource = "salesforce" | "kintone" | "file" | "manual";

export interface SFCredentials {
  username: string;
  password: string;
  securityToken: string;
  loginUrl: string;
}

export interface KintoneCredentials {
  subdomain: string;
  apiToken: string;
  appId: string;
}

export interface ManualDealInput {
  companyName: string;
  industry: string;
  dealName: string;
  amount: string;
  stage: string;
  closeDate: string;
  challenges: string;
  description: string;
  contactName: string;
  contactRole: string;
}

export interface FileDealRecord {
  companyName: string;
  dealName: string;
  amount: number;
  stage: string;
  closeDate: string;
  industry: string;
  description: string;
  contacts: string;
}

export interface OpportunityListItem {
  Id: string;
  Name: string;
  Amount: number;
  StageName: string;
  CloseDate: string;
  AccountName: string;
}

export interface ScenarioResult {
  label: string;
  probability: number;
  expectedRevenue: number;
  timeline: string;
  conditions: string[];
}

export interface ServiceRecommendation {
  service: string;
  relevance: "primary" | "secondary" | "optional";
  reason: string;
  features: string[];
}

export interface AnalysisRationale {
  customerChallenges: string[];
  serviceRecommendations: ServiceRecommendation[];
  combinedSolution: string;
  existingProposalHints: string[];
}

export interface AnalysisResult {
  winProbability: number;
  dealHealthScore: number;
  activityScore: number;
  engagementLevel: string;
  proposalReadiness: number;
  scenarios: {
    optimistic: ScenarioResult;
    base: ScenarioResult;
    pessimistic: ScenarioResult;
  };
  keyDrivers: string[];
  riskFactors: string[];
  recommendedActions: string[];
  rationale: AnalysisRationale;
}

export interface SFData {
  account: { Name: string; Industry: string; [k: string]: unknown };
  opportunity: { Name: string; Amount: number; [k: string]: unknown };
  activities: unknown[];
  contacts: unknown[];
}

export type AIProvider = "gemini" | "claude" | "chatgpt";

export type Step = "source" | "select" | "analyze" | "generate";
