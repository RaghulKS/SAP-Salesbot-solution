// src/mcp/supabaseClient.ts
//
// Supabase-backed demo backend.  Replaces the prebuilt fixtures from
// sales/examples.ts so the demo reads real rows from a Postgres table
// while preserving the exact same data shape downstream.
//
// Design rules:
//   - Rows are SELECTed with SAP OData column names ("SalesOrder", etc.)
//     so extractOData.ts / formatSales.ts need zero changes.
//   - Return wrappers match SmartQueryResult / EntityReadResult exactly.
//   - This file is the ONLY place that imports @supabase/supabase-js.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";
import { createLogger } from "../logs/logger";
import type { SalesIntent, ExtractedIds } from "../graph/types";
import type { SmartQueryResult, EntityReadResult, AuthResult } from "./schemas";

const log = createLogger("mcp:supabase");

// ---------------------------------------------------------------------------
// Lazy singleton
// ---------------------------------------------------------------------------

let _sb: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_sb) return _sb;

  const url = config.SUPABASE_URL;
  const key = config.SUPABASE_READONLY_KEY ?? config.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and a Supabase key (SUPABASE_READONLY_KEY or SUPABASE_SERVICE_ROLE_KEY) must be set when USE_MOCK_SAP=true"
    );
  }

  if (!config.SUPABASE_READONLY_KEY && config.SUPABASE_SERVICE_ROLE_KEY) {
    log.warn("Supabase service-role key is configured; use SUPABASE_READONLY_KEY with RLS for safer production deployments");
  }

  _sb = createClient(url, key);
  log.info("Supabase client initialised", { url });
  return _sb;
}

// ---------------------------------------------------------------------------
// Column list — matches the SAP OData field names the extraction layer expects
// ---------------------------------------------------------------------------

const COLUMNS = [
  "SalesOrder",
  "SoldToParty",
  "OverallSDProcessStatus",
  "TotalNetAmount",
  "TransactionCurrency",
  "CreationDate",
].join(",");

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

async function queryOrderById(
  orderId: string
): Promise<Record<string, unknown>[]> {
  const { data, error } = await getClient()
    .from("sales_orders")
    .select(COLUMNS)
    .eq("SalesOrder", orderId)
    .limit(1);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]) ?? [];
}

async function queryOrdersForCustomer(
  soldToParty: string,
  limit: number = 5
): Promise<Record<string, unknown>[]> {
  const { data, error } = await getClient()
    .from("sales_orders")
    .select(COLUMNS)
    .eq("SoldToParty", soldToParty)
    .order("CreationDate", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]) ?? [];
}

// ---------------------------------------------------------------------------
// OData v4 envelope helpers (same shape as examples.ts produced)
// ---------------------------------------------------------------------------

function v4List(rows: Record<string, unknown>[]) {
  return { value: rows };
}

function v4Single(rows: Record<string, unknown>[]) {
  return { value: rows.length > 0 ? [rows[0]] : [] };
}

// ---------------------------------------------------------------------------
// Public API — drop-in replacements for getMockSmartQueryResult / getMockEntityReadResult
// ---------------------------------------------------------------------------

export const SUPABASE_AUTH_RESULT: AuthResult = {
  authenticated: true,
  sessionId: "supabase-session-001",
  expiresAt: "2099-12-31T23:59:59Z",
  message: "Supabase demo session established",
};

export async function getSupabaseSmartQueryResult(
  intent: SalesIntent,
  ids: ExtractedIds = {}
): Promise<SmartQueryResult> {
  log.info("getSupabaseSmartQueryResult", { intent, ids });

  let rows: Record<string, unknown>[];

  switch (intent) {
    case "GET_ORDER_STATUS":
    case "GET_ORDER_TOTAL":
      rows = await queryOrderById(ids.salesOrderId ?? "");
      return { success: rows.length > 0, data: v4Single(rows) };

    case "LIST_RECENT_CUSTOMER_ORDERS":
      rows = await queryOrdersForCustomer(ids.soldToParty ?? "", 5);
      return { success: rows.length > 0, data: v4List(rows) };
  }
}

export async function getSupabaseEntityReadResult(
  intent: SalesIntent,
  ids: ExtractedIds = {}
): Promise<EntityReadResult> {
  log.info("getSupabaseEntityReadResult", { intent, ids });

  let rows: Record<string, unknown>[];

  switch (intent) {
    case "GET_ORDER_STATUS":
    case "GET_ORDER_TOTAL":
      rows = await queryOrderById(ids.salesOrderId ?? "");
      return { success: rows.length > 0, data: v4Single(rows) };

    case "LIST_RECENT_CUSTOMER_ORDERS":
      rows = await queryOrdersForCustomer(ids.soldToParty ?? "", 10);
      return {
        success: rows.length > 0,
        data: v4List(rows),
        totalCount: rows.length,
      };
  }
}
