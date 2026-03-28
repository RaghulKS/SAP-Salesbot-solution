// src/sales/formatSales.ts
//
// Normalization layer: converts raw extracted records into strongly typed
// normalized models ready for answer generation.
//
// Three models, one per demo intent:
//   OrderStatusModel     – intent: "order_status"
//   OrderTotalModel      – intent: "order_total"
//   RecentOrdersModel    – intent: "recent_orders"
//
// Each formatter:
//   1. Accepts the raw extracted shape from extractOData.ts.
//   2. Applies intent-specific validation via guards.ts.
//   3. Returns a sealed, narrow normalized model.
//   4. Never calls LLM or SAP services.

import {
  RawOrderStatus,
  RawOrderTotal,
  RawOrderSummary,
  ExtractError,
} from "./extractOData";
import { assertNoFieldMixups } from "./guards";

// ---------------------------------------------------------------------------
// Normalized model types
// ---------------------------------------------------------------------------

/** Shared discriminant that lets callers switch on intent without casting */
export type DemoIntent = "order_status" | "order_total" | "recent_orders";

// --- Order Status ---

/** Human-readable status label produced by normalizeStatus() */
export type StatusLabel =
  | "Open"
  | "In Process"
  | "Completed"
  | "Rejected"
  | "Partially Delivered"
  | "Delivered"
  | "Blocked"
  | "Unknown";

export interface OrderStatusModel {
  readonly intent: "order_status";
  readonly orderId: string;
  /** Normalized human-readable label */
  readonly status: StatusLabel;
  /** Original raw status code preserved for debugging */
  readonly rawStatus: string;
  readonly soldToParty: string | undefined;
  readonly creationDate: string | undefined;
}

// --- Order Total ---

export interface OrderTotalModel {
  readonly intent: "order_total";
  readonly orderId: string;
  /** Net amount as a finite JS number */
  readonly netAmount: number;
  /** ISO 4217 currency code */
  readonly currency: string;
  /** Pre-formatted string for direct inclusion in answers, e.g. "USD 12,345.67" */
  readonly formattedAmount: string;
}

// --- Recent Orders ---

export interface OrderSummaryItem {
  readonly orderId: string;
  readonly status: StatusLabel | undefined;
  readonly rawStatus: string | undefined;
  readonly netAmount: number | undefined;
  readonly currency: string | undefined;
  readonly formattedAmount: string | undefined;
  readonly creationDate: string | undefined;
  readonly soldToParty: string | undefined;
}

export interface RecentOrdersModel {
  readonly intent: "recent_orders";
  /** orderId of the first item – required by field-mixup guard */
  readonly orderId: string;
  readonly soldToParty: string | undefined;
  readonly orders: readonly OrderSummaryItem[];
  readonly totalCount: number;
}

/** Union of all three normalized models */
export type SalesModel = OrderStatusModel | OrderTotalModel | RecentOrdersModel;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a raw SAP status code or description to a human-readable label.
 * ▶ Extend this map with codes from your OData $metadata as you discover them.
 */
const STATUS_MAP: Record<string, StatusLabel> = {
  // Single-letter OverallSDProcessStatus codes (API_SALES_ORDER_SRV)
  A: "Open",
  B: "In Process",
  C: "Completed",
  // Delivery status codes
  D: "Rejected",
  // Free-text variants (lower-cased for matching)
  open: "Open",
  "in process": "In Process",
  completed: "Completed",
  rejected: "Rejected",
  "partially delivered": "Partially Delivered",
  delivered: "Delivered",
  blocked: "Blocked",
};

function normalizeStatus(raw: string): StatusLabel {
  return STATUS_MAP[raw.trim()] ?? STATUS_MAP[raw.trim().toLowerCase()] ?? "Unknown";
}

/**
 * Format a numeric amount and currency code into a display string.
 * Uses `Intl.NumberFormat` with 2 decimal places.
 */
function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if the currency code is unrecognised by Intl
    return `${currency} ${amount.toFixed(2)}`;
  }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * formatOrderStatus
 *
 * Converts a RawOrderStatus (from extractOrderStatus()) into an OrderStatusModel.
 * Runs assertNoFieldMixups before returning.
 *
 * @throws ExtractError if orderId is missing.
 * @throws Error (from assertNoFieldMixups) if amount/status slots are swapped.
 */
