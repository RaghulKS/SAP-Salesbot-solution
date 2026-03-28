// src/mcp/client.ts
// Public MCP client facade.
//
// This is the ONLY file callers should import from the mcp/ module.
// It manages connection lifecycle and exposes exactly three operations:
//
//   associateSession   →  check-sap-authentication
//   smartQuery         →  sap-smart-query          (preferred path)
//   executeEntityRead  →  execute-entity-operation  (precise fallback path)
//
// When USE_MOCK_SAP=true in the environment, all three methods return
// ID-dependent fixtures from src/sales/examples.ts without making any
// network call.  Different IDs → different data.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "../config";
import { createLogger } from "../logs/logger";
import {
  callCheckSapAuthentication,
  callExecuteEntityOperation,
  callSapSmartQuery,
} from "./tools";
import type { AuthResult, EntityReadResult, SmartQueryResult } from "./schemas";
import {
  SUPABASE_AUTH_RESULT,
  getSupabaseSmartQueryResult,
  getSupabaseEntityReadResult,
} from "./supabaseClient";
import type { SalesIntent, ExtractedIds } from "../graph/types";

const log = createLogger("mcp:client");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpClientOptions {
  /** Override the server URL for this specific instance */
  serverUrl?: string;
  /** Intent hint used by mock mode to select the right fixture shape */
  intent?: SalesIntent;
  /** Extracted IDs from the planner — mock mode uses these to vary fixture data */
  extractedIds?: ExtractedIds;
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

export class McpClient {
  private readonly serverUrl: string | undefined;
  private readonly intent: SalesIntent | undefined;
  private readonly extractedIds: ExtractedIds;
  private sdk: Client | null = null;
  private connected = false;

  constructor(options: McpClientOptions = {}) {
    this.serverUrl = options.serverUrl ?? config.MCP_SERVER_URL;
    this.intent = options.intent;
    this.extractedIds = options.extractedIds ?? {};

    if (!config.USE_MOCK_SAP && !this.serverUrl) {
      throw new Error(
        "MCP_SERVER_URL is not set. Add it to your .env, pass serverUrl in options, or set USE_MOCK_SAP=true."
      );
    }
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle (no-ops in mock mode)
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (config.USE_MOCK_SAP) {
      log.info("McpClient.connect(): mock mode – skipping network connection");
      this.connected = true;
      return;
    }

    if (this.connected) {
      log.warn("McpClient.connect() called on an already-connected instance");
      return;
    }

    log.info("Connecting to MCP server", { url: this.serverUrl });

    const transport = new StreamableHTTPClientTransport(
      new URL(this.serverUrl!)
    );

    this.sdk = new Client(
      { name: "salesbot-demo", version: "0.1.0" },
      { capabilities: {} }
    );

    try {
      await this.sdk.connect(transport);
      this.connected = true;
      log.info("MCP connection established");
    } catch (err) {
      this.sdk = null;
      throw new Error(
        `Failed to connect to MCP server at ${this.serverUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async disconnect(): Promise<void> {
    if (config.USE_MOCK_SAP) {
      this.connected = false;
      return;
    }
    if (!this.sdk || !this.connected) return;
    try {
      await this.sdk.close();
      log.info("MCP connection closed");
    } finally {
      this.sdk = null;
      this.connected = false;
    }
  }

  // -------------------------------------------------------------------------
  // Private guard
  // -------------------------------------------------------------------------

  private get client(): Client {
    if (!this.sdk || !this.connected) {
      throw new Error(
        "McpClient is not connected. Call connect() before using tool methods."
      );
    }
    return this.sdk;
  }

  // -------------------------------------------------------------------------
  // Mock helpers
  // -------------------------------------------------------------------------

  private mockIntent(): SalesIntent {
    return this.intent ?? "GET_ORDER_STATUS";
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async associateSession(sessionId?: string): Promise<AuthResult> {
    if (config.USE_MOCK_SAP) {
      log.info("associateSession [mock]", { sessionId });
      return { ...SUPABASE_AUTH_RESULT, sessionId: sessionId ?? SUPABASE_AUTH_RESULT.sessionId };
    }
    log.info("associateSession", { sessionId });
    return callCheckSapAuthentication(this.client, { sessionId });
  }

  async smartQuery(
    userRequest: string,
    context?: Record<string, unknown>
  ): Promise<SmartQueryResult> {
    if (config.USE_MOCK_SAP) {
      log.info("smartQuery [mock]", {
        userRequest,
        intent: this.mockIntent(),
        ids: this.extractedIds,
      });
      return getSupabaseSmartQueryResult(this.mockIntent(), this.extractedIds);
    }
    log.info("smartQuery", { userRequest });
    return callSapSmartQuery(this.client, { userRequest, context });
  }

  async executeEntityRead(
    serviceId: string,
    entityName: string,
    queryOptions?: Record<string, unknown>,
    parameters?: Record<string, unknown>
  ): Promise<EntityReadResult> {
    if (config.USE_MOCK_SAP) {
      log.info("executeEntityRead [mock]", {
        serviceId,
        entityName,
        intent: this.mockIntent(),
        ids: this.extractedIds,
      });
      return getSupabaseEntityReadResult(this.mockIntent(), this.extractedIds);
    }
    log.info("executeEntityRead", { serviceId, entityName });
    return callExecuteEntityOperation(this.client, {
      serviceId,
      entityName,
      queryOptions,
      parameters,
    });
  }
}
