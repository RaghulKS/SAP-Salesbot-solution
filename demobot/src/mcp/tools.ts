// src/mcp/tools.ts
// Thin wrappers that call individual MCP tools on a connected Client instance.
// Each function:
//   1. Serialises and validates the input with Zod.
//   2. Calls client.callTool() with the exact tool name.
//   3. Unwraps the MCP content envelope.
//   4. Parses and validates the JSON payload with a Zod response schema.
//   5. Returns a typed result – never raw `unknown`.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  AuthRequest,
  AuthResult,
  AuthResultSchema,
  EntityReadRequest,
  EntityReadResult,
  EntityReadResultSchema,
  McpToolResponseSchema,
  SmartQueryRequest,
  SmartQueryResult,
  SmartQueryResultSchema,
} from "./schemas";
import { createLogger } from "../logs/logger";

const log = createLogger("mcp:tools");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Unwrap the MCP `{ content: [{type, text}] }` envelope and JSON-parse the
 * inner text payload.  Throws a descriptive error on any shape mismatch.
 */
function unwrapContent(raw: unknown, toolName: string): unknown {
  const envelope = McpToolResponseSchema.safeParse(raw);
  if (!envelope.success) {
    throw new Error(
      `[${toolName}] MCP response envelope is malformed: ${envelope.error.message}`
    );
  }
  const { content, isError } = envelope.data;
  if (isError) {
    const errText = content.map((c) => c.text).join("\n");
    throw new Error(`[${toolName}] Tool returned an error: ${errText}`);
  }
  const textBlock = content.find((c) => c.type === "text");
  if (!textBlock) {
    throw new Error(`[${toolName}] No text content block in MCP response`);
  }
  try {
    return JSON.parse(textBlock.text);
  } catch {
    // Some tools return plain strings – pass the raw text through as-is.
    return textBlock.text;
  }
}

// ---------------------------------------------------------------------------
// Tool: check-sap-authentication
// ---------------------------------------------------------------------------

export async function callCheckSapAuthentication(
  client: Client,
  input: AuthRequest
): Promise<AuthResult> {
  log.debug("Calling check-sap-authentication", { input });
  const raw = await client.callTool({
    name: "check-sap-authentication",
    arguments: input,
  });
  const payload = unwrapContent(raw, "check-sap-authentication");
  const result = AuthResultSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `[check-sap-authentication] Response schema mismatch: ${result.error.message}`
    );
  }
  log.debug("check-sap-authentication result", { result: result.data });
  return result.data;
}

// ---------------------------------------------------------------------------
// Tool: sap-smart-query
// ---------------------------------------------------------------------------

export async function callSapSmartQuery(
  client: Client,
  input: SmartQueryRequest
): Promise<SmartQueryResult> {
  log.debug("Calling sap-smart-query", { userRequest: input.userRequest });
  const raw = await client.callTool({
    name: "sap-smart-query",
    arguments: input,
  });
  const payload = unwrapContent(raw, "sap-smart-query");
  const result = SmartQueryResultSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `[sap-smart-query] Response schema mismatch: ${result.error.message}`
    );
  }
  log.debug("sap-smart-query result", { success: result.data.success });
  return result.data;
}

// ---------------------------------------------------------------------------
// Tool: execute-entity-operation  (precise / parameterised path only)
// IMPORTANT: arguments must be explicit OData-style parameters, never NL text.
// ---------------------------------------------------------------------------

export async function callExecuteEntityOperation(
  client: Client,
  input: EntityReadRequest
): Promise<EntityReadResult> {
  log.debug("Calling execute-entity-operation", {
    serviceId: input.serviceId,
    entityName: input.entityName,
  });
  const raw = await client.callTool({
    name: "execute-entity-operation",
    arguments: input,
  });
  const payload = unwrapContent(raw, "execute-entity-operation");
  const result = EntityReadResultSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `[execute-entity-operation] Response schema mismatch: ${result.error.message}`
    );
  }
  log.debug("execute-entity-operation result", { success: result.data.success });
  return result.data;
}
