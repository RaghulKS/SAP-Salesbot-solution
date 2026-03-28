// src/temporal/workflows.ts
//
// salesbotWorkflow – orchestrates the full demo flow.
//
// ⚠️  Temporal workflow sandboxing rules (MUST be respected):
//   - No Node built-ins (fs, net, crypto, process.env, …)
//   - No direct async I/O — everything goes through activity proxies
//   - Only deterministic code here; dates/randoms from activities
//   - Only @temporalio/workflow + pure-type imports allowed at module scope

import { proxyActivities, log, workflowInfo } from "@temporalio/workflow";
import type * as Activities from "./activities";
import type { SalesbotInput, SalesbotResult, ExecutionTrace } from "./types";

// ---------------------------------------------------------------------------
// Activity proxies — two retry tiers
// ---------------------------------------------------------------------------

/** Network-facing activities: MCP calls, SAP calls — retried up to 3x */
const {
  associateSession,
  runSmartQuery,
  runFallbackQuery,
} = proxyActivities<typeof Activities>({
  startToCloseTimeout: "45 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "20 seconds",
  },
});

/** Local activities: planning, normalization, answer rendering — 2 attempts */
const {
  planQuery,
  normalizeData,
  generateAnswer,
} = proxyActivities<typeof Activities>({
  startToCloseTimeout: "60 seconds", // LLM planning can be slow
  retry: {
    maximumAttempts: 2,
    initialInterval: "1 second",
    backoffCoefficient: 1,
  },
});

// ---------------------------------------------------------------------------
// Trace builder helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function buildTrace(
  startedAt: string,
  steps: string[],
  mockMode: boolean
): ExecutionTrace {
  const completedAt = nowIso();
  return {
    workflowId: workflowInfo().workflowId,
    startedAt,
    completedAt,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    steps,
    mockMode,
  };
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * salesbotWorkflow
 *
 * Full demo flow:
 *   1. Plan        – LangGraph classifies the query and extracts IDs
 *   2. Auth        – Associate (or verify) the SAP session via MCP
 *   3. Smart query – Try sap-smart-query (NL path, preferred)
 *   4. Fallback    – If smart query fails, use execute-entity-operation (precise)
 *   5. Normalize   – Extract OData records and build a typed SalesModel
 *   6. Answer      – Render the model into a friendly answer via LLM
 */
export async function salesbotWorkflow(
  input: SalesbotInput
): Promise<SalesbotResult> {
  const { userQuery, sessionId, mockMode: isMock } = input;
  const startedAt = nowIso();
  const steps: string[] = [];
  const mock = isMock ?? false;

  let usedSmartQuery = false;
  let usedFallback = false;

  // ── 1. Plan ──────────────────────────────────────────────────────────────
  log.info("salesbotWorkflow: planning query");
  steps.push("plan");
  const planResult = await planQuery(userQuery);

  if (!planResult.ok || !planResult.plan) {
    log.warn("salesbotWorkflow: planning failed", {
      error: planResult.error ?? undefined,
    });
    return {
      ok: false,
      query: userQuery,
      plan: null,
      usedSmartQuery: false,
      usedFallback: false,
      model: null,
      answer: "",
      error: planResult.error ?? "Planning failed",
      trace: buildTrace(startedAt, steps, mock),
    };
  }

  const { plan } = planResult;
  log.info("salesbotWorkflow: plan ready", { intent: plan.intent });

  // ── 2. Associate SAP session ──────────────────────────────────────────────
  log.info("salesbotWorkflow: associating SAP session");
  steps.push("auth");
  const authResult = await associateSession(sessionId);

  if (!authResult.ok) {
    log.warn("salesbotWorkflow: auth failed (non-fatal)", {
      error: authResult.error ?? undefined,
    });
    // Non-fatal for demo: continue
  }

  const activeSessionId = authResult.sessionId ?? sessionId;

  // ── 3. Smart query (preferred NL path) ───────────────────────────────────
  log.info("salesbotWorkflow: running smart query");
  steps.push("smartQuery");
  const smartResult = await runSmartQuery(userQuery, plan, activeSessionId);

  let rawData: unknown = null;

  if (smartResult.ok) {
    log.info("salesbotWorkflow: smart query succeeded");
    usedSmartQuery = true;
    rawData = smartResult.rawData;
  } else {
    // ── 4. Fallback (precise OData path) ────────────────────────────────────
    log.warn("salesbotWorkflow: smart query failed, trying fallback", {
      error: smartResult.error ?? undefined,
    });

    steps.push("fallback");
    const fallbackResult = await runFallbackQuery(plan, activeSessionId);

    if (!fallbackResult.ok) {
      log.warn("salesbotWorkflow: fallback also failed", {
        error: fallbackResult.error ?? undefined,
      });
      return {
        ok: false,
        query: userQuery,
        plan,
        usedSmartQuery: false,
        usedFallback: true,
        model: null,
        answer: "",
        error: fallbackResult.error ?? "Both query paths failed",
        trace: buildTrace(startedAt, steps, mock),
      };
    }

    log.info("salesbotWorkflow: fallback succeeded");
    usedFallback = true;
    rawData = fallbackResult.rawData;
  }

  // ── 5. Normalize ──────────────────────────────────────────────────────────
  log.info("salesbotWorkflow: normalizing data");
  steps.push("normalize");
  const normalizeResult = await normalizeData(rawData, plan);

  if (!normalizeResult.ok || !normalizeResult.model) {
    log.warn("salesbotWorkflow: normalization failed", {
      error: normalizeResult.error ?? undefined,
    });
    return {
      ok: false,
      query: userQuery,
      plan,
      usedSmartQuery,
      usedFallback,
      model: null,
      answer: "",
      error: normalizeResult.error ?? "Normalization failed",
      trace: buildTrace(startedAt, steps, mock),
    };
  }

  // ── 6. Answer ─────────────────────────────────────────────────────────────
  log.info("salesbotWorkflow: generating answer");
  steps.push("answer");
  const answerResult = await generateAnswer(normalizeResult.model, userQuery, plan);

  if (!answerResult.ok) {
    log.warn("salesbotWorkflow: answer generation failed", {
      error: answerResult.error ?? undefined,
    });
    return {
      ok: false,
      query: userQuery,
      plan,
      usedSmartQuery,
      usedFallback,
      model: normalizeResult.model,
      answer: "",
      error: answerResult.error ?? "Answer generation failed",
      trace: buildTrace(startedAt, steps, mock),
    };
  }

  log.info("salesbotWorkflow: complete");
  return {
    ok: true,
    query: userQuery,
    plan,
    usedSmartQuery,
    usedFallback,
    model: normalizeResult.model,
    answer: answerResult.answer,
    error: null,
    trace: buildTrace(startedAt, steps, mock),
  };
}
