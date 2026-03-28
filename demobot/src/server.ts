// src/server.ts
// Express HTTP server for the salesbot demo.
//
// Routes:
//   GET  /health  – liveness check
//   POST /ask     – start a salesbotWorkflow and return its result
//   POST /stt     – Google Cloud STT (audio blob → transcript)

//   GET  /        – serves the React UI (dist) when NODE_ENV=production

import express, { Request, Response, NextFunction } from "express";
import { Connection, WorkflowClient } from "@temporalio/client";
import { salesbotWorkflow } from "./temporal/workflows";
import type { SalesbotInput, SalesbotResult } from "./temporal/types";
import { config } from "./config";
import { createLogger } from "./logs/logger";
import { speechRouter } from "./speech";
import { createAuthMiddleware, createRateLimiter } from "./httpSecurity";

const log = createLogger("server");

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

interface AskRequestBody {
  query: string;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Temporal client (lazy singleton – created once on first request)
// ---------------------------------------------------------------------------

let _workflowClient: WorkflowClient | null = null;

async function getWorkflowClient(): Promise<WorkflowClient> {
  if (_workflowClient) return _workflowClient;

  const connection = await Connection.connect({
    address: config.TEMPORAL_ADDRESS,
  });

  _workflowClient = new WorkflowClient({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
  });

  log.info("Temporal WorkflowClient initialised", {
    address: config.TEMPORAL_ADDRESS,
  });

  return _workflowClient;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "100kb" }));

const requireApiAuth = createAuthMiddleware(config.API_AUTH_TOKEN);
const askRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });

// Allow only configured frontend origin (and localhost in development)
app.use((req, res, next) => {
  const origin = req.headers.origin ?? "";

  const isConfiguredOrigin = origin === config.ALLOWED_ORIGIN;
  const isDevLocalhost =
    config.NODE_ENV !== "production" &&
    (origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:"));

  if (isConfiguredOrigin || isDevLocalhost) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});


// ── GET /health ──────────────────────────────────────────────────────────────

// ── Speech routes (/stt and /tts) ────────────────────────────────────────────
app.use("/", speechRouter);


app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    env: config.NODE_ENV,
    mockMode: config.USE_MOCK_SAP,
  });
});

// ── POST /ask ────────────────────────────────────────────────────────────────

app.post(
  "/ask",
  requireApiAuth,
  askRateLimit,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const body = req.body as Partial<AskRequestBody>;
    const rawQuery = typeof body.query === "string" ? body.query.trim() : "";

    // Validate required field
    if (!rawQuery) {
      res.status(400).json({
        ok: false,
        error: "Missing or empty required field: query",
      });
      return;
    }

    if (rawQuery.length > config.MAX_QUERY_LENGTH) {
      res.status(400).json({
        ok: false,
        error: `Query is too long (max ${config.MAX_QUERY_LENGTH} characters)`,
      });
      return;
    }

    if (typeof body.sessionId === "string" && body.sessionId.length > 128) {
      res.status(400).json({
        ok: false,
        error: "sessionId exceeds maximum length",
      });
      return;
    }

    const input: SalesbotInput = {
      userQuery: rawQuery,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      mockMode: config.USE_MOCK_SAP,
    };

    log.info("POST /ask", { queryLength: input.userQuery.length, hasSID: !!input.sessionId });

    try {
      const client = await getWorkflowClient();

      const handle = await client.start(salesbotWorkflow, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: `salesbot-${Date.now()}`,
        args: [input],
      });

      log.info("Workflow started", { workflowId: handle.workflowId });

      const result: SalesbotResult = await handle.result();

      log.info("Workflow complete", {
        ok: result.ok,
        intent: result.plan?.intent,
        usedSmartQuery: result.usedSmartQuery,
        usedFallback: result.usedFallback,
      });

      res.status(result.ok ? 200 : 502).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  log.error("Unhandled server error", { error: msg });
  const safeError = config.NODE_ENV === "development" ? msg : "Internal server error";
  res.status(500).json({ ok: false, error: safeError });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(config.PORT, () => {
  log.info("HTTP server listening", {
    port: config.PORT,
    env: config.NODE_ENV,
    mockMode: config.USE_MOCK_SAP,
  });
});

export default app;
