// src/sales/extractOData.ts
//
// Safe extraction layer: turns raw unknown payloads from MCP tool results or
// OData HTTP responses into typed intermediate records.
//
// Contract:
//   - Every function returns a typed value or throws an ExtractError.
//   - No LLM calls.
//   - No SAP calls.
//   - Only the three demo intents are handled:
//       order status, order total, recent customer orders.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ExtractError extends Error {
  constructor(
    public readonly context: string,
    message: string
  ) {
    super(`[extractOData:${context}] ${message}`);
    this.name = "ExtractError";
  }
}

// ---------------------------------------------------------------------------
// OData envelope helpers
// ---------------------------------------------------------------------------

/**
 * OData v2 wraps results in { d: { results: [...] } } or { d: { ... } }.
 * OData v4 wraps results in { value: [...] } or a plain object.
 * We handle both conventions.
 */
const ODataV2ListSchema = z
  .object({ d: z.object({ results: z.array(z.record(z.unknown())) }) })
  .transform((v) => v.d.results);

const ODataV2SingleSchema = z
  .object({ d: z.record(z.unknown()) })
  .transform((v) => v.d);

const ODataV4ListSchema = z
  .object({ value: z.array(z.record(z.unknown())) })
  .transform((v) => v.value);

/**
 * Unwrap a raw OData response payload into a flat array of entity records.
 * Handles v2 list, v2 single, v4 list, and bare array / object responses.
 */
export function extractODataList(
  raw: unknown,
  context: string
): Record<string, unknown>[] {
  // v2 list
  const v2List = ODataV2ListSchema.safeParse(raw);
  if (v2List.success) return v2List.data;

  // v4 list
  const v4List = ODataV4ListSchema.safeParse(raw);
  if (v4List.success) return v4List.data;

  // bare array of objects
  if (Array.isArray(raw)) {
    if (raw.every((r) => typeof r === "object" && r !== null)) {
      return raw as Record<string, unknown>[];
    }
    throw new ExtractError(context, "Array contains non-object elements");
  }

  // v2 single entity
  const v2Single = ODataV2SingleSchema.safeParse(raw);
  if (v2Single.success) return [v2Single.data];

  // plain object – wrap in array
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return [raw as Record<string, unknown>];
  }

  throw new ExtractError(
    context,
    `Cannot unwrap OData payload – unexpected shape: ${JSON.stringify(raw)?.slice(0, 120)}`
  );
}

/**
 * Unwrap a raw OData response that is expected to contain exactly one entity.
 * Throws if the result set is empty.
 */
export function extractODataSingle(
  raw: unknown,
  context: string
): Record<string, unknown> {
  const list = extractODataList(raw, context);
  if (list.length === 0) {
    throw new ExtractError(context, "Result set is empty – entity not found");
  }
  return list[0];
}

// ---------------------------------------------------------------------------
// MCP SmartQuery / EchoResult payload extractor
// ---------------------------------------------------------------------------

/**
 * Dig the actual data out of a SmartQueryResult or EchoResult coming back
 * from the MCP layer.  These wrappers carry { success, data, summary }.
 * We want whatever is in `data`.
 */
const McpDataWrapperSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export function extractMcpData(raw: unknown, context: string): unknown {
  const parsed = McpDataWrapperSchema.safeParse(raw);
  if (!parsed.success) {
    // The payload might already be the unwrapped data (e.g. from activities)
    return raw;
  }
  if (!parsed.data.success) {
    throw new ExtractError(
      context,
      `MCP tool reported failure: ${parsed.data.error ?? "no error detail"}`
    );
  }
  if (parsed.data.data === undefined || parsed.data.data === null) {
    throw new ExtractError(context, "MCP tool succeeded but data field is empty");
  }
  return parsed.data.data;
}

// ---------------------------------------------------------------------------
// Intent-specific field extractors
// These are the only three intents supported in the demo.
// Field names below correspond to API_SALES_ORDER_SRV (common SAP OData names).
// ▶ Replace field names when you have the real $metadata document.
// ---------------------------------------------------------------------------

/** Raw field names we read from a sales order OData record */
const RAW_ORDER_FIELDS = {
  id: ["SalesOrder", "SalesOrderId", "Id", "id"],
  status: ["OverallSDProcessStatus", "OverallStatus", "Status", "status"],
  netAmount: ["TotalNetAmount", "NetAmount", "netAmount", "totalNetAmount"],
  currency: ["TransactionCurrency", "Currency", "currency"],
  soldToParty: ["SoldToParty", "CustomerNumber", "soldToParty"],
  creationDate: ["CreationDate", "CreatedAt", "creationDate"],
} as const;

