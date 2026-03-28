// src/mcp/index.ts
// Public barrel – callers import from here, not from sub-files directly.
export { McpClient } from "./client";
export type { McpClientOptions } from "./client";
export type { AuthResult, SmartQueryResult, EntityReadResult } from "./schemas";
