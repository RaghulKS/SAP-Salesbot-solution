// src/temporal/activities.ts
// Activity implementations — all side effects live here.
//
// Each activity:
//   1. Imports from domain modules (graph, sales, mcp).
//   2. Does exactly one thing.
//   3. Returns a typed result object (never throws into the workflow).
//   4. Logs what it does.

import { McpClient } from "../mcp/client";
import { runPlanner } from "../graph/planner";
import { generateFinalAnswer } from "../sales/answer";
import {
  extractMcpData,
  extractODataList,
  extractODataSingle,
  extractOrderStatus,
  extractOrderTotal,
  extractOrderSummary,
} from "../sales/extractOData";
import {
  formatOrderStatus,
  formatOrderTotal,
  formatRecentOrders,
  SalesModel,
} from "../sales/formatSales";
import {
  buildGetOrderById,
  buildListRecentOrdersForCustomer,
  buildGetOrderTotalById,
} from "../sales/fallbackBuilders";
import { createLogger } from "../logs/logger";
import type { SalesPlan } from "../graph/types";
import type {
  PlanActivityResult,
  AuthActivityResult,
  SmartQueryActivityResult,
  FallbackQueryActivityResult,
  NormalizeActivityResult,
  AnswerActivityResult,
} from "./types";

const log = createLogger("activities");

// ---------------------------------------------------------------------------
// planQuery
// ---------------------------------------------------------------------------

/**
 * Run the LangGraph planner to produce a SalesPlan from the user query.
 * No MCP calls, no SAP calls.
 */
