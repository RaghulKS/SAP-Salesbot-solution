// src/graph/types.ts
//
// Shared types for the LangGraph salesbot planner.
// This file has zero runtime dependencies so it can be imported from anywhere.

// ---------------------------------------------------------------------------
// Intent enum
// ---------------------------------------------------------------------------

/** The three intents this demo supports. */
export const SALES_INTENTS = [
  "GET_ORDER_STATUS",
  "GET_ORDER_TOTAL",
  "LIST_RECENT_CUSTOMER_ORDERS",
] as const;

export type SalesIntent = (typeof SALES_INTENTS)[number];

// ---------------------------------------------------------------------------
// Fallback strategy
// ---------------------------------------------------------------------------

/**
 * GET_ONE – fetch a single entity by key (used for order-status / order-total)
 * LIST   – fetch a list of entities  (used for recent-customer-orders)
 */
export type FallbackStrategy = "GET_ONE" | "LIST";

// ---------------------------------------------------------------------------
// SalesPlan – the structured output of the planner
// ---------------------------------------------------------------------------

/** IDs the planner extracted from the user query. */
export interface ExtractedIds {
  /** Sales order document number, e.g. "0000001234" */
  salesOrderId?: string;
  /** Sold-to / customer party number, e.g. "0000001000" */
  soldToParty?: string;
  /** Customer name (free-text, not a key) – for display only */
  customerName?: string;
}

export interface SalesPlan {
  /** Classified intent */
  intent: SalesIntent;
  /** IDs pulled from the user query */
  extractedIds: ExtractedIds;
  /** Always SMART_QUERY_FIRST for this demo */
  strategy: "SMART_QUERY_FIRST";
  /** Fallback path: GET_ONE for single-order intents, LIST for list intents */
  fallback: FallbackStrategy;
  /** Original user query preserved for downstream context */
  userQuery: string;
  /** 0-1 confidence the LLM reported for its classification */
  confidence: number;
}

// ---------------------------------------------------------------------------
// PlannerOutput – what the graph ultimately produces
// ---------------------------------------------------------------------------

export interface PlannerOutput {
  plan: SalesPlan | null;
  error: string | null;
}