export function formatOrderStatus(raw: RawOrderStatus): OrderStatusModel {
  if (!raw.orderId.trim()) {
    throw new ExtractError("formatOrderStatus", "orderId is empty");
  }

  const model: OrderStatusModel = {
    intent: "order_status",
    orderId: raw.orderId.trim(),
    status: normalizeStatus(raw.status),
    rawStatus: raw.status,
    soldToParty: raw.soldToParty,
    creationDate: raw.creationDate,
  };

  // Guard: status slot must not contain an amount
  assertNoFieldMixups(model);

  return model;
}

/**
 * formatOrderTotal
 *
 * Converts a RawOrderTotal (from extractOrderTotal()) into an OrderTotalModel.
 * Validates that netAmount is a finite number before accepting it.
 * Runs assertNoFieldMixups before returning.
 *
 * @throws ExtractError if orderId is missing or netAmount is not finite.
 * @throws Error (from assertNoFieldMixups) if amount/status slots are swapped.
 */
export function formatOrderTotal(raw: RawOrderTotal): OrderTotalModel {
  if (!raw.orderId.trim()) {
    throw new ExtractError("formatOrderTotal", "orderId is empty");
  }
  if (!Number.isFinite(raw.netAmount)) {
    throw new ExtractError(
      "formatOrderTotal",
      `netAmount is not a finite number for order ${raw.orderId} (got: ${raw.netAmount})`
    );
  }
  if (!raw.currency.trim()) {
    throw new ExtractError(
      "formatOrderTotal",
      `currency is empty for order ${raw.orderId}`
    );
  }

  const model: OrderTotalModel = {
    intent: "order_total",
    orderId: raw.orderId.trim(),
    netAmount: raw.netAmount,
    currency: raw.currency.trim().toUpperCase(),
    formattedAmount: formatAmount(raw.netAmount, raw.currency.trim()),
  };

  // Guard: amount slot must not contain a status code
  assertNoFieldMixups(model);

  return model;
}

/**
 * formatOrderSummaryItem
 *
 * Converts a RawOrderSummary into an OrderSummaryItem used inside
 * RecentOrdersModel.  Only orderId is required; all other fields are optional.
 */
function formatOrderSummaryItem(raw: RawOrderSummary): OrderSummaryItem {
  if (!raw.orderId.trim()) {
    throw new ExtractError("formatOrderSummaryItem", "orderId is empty");
  }

  const hasAmount =
    raw.netAmount !== undefined && Number.isFinite(raw.netAmount);
  const hasCurrency = !!raw.currency?.trim();

  return {
    orderId: raw.orderId.trim(),
    status: raw.status !== undefined ? normalizeStatus(raw.status) : undefined,
    rawStatus: raw.status,
    netAmount: hasAmount ? raw.netAmount : undefined,
    currency: hasCurrency ? raw.currency!.trim().toUpperCase() : undefined,
    formattedAmount:
      hasAmount && hasCurrency
        ? formatAmount(raw.netAmount!, raw.currency!.trim())
        : undefined,
    creationDate: raw.creationDate,
    soldToParty: raw.soldToParty,
  };
}

/**
 * formatRecentOrders
 *
 * Converts an array of RawOrderSummary records (from extractOrderSummary())
 * into a RecentOrdersModel.
 * Runs assertNoFieldMixups on the container model before returning.
 *
 * @param raws         The raw extracted summaries (already sorted by the builder).
 * @param soldToParty  Customer number carried on the list for context.
 *
 * @throws ExtractError if the list is empty or any item is missing orderId.
 * @throws Error (from assertNoFieldMixups) on field mixups.
 */
export function formatRecentOrders(
  raws: RawOrderSummary[],
  soldToParty?: string
): RecentOrdersModel {
  if (raws.length === 0) {
    throw new ExtractError(
      "formatRecentOrders",
      "Cannot build RecentOrdersModel from an empty list"
    );
  }

  const orders = raws.map(formatOrderSummaryItem);

  const model: RecentOrdersModel = {
    intent: "recent_orders",
    // Use the first item's orderId to satisfy the field-mixup guard's minimum requirement
    orderId: orders[0].orderId,
    soldToParty: soldToParty ?? orders[0].soldToParty,
    orders,
    totalCount: orders.length,
  };

  // Guard: check the container model (orderId presence, no slot swaps)
  assertNoFieldMixups(model);

  return model;
}