export async function planQuery(userQuery: string): Promise<PlanActivityResult> {
  log.info("planQuery: start", { userQuery });
  try {
    const state = await runPlanner(userQuery);
    if (state.error || !state.plan) {
      log.warn("planQuery: planner returned error", { error: state.error });
      return { ok: false, plan: null, error: state.error ?? "No plan produced" };
    }
    log.info("planQuery: success", { intent: state.plan.intent });
    return { ok: true, plan: state.plan, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("planQuery: exception", { error: msg });
    return { ok: false, plan: null, error: msg };
  }
}

// ---------------------------------------------------------------------------
// associateSession
// ---------------------------------------------------------------------------

/**
 * Verify (or create) a SAP session via the MCP check-sap-authentication tool.
 * Re-uses an existing sessionId if provided.
 */
export async function associateSession(
  sessionId?: string
): Promise<AuthActivityResult> {
  log.info("associateSession: start", { sessionId });
  const mcp = new McpClient({ intent: "GET_ORDER_STATUS" });
  try {
    await mcp.connect();
    const result = await mcp.associateSession(sessionId);
    log.info("associateSession: authenticated", {
      authenticated: result.authenticated,
      sessionId: result.sessionId,
    });
    return {
      ok: result.authenticated,
      sessionId: result.sessionId,
      error: result.authenticated ? null : (result.message ?? "Authentication failed"),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("associateSession: exception", { error: msg });
    return { ok: false, sessionId: undefined, error: msg };
  } finally {
    await mcp.disconnect();
  }
}

// ---------------------------------------------------------------------------
// runSmartQuery
// ---------------------------------------------------------------------------

/**
 * Send the user query to the MCP sap-smart-query tool.
 * Returns raw data payload only — normalization happens in a separate activity.
 *
 * Accepts the full plan so the McpClient can use intent + extractedIds
 * for mock fixture selection.
 */
export async function runSmartQuery(
  userQuery: string,
  plan: SalesPlan,
  sessionId?: string
): Promise<SmartQueryActivityResult> {
  log.info("runSmartQuery: start", { intent: plan.intent });
  const mcp = new McpClient({ intent: plan.intent, extractedIds: plan.extractedIds });
  try {
    await mcp.connect();
    const context: Record<string, unknown> = {};
    if (sessionId) context["sessionId"] = sessionId;

    const result = await mcp.smartQuery(userQuery, context);
    if (!result.success) {
      log.warn("runSmartQuery: tool reported failure", { error: result.error });
      return { ok: false, rawData: null, error: result.error ?? "Smart query failed" };
    }
    log.info("runSmartQuery: success");
    return { ok: true, rawData: result.data ?? null, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("runSmartQuery: exception", { error: msg });
    return { ok: false, rawData: null, error: msg };
  } finally {
    await mcp.disconnect();
  }
}

// ---------------------------------------------------------------------------
// runFallbackQuery
// ---------------------------------------------------------------------------

/**
 * Execute the precise OData fallback path via execute-entity-operation.
 * Builds the correct EntityOperationRequest from the plan, then calls the
 * MCP executeEntityRead tool.
 *
 * ⚠️  Never passes natural language to this path.
 */
export async function runFallbackQuery(
  plan: SalesPlan,
  sessionId?: string
): Promise<FallbackQueryActivityResult> {
  log.info("runFallbackQuery: start", { intent: plan.intent });

  const { intent, extractedIds } = plan;

  // Build the explicit OData descriptor deterministically from the plan
  let descriptor;
  if (intent === "GET_ORDER_STATUS" || intent === "GET_ORDER_TOTAL") {
    if (!extractedIds.salesOrderId) {
      return {
        ok: false,
        rawData: null,
        error: `Cannot run fallback for ${intent}: salesOrderId is missing`,
      };
    }
    descriptor =
      intent === "GET_ORDER_TOTAL"
        ? buildGetOrderTotalById(extractedIds.salesOrderId)
        : buildGetOrderById(extractedIds.salesOrderId);
  } else {
    // LIST_RECENT_CUSTOMER_ORDERS
    const party = extractedIds.soldToParty;
    if (!party) {
      return {
        ok: false,
        rawData: null,
        error: "Cannot run fallback for LIST_RECENT_CUSTOMER_ORDERS: soldToParty is missing",
      };
    }
    descriptor = buildListRecentOrdersForCustomer(party, 10);
  }

  const mcp = new McpClient({ intent, extractedIds });
  try {
    await mcp.connect();

    const result = await mcp.executeEntityRead(
      descriptor.serviceId,
      descriptor.entityName,
      descriptor.queryOptions as Record<string, unknown>,
      descriptor.parameters as Record<string, unknown>
    );

    if (!result.success) {
      log.warn("runFallbackQuery: tool reported failure", { error: result.error });
      return { ok: false, rawData: null, error: result.error ?? "Fallback query failed" };
    }

    log.info("runFallbackQuery: success");
    return { ok: true, rawData: result.data ?? null, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("runFallbackQuery: exception", { error: msg });
    return { ok: false, rawData: null, error: msg };
  } finally {
    await mcp.disconnect();
  }
}

// ---------------------------------------------------------------------------
// normalizeData
// ---------------------------------------------------------------------------

/**
 * Extract and normalize a raw MCP/OData payload into a typed SalesModel.
 * No MCP calls — pure data transformation.
 */
export async function normalizeData(
  rawData: unknown,
  plan: SalesPlan
): Promise<NormalizeActivityResult> {
  log.info("normalizeData: start", { intent: plan.intent });
  try {
    const innerData = extractMcpData(rawData, "normalizeData");
    let model: SalesModel;

    switch (plan.intent) {
      case "GET_ORDER_STATUS": {
        const record = extractODataSingle(innerData, "order_status");
        const raw = extractOrderStatus(record);
        model = formatOrderStatus(raw);
        break;
      }
      case "GET_ORDER_TOTAL": {
        const record = extractODataSingle(innerData, "order_total");
        const raw = extractOrderTotal(record);
        model = formatOrderTotal(raw);
        break;
      }
      case "LIST_RECENT_CUSTOMER_ORDERS": {
        const records = extractODataList(innerData, "recent_orders");
        const raws = records.map((r) => extractOrderSummary(r));
        model = formatRecentOrders(raws, plan.extractedIds.soldToParty);
        break;
      }
    }

    log.info("normalizeData: success", { intent: model.intent });
    return { ok: true, model, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("normalizeData: exception", { error: msg });
    return { ok: false, model: null, error: msg };
  }
}

// ---------------------------------------------------------------------------
// generateAnswer
// ---------------------------------------------------------------------------

/**
 * Generate the final answer from a normalized SalesModel.
 * Delegates to generateFinalAnswer (from sales/answer.ts) which:
 *   - Uses gpt-4o to phrase a friendly response
 *   - Runs a recursion guard against tool-call token leakage
 *   - Falls back to a safe deterministic sentence on failure
 *
 * This activity does NOT call MCP tools.
 * It only receives normalized data.
 */
export async function generateAnswer(
  model: SalesModel,
  userQuery: string,
  plan: SalesPlan
): Promise<AnswerActivityResult> {
  log.info("generateAnswer: start", { intent: model.intent });
  try {
    const answer = await generateFinalAnswer({
      userQuery,
      plan,
      normalizedModel: model,
    });

    log.info("generateAnswer: success");
    return { ok: true, answer, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("generateAnswer: exception", { error: msg });
    return { ok: false, answer: "", error: msg };
  }
}
