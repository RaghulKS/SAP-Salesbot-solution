// src/sales/guards.ts
//
// Runtime safety guards for the normalization pipeline.
//
// Three responsibilities:
//   1. Detect leaked LLM tool-call tokens in text that should be plain prose.
//   2. Validate that a normalized order model has the required fields.
//   3. Assert that amount values never appear in status slots and vice-versa.
//
// No LLM calls.  No SAP calls.  Pure predicate functions.

import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Tool-call token detection
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate a raw LLM tool-call or JSON function block leaked
 * into a text field that should contain only plain human-readable prose.
 *
 * Extend this list if you observe new leakage patterns in your LLM output.
 */
const TOOL_CALL_PATTERNS: RegExp[] = [
  // OpenAI function-call JSON wrapper
  /"function"\s*:\s*\{/,
  /"tool_calls"\s*:/,
  /"tool_use"\s*:/,
  // Common internal token names
  /\btool_call\b/i,
  /\bfunction_call\b/i,
  // Raw MCP-style tool invocation fragments
  /<tool_use>/i,
  /<function>/i,
  // Anthropic tool-use XML
  /<tool_input>/i,
];

/**
 * Returns true if `text` contains any pattern that indicates a raw tool-call
 * token leaked into a field that should hold plain prose or a data value.
 */
export function containsToolCallTokens(text: string): boolean {
  return TOOL_CALL_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// 2. Order model field presence validator
// ---------------------------------------------------------------------------

/**
 * Minimum required fields across all three demo normalized models.
 * A model that fails this check must not be used to generate an answer.
 */
const RequiredOrderFieldsSchema = z.object({
  orderId: z.string().min(1),
  intent: z.enum(["order_status", "order_total", "recent_orders"]),
});

/**
 * Returns true if `model` satisfies the minimum required fields for a
 * normalized sales model.  Does NOT throw on failure.
 */
export function validateOrderFields(model: unknown): boolean {
  return RequiredOrderFieldsSchema.safeParse(model).success;
}

// ---------------------------------------------------------------------------
// 3. Field-mixup assertion
// ---------------------------------------------------------------------------

/**
 * Patterns that look like monetary amounts.
 * Used to detect amounts sitting in status-typed slots.
 */
const AMOUNT_PATTERNS: RegExp[] = [
  // Numeric with optional decimals (standalone or currency-prefixed)
  /^\d{1,3}(,\d{3})*(\.\d{1,4})?$/,
  /^[A-Z]{3}\s+\d/,   // e.g. "USD 1234.56"
  /\d+\.\d{2}$/,       // trailing decimal pair typical of monetary values
];

/**
 * SAP sales-order status codes and their human-readable equivalents.
 * Add codes from your OData $metadata as you discover them.
 */
const STATUS_VALUES = new Set([
  // Overall status
  "A", "B", "C",
  // Delivery status
  "open", "in process", "completed", "rejected", "partially delivered",
  "delivered", "not delivered", "blocked",
  // Billing status
  "not billed", "partially billed", "fully billed",
]);

function looksLikeAmount(value: unknown): boolean {
  if (typeof value === "number") return true;
  if (typeof value !== "string") return false;
  return AMOUNT_PATTERNS.some((re) => re.test(value.trim()));
}

function looksLikeStatus(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return STATUS_VALUES.has(value.trim().toLowerCase());
}

/**
 * assertNoFieldMixups
 *
 * Throws a descriptive error if:
 *   - model.status contains a value that looks like a monetary amount.
 *   - model.totalAmount / model.netAmount contains a value that looks like a status code.
 *   - model.orderId is missing or empty.
 *
 * Call this after normalization and before answer generation.
 */
export function assertNoFieldMixups(model: unknown): void {
  if (typeof model !== "object" || model === null) {
    throw new TypeError("assertNoFieldMixups: model must be a non-null object");
  }

  const m = model as Record<string, unknown>;

  // --- orderId must always be present ---
  if (!m["orderId"] || (typeof m["orderId"] === "string" && m["orderId"].trim() === "")) {
    throw new Error(
      "Field mixup detected: orderId is missing or empty. " +
        "Every normalized model must carry a non-empty orderId."
    );
  }

  // --- status slot must not contain an amount ---
  if ("status" in m && looksLikeAmount(m["status"])) {
    throw new Error(
      `Field mixup detected: model.status contains a value that looks like ` +
        `a monetary amount ("${String(m["status"])}"). ` +
        `Check OData field mapping – amount was placed in the status slot.`
    );
  }

  // --- amount slots must not contain a status code ---
  for (const amountField of ["totalAmount", "netAmount"] as const) {
    if (amountField in m && looksLikeStatus(m[amountField])) {
      throw new Error(
        `Field mixup detected: model.${amountField} contains a value that looks like ` +
          `a status code ("${String(m[amountField])}"). ` +
          `Check OData field mapping – status was placed in the amount slot.`
      );
    }
  }
}
