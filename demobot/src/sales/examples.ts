// src/sales/examples.ts
//
// Demo fixtures for mock mode (USE_MOCK_SAP=true).
//
// CRITICAL DESIGN RULE:
//   Mock data must be INPUT-DEPENDENT.  Different orderId / soldToParty values
//   from the planner must produce different mock records so the demo proves
//   the workflow is not returning static canned answers.
//
// The trick: we echo the extracted IDs into the fixture records and vary
// amounts / statuses deterministically based on a simple numeric hash.

import type { SalesIntent, ExtractedIds } from "../graph/types";
import type { AuthResult, SmartQueryResult, EntityReadResult } from "../mcp/schemas";

// ---------------------------------------------------------------------------
// Deterministic variation helpers
// ---------------------------------------------------------------------------

/** Simple numeric hash of a string → 0–99 */
function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 100;
  }
  return h;
}

const STATUS_POOL = ["A", "B", "C"] as const;          // Open, In Process, Completed
const AMOUNT_POOL = [12000, 25450, 33500, 48750, 67200, 91000] as const;
const CURRENCY = "USD";

function pickStatus(id: string): string {
  return STATUS_POOL[simpleHash(id) % STATUS_POOL.length];
}

function pickAmount(id: string): string {
  return String(AMOUNT_POOL[simpleHash(id) % AMOUNT_POOL.length]) + ".00";
}

// ---------------------------------------------------------------------------
// Record builders — produce raw OData records from extracted IDs
// ---------------------------------------------------------------------------

function buildOrderStatusRecord(ids: ExtractedIds): Record<string, unknown> {
  const orderId = ids.salesOrderId ?? "0000009999";
  return {
    SalesOrder: orderId,
    OverallSDProcessStatus: pickStatus(orderId),
    SoldToParty: ids.soldToParty ?? "0000001000",
    CreationDate: "2026-03-10T00:00:00Z",
  };
}

function buildOrderTotalRecord(ids: ExtractedIds): Record<string, unknown> {
  const orderId = ids.salesOrderId ?? "0000009999";
  return {
    SalesOrder: orderId,
    TotalNetAmount: pickAmount(orderId),
    TransactionCurrency: CURRENCY,
  };
}

function buildRecentOrdersRecords(ids: ExtractedIds): Record<string, unknown>[] {
  const party = ids.soldToParty ?? "0000001000";
  // Generate 3 orders whose IDs are derived from the customer number
  const base = simpleHash(party);
  return [
    {
      SalesOrder: String(1000000 + base + 3).padStart(10, "0"),
      OverallSDProcessStatus: "A",
      TotalNetAmount: pickAmount(party + "a"),
      TransactionCurrency: CURRENCY,
      SoldToParty: party,
      CreationDate: "2026-03-13T00:00:00Z",
    },
    {
      SalesOrder: String(1000000 + base + 2).padStart(10, "0"),
      OverallSDProcessStatus: "C",
      TotalNetAmount: pickAmount(party + "b"),
      TransactionCurrency: CURRENCY,
      SoldToParty: party,
      CreationDate: "2026-03-11T00:00:00Z",
    },
    {
      SalesOrder: String(1000000 + base + 1).padStart(10, "0"),
      OverallSDProcessStatus: "B",
      TotalNetAmount: pickAmount(party + "c"),
      TransactionCurrency: CURRENCY,
      SoldToParty: party,
      CreationDate: "2026-03-10T00:00:00Z",
    },
  ];
}

// ---------------------------------------------------------------------------
// Auth fixture
// ---------------------------------------------------------------------------

export const MOCK_AUTH_RESULT: AuthResult = {
  authenticated: true,
  sessionId: "mock-session-demo-001",
  expiresAt: "2026-03-14T23:59:59Z",
  message: "Mock session established",
};

// ---------------------------------------------------------------------------
// OData envelope helpers
// ---------------------------------------------------------------------------

function wrapAsSmartQuery(rawData: unknown): SmartQueryResult {
  return { success: true, data: rawData, summary: "Mock response" };
}

function wrapAsEntityResult(rawData: unknown, totalCount?: number): EntityReadResult {
  return { success: true, data: rawData, totalCount };
}

function v4List(records: Record<string, unknown>[]): unknown {
  return { value: records };
}

function v4Single(record: Record<string, unknown>): unknown {
  return { value: [record] };
}

// ---------------------------------------------------------------------------
// Public fixture API — fully input-dependent
// ---------------------------------------------------------------------------

/**
 * getMockSmartQueryResult
 *
 * Returns a SmartQueryResult fixture whose inner OData data reflects the
 * extracted IDs from the planner.  Different IDs → different data.
 */
export function getMockSmartQueryResult(
  intent: SalesIntent,
  ids: ExtractedIds = {}
): SmartQueryResult {
  switch (intent) {
    case "GET_ORDER_STATUS":
      return wrapAsSmartQuery(v4Single(buildOrderStatusRecord(ids)));
    case "GET_ORDER_TOTAL":
      return wrapAsSmartQuery(v4Single(buildOrderTotalRecord(ids)));
    case "LIST_RECENT_CUSTOMER_ORDERS":
      return wrapAsSmartQuery(v4List(buildRecentOrdersRecords(ids)));
  }
}

/**
 * getMockEntityReadResult
 *
 * Returns an EntityReadResult fixture whose inner OData data reflects the
 * extracted IDs from the planner.  Different IDs → different data.
 */
export function getMockEntityReadResult(
  intent: SalesIntent,
  ids: ExtractedIds = {}
): EntityReadResult {
  switch (intent) {
    case "GET_ORDER_STATUS":
      return wrapAsEntityResult(v4Single(buildOrderStatusRecord(ids)));
    case "GET_ORDER_TOTAL":
      return wrapAsEntityResult(v4Single(buildOrderTotalRecord(ids)));
    case "LIST_RECENT_CUSTOMER_ORDERS": {
      const records = buildRecentOrdersRecords(ids);
      return wrapAsEntityResult(v4List(records), records.length);
    }
  }
}
