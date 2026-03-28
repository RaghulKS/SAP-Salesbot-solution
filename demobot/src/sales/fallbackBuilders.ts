// src/sales/fallbackBuilders.ts
//
// Deterministic builders for the execute-entity-operation fallback path.
//
// Rules:
//   - No LLM involvement – values are always explicit and predictable.
//   - operation is always "read" for this demo.
//   - Replace SAP_SERVICE_ID_PLACEHOLDER / SAP_ENTITY_NAME_PLACEHOLDER with
//     the real OData service and entity-set names when you have them.
//   - queryOptions fields follow OData v2/v4 system-query-option conventions.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The only operation allowed in this demo */
export type ReadOperation = "read";

/**
 * OData v2/v4 system query options we explicitly use.
 * Extend as needed – keep every used field typed rather than `unknown`.
 */
export interface ODataQueryOptions {
  /** OData $filter expression, e.g. "SalesOrder eq '1234'" */
  $filter?: string;
  /** Max records to return */
  $top?: number;
  /** Records to skip (for pagination) */
  $skip?: number;
  /** Comma-separated list of properties to include in the response */
  $select?: string;
  /** Comma-separated navigation properties to expand inline */
  $expand?: string;
  /** Ordering expression, e.g. "CreationDate desc" */
  $orderby?: string;
  /** Include total record count in the response */
  $inlinecount?: "allpages" | "none";
}

/**
 * Explicit key-predicate parameters passed as function / key imports.
 * For simple entity reads, the key is usually embedded in queryOptions.$filter.
 * This field is present for future action-import compatibility.
 */
export type EntityParameters = Record<string, string | number | boolean>;

/** A fully-resolved entity operation descriptor ready for executeEntityRead() */
export interface EntityOperationRequest {
  /**
   * OData service identifier.
   * Example: "API_SALES_ORDER_SRV"
   * ▶ Replace SAP_SERVICE_ID_PLACEHOLDER with the real value.
   */
  serviceId: string;
  /**
   * OData entity set name.
   * Example: "A_SalesOrder"
   * ▶ Replace SAP_ENTITY_NAME_PLACEHOLDER with the real value.
   */
  entityName: string;
  /** Always "read" for this demo */
  operation: ReadOperation;
  /** OData system query options */
  queryOptions: ODataQueryOptions;
  /** Key-predicate / action parameters (may be empty) */
  parameters: EntityParameters;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * ▶ TODO: Replace with the real SAP OData service ID for sales orders.
 *   Example: "API_SALES_ORDER_SRV"
 */
const SALES_ORDER_SERVICE_ID = "SAP_SERVICE_ID_PLACEHOLDER";

/**
 * ▶ TODO: Replace with the real SAP OData sales-order entity set name.
 *   Example: "A_SalesOrder"
 */
const SALES_ORDER_ENTITY = "SAP_ENTITY_NAME_PLACEHOLDER";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * buildGetOrderById
 *
 * Returns the descriptor to fetch a single sales order by its document number.
 *
 * @param salesOrderId  The SAP sales order document number (e.g. "0000001234").
 */
export function buildGetOrderById(salesOrderId: string): EntityOperationRequest {
  return {
    // ▶ Replace SALES_ORDER_SERVICE_ID with the real service identifier.
    serviceId: SALES_ORDER_SERVICE_ID,
    // ▶ Replace SALES_ORDER_ENTITY with the real entity set name.
    entityName: SALES_ORDER_ENTITY,
    operation: "read",
    queryOptions: {
      $filter: `SalesOrder eq '${salesOrderId}'`,
      $top: 1,
    },
    parameters: {
      SalesOrder: salesOrderId,
    },
  };
}

/**
 * buildListRecentOrdersForCustomer
 *
 * Returns the descriptor to fetch the N most recently created sales orders
 * for a given sold-to customer.  Results are sorted newest-first.
 *
 * @param soldToParty  The SAP sold-to party number (e.g. "0000001000").
 * @param top          Maximum number of orders to return.  Defaults to 10.
 */
export function buildListRecentOrdersForCustomer(
  soldToParty: string,
  top: number = 10
): EntityOperationRequest {
  if (top < 1 || !Number.isInteger(top)) {
    throw new RangeError(`top must be a positive integer, got: ${top}`);
  }

  return {
    // ▶ Replace SALES_ORDER_SERVICE_ID with the real service identifier.
    serviceId: SALES_ORDER_SERVICE_ID,
    // ▶ Replace SALES_ORDER_ENTITY with the real entity set name.
    entityName: SALES_ORDER_ENTITY,
    operation: "read",
    queryOptions: {
      $filter: `SoldToParty eq '${soldToParty}'`,
      // Newest first – replace CreationDate with the real date field name if different.
      $orderby: "CreationDate desc",
      $top: top,
      $inlinecount: "allpages",
    },
    parameters: {
      SoldToParty: soldToParty,
    },
  };
}

/**
 * buildGetOrderTotalById
 *
 * Returns the descriptor to fetch only the monetary total fields for a single
 * sales order.  Uses $select to minimise payload size.
 *
 * Selected fields (▶ replace with real field names from your OData metadata):
 *   SalesOrder          – document identifier (always needed for correlation)
 *   TotalNetAmount      – net order value
 *   TransactionCurrency – currency key (required to interpret the amount)
 *
 * @param salesOrderId  The SAP sales order document number.
 */
export function buildGetOrderTotalById(
  salesOrderId: string
): EntityOperationRequest {
  return {
    // ▶ Replace SALES_ORDER_SERVICE_ID with the real service identifier.
    serviceId: SALES_ORDER_SERVICE_ID,
    // ▶ Replace SALES_ORDER_ENTITY with the real entity set name.
    entityName: SALES_ORDER_ENTITY,
    operation: "read",
    queryOptions: {
      $filter: `SalesOrder eq '${salesOrderId}'`,
      $top: 1,
      // ▶ Replace field names below with the real OData property names from your
      //   $metadata document.  These are common names in API_SALES_ORDER_SRV.
      $select: "SalesOrder,TotalNetAmount,TransactionCurrency",
    },
    parameters: {
      SalesOrder: salesOrderId,
    },
  };
}