/**
 * Read the first matching field from a record, returning `undefined` if none match.
 */
function pickField(
  record: Record<string, unknown>,
  candidates: readonly string[]
): unknown {
  for (const key of candidates) {
    if (key in record && record[key] !== null && record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

/** Coerce an OData Edm.Decimal / Edm.Double string to a JS number */
function parseAmount(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return isNaN(n) ? undefined : n;
  }
  return undefined;
}

// --- Order status ---

export interface RawOrderStatus {
  orderId: string;
  status: string;
  soldToParty: string | undefined;
  creationDate: string | undefined;
}

/**
 * Extract order-status fields from a raw OData entity record.
 * Throws ExtractError if orderId or status cannot be resolved.
 */
export function extractOrderStatus(
  record: Record<string, unknown>
): RawOrderStatus {
  const orderId = String(
    pickField(record, RAW_ORDER_FIELDS.id) ?? ""
  ).trim();
  if (!orderId) {
    throw new ExtractError(
      "extractOrderStatus",
      "Could not find a non-empty order ID in the record"
    );
  }

  const status = String(
    pickField(record, RAW_ORDER_FIELDS.status) ?? ""
  ).trim();
  if (!status) {
    throw new ExtractError(
      "extractOrderStatus",
      `No status field found for order ${orderId}`
    );
  }

  return {
    orderId,
    status,
    soldToParty: pickField(record, RAW_ORDER_FIELDS.soldToParty) != null
      ? String(pickField(record, RAW_ORDER_FIELDS.soldToParty))
      : undefined,
    creationDate: pickField(record, RAW_ORDER_FIELDS.creationDate) != null
      ? String(pickField(record, RAW_ORDER_FIELDS.creationDate))
      : undefined,
  };
}

// --- Order total ---

export interface RawOrderTotal {
  orderId: string;
  netAmount: number;
  currency: string;
}

/**
 * Extract order-total fields from a raw OData entity record.
 * Throws ExtractError if orderId, netAmount, or currency cannot be resolved.
 */
export function extractOrderTotal(
  record: Record<string, unknown>
): RawOrderTotal {
  const orderId = String(
    pickField(record, RAW_ORDER_FIELDS.id) ?? ""
  ).trim();
  if (!orderId) {
    throw new ExtractError(
      "extractOrderTotal",
      "Could not find a non-empty order ID in the record"
    );
  }

  const rawAmount = pickField(record, RAW_ORDER_FIELDS.netAmount);
  const netAmount = parseAmount(rawAmount);
  if (netAmount === undefined) {
    throw new ExtractError(
      "extractOrderTotal",
      `No numeric amount found for order ${orderId} (raw: ${JSON.stringify(rawAmount)})`
    );
  }

  const currency = String(
    pickField(record, RAW_ORDER_FIELDS.currency) ?? ""
  ).trim();
  if (!currency) {
    throw new ExtractError(
      "extractOrderTotal",
      `No currency key found for order ${orderId}`
    );
  }

  return { orderId, netAmount, currency };
}

// --- Recent customer orders ---

export interface RawOrderSummary {
  orderId: string;
  status: string | undefined;
  netAmount: number | undefined;
  currency: string | undefined;
  creationDate: string | undefined;
  soldToParty: string | undefined;
}

/**
 * Extract a lightweight order summary from a raw OData entity record.
 * Only orderId is required; all other fields are optional.
 */
export function extractOrderSummary(
  record: Record<string, unknown>
): RawOrderSummary {
  const orderId = String(
    pickField(record, RAW_ORDER_FIELDS.id) ?? ""
  ).trim();
  if (!orderId) {
    throw new ExtractError(
      "extractOrderSummary",
      "Could not find a non-empty order ID in the record"
    );
  }

  const rawStatus = pickField(record, RAW_ORDER_FIELDS.status);
  const rawAmount = pickField(record, RAW_ORDER_FIELDS.netAmount);

  return {
    orderId,
    status: rawStatus != null ? String(rawStatus).trim() : undefined,
    netAmount: parseAmount(rawAmount),
    currency: pickField(record, RAW_ORDER_FIELDS.currency) != null
      ? String(pickField(record, RAW_ORDER_FIELDS.currency)).trim()
      : undefined,
    creationDate: pickField(record, RAW_ORDER_FIELDS.creationDate) != null
      ? String(pickField(record, RAW_ORDER_FIELDS.creationDate))
      : undefined,
    soldToParty: pickField(record, RAW_ORDER_FIELDS.soldToParty) != null
      ? String(pickField(record, RAW_ORDER_FIELDS.soldToParty))
      : undefined,
  };
}
