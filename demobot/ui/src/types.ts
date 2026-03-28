// Shared frontend types matching the backend SalesbotResult shape

export interface ExtractedIds {
  salesOrderId?: string;
  soldToParty?: string;
  customerName?: string;
}

export interface SalesPlan {
  intent: string;
  extractedIds: ExtractedIds;
  strategy: string;
  fallback: string;
  userQuery: string;
  confidence: number;
}

export interface ExecutionTrace {
  workflowId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  steps: string[];
  mockMode: boolean;
}

export interface SalesModel {
  intent: string;
  [key: string]: unknown;
}

export interface SalesbotResult {
  ok: boolean;
  query: string;
  plan: SalesPlan | null;
  usedSmartQuery: boolean;
  usedFallback: boolean;
  model: SalesModel | null;
  answer: string;
  error: string | null;
  trace: ExecutionTrace;
}

export interface ChatMessage {
  id: string;
  role: "user" | "bot";
  text: string;
  result?: SalesbotResult;
  loading?: boolean;
  ts: number;
}
