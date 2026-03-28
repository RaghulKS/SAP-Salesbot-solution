// src/sales/answer.ts
//
// generateFinalAnswer – uses gpt-4o to phrase a friendly, concise answer.
//
// Contract:
//   1. Accepts only the normalized SalesModel (never raw SAP payloads).
//   2. Never imports or calls the MCP client.
//   3. The prompt explicitly forbids: tool calls, mentioning MCP / OData /
//      queryOptions, and inventing missing values.
//   4. The response is passed through containsToolCallTokens().
//      If the guard fires, a safe static fallback is returned instead.
//   5. If required fields are absent from the model, the function describes
//      exactly what is missing rather than guessing.

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { containsToolCallTokens } from "./guards";
import type { SalesModel, OrderStatusModel, OrderTotalModel, RecentOrdersModel } from "./formatSales";
import type { SalesPlan } from "../graph/types";
import { createLogger } from "../logs/logger";

const log = createLogger("sales:answer");

// ---------------------------------------------------------------------------
// LLM (lazy singleton)
// ---------------------------------------------------------------------------

let _llm: ChatGoogleGenerativeAI | null = null;

function getLlm(): ChatGoogleGenerativeAI {
  if (!_llm) {
    _llm = new ChatGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
      model: "gemini-3-flash-preview",
      temperature: 0,
      maxOutputTokens: 2048,
    });
  }
  return _llm;
}

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface AnswerInput {
  userQuery: string;
  plan: SalesPlan;
  normalizedModel: SalesModel;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const ANSWER_SYSTEM_PROMPT = `You are a friendly sales assistant answering a user's question about their SAP sales orders.

You will receive a JSON context block containing structured, already-validated data.
Your job is to phrase a clear, concise answer that directly answers the user's question using ONLY the data provided.

STRICT RULES — violating any of these is unacceptable:
1. Do NOT make tool calls. Do NOT output JSON, XML, or code blocks.
2. Do NOT mention MCP, OData, queryOptions, entity names, or any technical infrastructure.
3. Do NOT invent, estimate, or guess any value that is not explicitly present in the context block.
4. If a field in the context block is null or undefined, say exactly which piece of information is unavailable instead of guessing.
5. Be concise. One to five sentences maximum.
6. Use plain business English. No jargon, no system internals.
7. When the intent is "recent orders", list EVERY order from the context block individually, showing its order ID, status, and amount. Do not summarise — enumerate them.

OUTPUT FORMAT:
Plain text only. No markdown formatting. Use a simple numbered list only when listing multiple orders.`;

// ---------------------------------------------------------------------------
// Data completeness checker — describes what is missing, never guesses
// ---------------------------------------------------------------------------

interface CompletenessCheck {
  complete: boolean;
  missingFields: string[];
}

function checkOrderStatus(m: OrderStatusModel): CompletenessCheck {
  const missing: string[] = [];
  if (!m.orderId) missing.push("order ID");
  if (!m.status || m.status === "Unknown") missing.push("order status");
  return { complete: missing.length === 0, missingFields: missing };
}

function checkOrderTotal(m: OrderTotalModel): CompletenessCheck {
  const missing: string[] = [];
  if (!m.orderId) missing.push("order ID");
  if (!m.formattedAmount) missing.push("total amount");
  if (!m.currency) missing.push("currency");
  return { complete: missing.length === 0, missingFields: missing };
}

function checkRecentOrders(m: RecentOrdersModel): CompletenessCheck {
  const missing: string[] = [];
  if (!m.orders || m.orders.length === 0) missing.push("order list");
  return { complete: missing.length === 0, missingFields: missing };
}

function checkCompleteness(model: SalesModel): CompletenessCheck {
  switch (model.intent) {
    case "order_status": return checkOrderStatus(model);
    case "order_total": return checkOrderTotal(model);
    case "recent_orders": return checkRecentOrders(model);
  }
}

// ---------------------------------------------------------------------------
// Context block builder — fed to the LLM as the human turn
// ---------------------------------------------------------------------------

function buildContextBlock(model: SalesModel, userQuery: string): string {
  const safeUserQuery = userQuery.replace(/[<>]/g, "").slice(0, 2000);
  const ctx: Record<string, unknown> = { userQuery: safeUserQuery };

  switch (model.intent) {
    case "order_status":
      ctx["intent"] = "order status";
      ctx["orderId"] = model.orderId;
      ctx["status"] = model.status;
      if (model.soldToParty) ctx["customer"] = model.soldToParty;
      if (model.creationDate) ctx["creationDate"] = model.creationDate;
      break;

    case "order_total":
      ctx["intent"] = "order total";
      ctx["orderId"] = model.orderId;
      ctx["totalAmount"] = model.formattedAmount;
      ctx["currency"] = model.currency;
      break;

    case "recent_orders":
      ctx["intent"] = "recent orders";
      if (model.soldToParty) ctx["customer"] = model.soldToParty;
      ctx["totalFound"] = model.totalCount;
      ctx["orders"] = model.orders.map((o) => ({
        orderId: o.orderId,
        ...(o.status ? { status: o.status } : {}),
        ...(o.formattedAmount ? { amount: o.formattedAmount } : {}),
        ...(o.creationDate ? { creationDate: o.creationDate } : {}),
      }));
      break;
  }

  return JSON.stringify(ctx, null, 2);
}

// ---------------------------------------------------------------------------
// Fallback sentences for when the guard fires or the model is incomplete
// ---------------------------------------------------------------------------

function safeFallback(model: SalesModel): string {
  switch (model.intent) {
    case "order_status":
      return `The status of sales order ${model.orderId} is ${model.status}.`;
    case "order_total":
      return `The total for sales order ${model.orderId} is ${model.formattedAmount}.`;
    case "recent_orders": {
      const lines = model.orders.map(
        (o, i) => {
          const status = o.status ?? "Unknown";
          const amount = o.formattedAmount ? `, ${o.formattedAmount}` : "";
          const date = o.creationDate
            ? `, created ${o.creationDate.slice(0, 10)}`
            : "";
          return `${i + 1}. Order ${o.orderId} — ${status}${amount}${date}`;
        }
      );
      const customer = model.soldToParty ?? "(unknown)";
      return `Here are the ${model.totalCount} most recent orders for customer ${customer}:\n${lines.join("\n")}`;
    }
  }
}

function missingDataAnswer(missingFields: string[]): string {
  const list = missingFields.join(" and ");
  return `I was unable to provide a complete answer because the following information was not available: ${list}. Please check the data source and try again.`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * generateFinalAnswer
 *
 * Uses gpt-4o (temperature 0) to phrase a friendly answer from the normalized
 * SalesModel.  Runs a recursion guard on the output and falls back to a safe
 * static sentence if any tool-call tokens are detected.
 */
export async function generateFinalAnswer(input: AnswerInput): Promise<string> {
  const { userQuery, normalizedModel } = input;

  log.info("generateFinalAnswer: start", { intent: normalizedModel.intent });

  // ── Completeness check ────────────────────────────────────────────────────
  const completeness = checkCompleteness(normalizedModel);
  if (!completeness.complete) {
    log.warn("generateFinalAnswer: incomplete model", {
      missing: completeness.missingFields,
    });
    return missingDataAnswer(completeness.missingFields);
  }

  // ── recent_orders: use deterministic template (LLM unreliably truncates lists)
  if (normalizedModel.intent === "recent_orders") {
    log.info("generateFinalAnswer: using deterministic template for recent_orders");
    return safeFallback(normalizedModel);
  }

  // ── Build context and call LLM ────────────────────────────────────────────
  const contextBlock = buildContextBlock(normalizedModel, userQuery);

  log.debug("generateFinalAnswer: context block", { contextBlock });

  let raw: string;
  try {
    const llm = getLlm();
    const response = await llm.invoke([
      new SystemMessage(ANSWER_SYSTEM_PROMPT),
      new HumanMessage(
        `Here is the structured context for this query:\n\n${contextBlock}\n\nPlease answer the user's question.`
      ),
    ]);

    raw =
      typeof response.content === "string"
        ? response.content.trim()
        : Array.isArray(response.content)
        ? response.content
            .filter((p: any) => typeof p === "string" || p?.type === "text")
            .map((p: any) => (typeof p === "string" ? p : p.text ?? ""))
            .join("")
            .trim()
        : String(response.content).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("generateFinalAnswer: LLM call failed", { error: msg });
    // Fall back to the deterministic sentence
    return safeFallback(normalizedModel);
  }

  // ── Recursion guard ───────────────────────────────────────────────────────
  if (containsToolCallTokens(raw)) {
    log.warn(
      "generateFinalAnswer: recursion guard fired – tool-call tokens detected in LLM response",
      { raw: raw.slice(0, 120) }
    );
    return safeFallback(normalizedModel);
  }

  // ── Truncation guard ─────────────────────────────────────────────────────
  // If the response ends without a sentence-ending character the LLM was cut
  // off by the token limit. Return the deterministic fallback instead.
  const lastChar = raw.at(-1) ?? "";
  if (!["." , "!", "?", ":"].includes(lastChar)) {
    log.warn(
      "generateFinalAnswer: truncation guard fired – response appears cut off",
      { tail: raw.slice(-60) }
    );
    return safeFallback(normalizedModel);
  }

  log.info("generateFinalAnswer: success");
  return raw;
}
