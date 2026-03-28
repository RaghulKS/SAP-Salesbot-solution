// src/temporal/types.ts
// Shared types for salesbotWorkflow and its activities.
// This file must stay free of SDK imports — it is imported by both the
// workflow sandbox and regular Node code.

import type { SalesPlan, ExtractedIds } from "../graph/types";
import type { SalesModel } from "../sales/formatSales";

// ---------------------------------------------------------------------------
// Workflow input
// ---------------------------------------------------------------------------

export interface SalesbotInput {
  /** The original natural-language question from the user */
  userQuery: string;
  /** Optional existing SAP session ID to re-use instead of creating a new one */
  sessionId?: string;
  /** Whether mock SAP mode is active (passed from config since workflows can't read env) */
  mockMode?: boolean;
}

// ---------------------------------------------------------------------------
// Activity result types
// ---------------------------------------------------------------------------

export interface PlanActivityResult {
  ok: boolean;
  plan: SalesPlan | null;
  error: string | null;
}

export interface AuthActivityResult {
  ok: boolean;
  sessionId: string | undefined;
  error: string | null;
}

export interface SmartQueryActivityResult {
  ok: boolean;
  /** Raw data payload returned by the MCP server */
  rawData: unknown;
  error: string | null;
}

export interface FallbackQueryActivityResult {
  ok: boolean;
  /** Raw data payload returned by the MCP server */
  rawData: unknown;
  error: string | null;
}

export interface NormalizeActivityResult {
  ok: boolean;
  model: SalesModel | null;
  error: string | null;
}

export interface AnswerActivityResult {
  ok: boolean;
  answer: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Execution trace — proves the workflow actually ran
// ---------------------------------------------------------------------------

export interface ExecutionTrace {
  /** Temporal workflow ID */
  workflowId: string;
  /** ISO-8601 timestamp when the workflow started */
  startedAt: string;
  /** ISO-8601 timestamp when the workflow completed */
  completedAt: string;
  /** Wall-clock milliseconds from start to finish */
  durationMs: number;
  /** Ordered list of steps that actually executed */
  steps: string[];
  /** Whether mock mode was used (inferred from plan execution) */
  mockMode: boolean;
}

// ---------------------------------------------------------------------------
// Workflow result
// ---------------------------------------------------------------------------

export interface SalesbotResult {
  ok: boolean;
  query: string;
  plan: SalesPlan | null;
  usedSmartQuery: boolean;
  usedFallback: boolean;
  model: SalesModel | null;
  answer: string;
  error: string | null;
  /** Execution trace proving the workflow ran end-to-end */
  trace: ExecutionTrace;
}
