// src/mcp/schemas.ts
// Zod schemas for every MCP tool request and the response shapes we care about.
// Tool names, field names, and types must match the actual MCP server contract.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Tool: check-sap-authentication
// ---------------------------------------------------------------------------
export const AuthRequestSchema = z.object({
  sessionId: z.string().optional(),
});
export type AuthRequest = z.infer<typeof AuthRequestSchema>;

export const AuthResultSchema = z.object({
  authenticated: z.boolean(),
  sessionId: z.string().optional(),
  expiresAt: z.string().optional(), // ISO-8601
  message: z.string().optional(),
});
export type AuthResult = z.infer<typeof AuthResultSchema>;

// ---------------------------------------------------------------------------
// Tool: sap-smart-query
// ---------------------------------------------------------------------------
export const SmartQueryRequestSchema = z.object({
  userRequest: z.string().min(1, "userRequest must not be empty"),
  context: z.record(z.unknown()).optional(),
});
export type SmartQueryRequest = z.infer<typeof SmartQueryRequestSchema>;

export const SmartQueryResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  summary: z.string().optional(),
  rawResponse: z.unknown().optional(),
  error: z.string().optional(),
});
export type SmartQueryResult = z.infer<typeof SmartQueryResultSchema>;

// ---------------------------------------------------------------------------
// Tool: execute-entity-operation
// NOTE: This tool requires explicit parameters – never pass natural language here.
// ---------------------------------------------------------------------------
export const EntityReadRequestSchema = z.object({
  serviceId: z.string().min(1, "serviceId must not be empty"),
  entityName: z.string().min(1, "entityName must not be empty"),
  queryOptions: z.record(z.unknown()).optional(),
  parameters: z.record(z.unknown()).optional(),
});
export type EntityReadRequest = z.infer<typeof EntityReadRequestSchema>;

export const EntityReadResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  totalCount: z.number().optional(),
  error: z.string().optional(),
});
export type EntityReadResult = z.infer<typeof EntityReadResultSchema>;

// ---------------------------------------------------------------------------
// Generic MCP tool-call response wrapper
// The MCP SDK wraps all tool results in { content: Array<{type, text}> }
// ---------------------------------------------------------------------------
export const McpToolContentSchema = z.object({
  type: z.string(),
  text: z.string(),
});

export const McpToolResponseSchema = z.object({
  content: z.array(McpToolContentSchema),
  isError: z.boolean().optional(),
});
export type McpToolResponse = z.infer<typeof McpToolResponseSchema>;
